// Where the setup's build commands run: on this machine (Linux, macOS, Windows), or, on Windows when
// STUDIO_BUILD_HOST=wsl asks for it, inside WSL (the Windows Subsystem for Linux). The picture and
// sample steps always run here (Node + Chrome/Edge).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { IS_WIN, which, findPython } from './env.js';

/** C:\Users\me\studio64 → /mnt/c/Users/me/studio64; \\wsl.localhost\Ubuntu\home\me → /home/me */
export function winToWsl(p) {
  const abs = path.win32.resolve(p);
  const unc = abs.match(/^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+(\\.*)?$/i);
  if (unc) return (unc[1] || '/').replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\\?(.*)$/);
  if (!m) return abs.replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`.replace(/\/$/, '');
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export class Host {
  constructor(kind) { this.kind = kind; }

  /**
   * native (here: Linux, macOS and Windows; on Windows with w64devkit's gcc and make), or, when
   * asked with STUDIO_BUILD_HOST=wsl on Windows, wsl (a working WSL distribution) or none (no WSL).
   */
  static detect() {
    if (!IS_WIN || !/^wsl$/i.test(process.env.STUDIO_BUILD_HOST || '')) return new Host('native');
    if (!which('wsl')) return new Host('none');
    const r = spawnSync('wsl.exe', ['-e', 'true'], { timeout: 60000, windowsHide: true });
    return new Host(r.status === 0 ? 'wsl' : 'none');
  }

  get wsl() { return this.kind === 'wsl'; }

  /** A path of this machine as the build commands see it. */
  p(file) { return this.wsl ? winToWsl(file) : file; }

  /** [command, args] that runs a program with extra environment variables on the build host. */
  cmd(program, args = [], env = {}) {
    if (!this.wsl) return [program, args, env];
    const pairs = Object.entries({ PYTHONUNBUFFERED: '1', ...env }).map(([k, v]) => `${k}=${v}`);
    return ['wsl.exe', ['-e', 'env', ...pairs, program, ...args], {}];
  }

  /** [command, args] that runs a bash script on the build host. */
  bash(script, env = {}) {
    const exports = Object.entries(env).map(([k, v]) => `export ${k}=${q(v)}; `).join('');
    if (this.wsl) return ['wsl.exe', ['-e', 'bash', '-c', exports + script], {}];
    return [which('bash') || 'bash', ['-c', exports + script], {}];
  }

  /** The Python that runs the tools: python3 inside WSL, else the one found here. */
  python() {
    if (this.wsl) return { cmd: 'python3', pre: [], version: 'WSL' };
    return findPython();
  }
}

export { q as shellQuote };
