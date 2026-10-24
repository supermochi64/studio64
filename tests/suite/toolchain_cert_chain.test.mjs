// The downloader in tools/lib/toolchain.mjs against a certificate chain Node's own trust store
// cannot complete by itself: an intermediate signed by a root it has never heard of, with that
// root withheld from the wire (as ziglang.org's CDN does in practice -- see the issue this
// fixes). No browser, no real network: a throwaway CA minted with openssl and a loopback server.
// @tags smoke build
import { suite } from '../lib/harness.mjs';
import { isCertChainError, extraTrustedCAs } from '../../tools/lib/toolchain.mjs';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

function openssl(args) { execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'ignore'] }); }

// A fresh root, an intermediate it signs, and a leaf the intermediate signs -- a complete,
// throwaway CA hierarchy minted at test time (nothing committed, no real CA's key involved).
function makeChain(dir, cn) {
  const p = (n) => path.join(dir, n);
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', `/CN=${cn} root`, '-keyout', p('root.key'), '-out', p('root.crt')]);
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${cn} intermediate`, '-keyout', p('int.key'), '-out', p('int.csr')]);
  fs.writeFileSync(p('int.ext'), 'basicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign\n');
  openssl(['x509', '-req', '-in', p('int.csr'), '-CA', p('root.crt'), '-CAkey', p('root.key'), '-CAcreateserial', '-days', '2', '-extfile', p('int.ext'), '-out', p('int.crt')]);
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', p('leaf.key'), '-out', p('leaf.csr')]);
  fs.writeFileSync(p('leaf.ext'), 'subjectAltName=DNS:localhost\n');
  openssl(['x509', '-req', '-in', p('leaf.csr'), '-CA', p('int.crt'), '-CAkey', p('int.key'), '-CAcreateserial', '-days', '2', '-extfile', p('leaf.ext'), '-out', p('leaf.crt')]);
  return {
    root: fs.readFileSync(p('root.crt'), 'utf8'),
    leafKey: fs.readFileSync(p('leaf.key'), 'utf8'),
    // leaf + intermediate only: the root is withheld, exactly like the real-world chain this fixes
    cert: fs.readFileSync(p('leaf.crt'), 'utf8') + fs.readFileSync(p('int.crt'), 'utf8'),
  };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function getWithAgent(url, agent) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

await suite('toolchain certificate chain fallback', async (t) => {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { t.log('no openssl here: skipped'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64chain-'));
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 's64chain-other-'));
  let server;
  try {
    const chain = makeChain(dir, 'studio64 test');
    server = https.createServer({ key: chain.leafKey, cert: chain.cert }, (req, res) => res.end('ok'));
    const port = await listen(server);
    const url = `https://localhost:${port}/`;

    const plainError = await fetch(url).then(() => null, (e) => e);
    t.must('a plain request fails on the incomplete chain', !!plainError);
    t.check('the failure is a chain-completion error (isCertChainError)', isCertChainError(plainError));

    // A root with no relation to this chain: the gate must fail closed.
    const stranger = makeChain(otherDir, 'unrelated');
    const noMatch = await extraTrustedCAs(url, [new X509Certificate(stranger.root)]);
    t.check('an unrelated root yields no extra CAs', noMatch === null);

    // The genuine signer: the gate must find exactly the intermediate the server sent.
    const found = await extraTrustedCAs(url, [new X509Certificate(chain.root)]);
    t.must('the genuine root yields one extra CA', Array.isArray(found) && found.length === 1);
    t.check('the extra CA is the intermediate, not the leaf', new X509Certificate(found[0]).subject.includes('studio64 test intermediate'));

    // And trusting it (alongside the root that signed it -- tls.rootCertificates' role in
    // downloadWithExtraCAs) is enough to actually complete a request against this server.
    const res = await getWithAgent(url, new https.Agent({ ca: [chain.root, ...found] }));
    t.check('trusting the found intermediate (with its root) completes the request', res.status === 200 && res.body === 'ok');
  } finally {
    server?.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(otherDir, { recursive: true, force: true });
  }
});
