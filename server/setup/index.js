// The first-run setup, shared by the server (index.js serves web/setup.html until the game is
// built) and its routes (routes/setup.js).
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Setup } from './pipeline.js';
import { ROOT } from './env.js';

export const BOOT_ID = crypto.randomUUID().slice(0, 8);
export const SETUP_OFF = /^(0|off|false|no)$/i.test(process.env.STUDIO_SETUP || '');
export const setup = new Setup();

const SETUP_PAGE = path.join(ROOT, 'web', 'setup.html');

/** The page to send instead of the studio while it can't run yet, or null. */
export function setupGate(p) {
  if (SETUP_OFF) return null;
  if ((p === '/' || p === '/index.html') && !setup.ready()) return SETUP_PAGE;
  return null;
}

/**
 * Starts the server again (it loads the new object catalog). Under tools/start.mjs (npm start,
 * Docker) exit code 75 asks it to; a server started directly starts its own replacement.
 */
export function restartServer(flush) {
  setTimeout(() => {
    try { flush?.(); } catch { /* nothing to save */ }
    if (process.env.STUDIO_SUPERVISED) process.exit(75);
    const child = spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'inherit', env: { ...process.env, STUDIO_RESTART_WAIT: '1' } });
    child.unref();
    process.exit(0);
  }, 1200);
}
