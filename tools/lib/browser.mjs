// Finds a Chrome-family browser for the tools that render in the game (thumbnails, samples,
// tests): $CHROME, then Chrome / Chromium / Edge / Brave where each OS installs them, then
// Playwright's own Chromium (npx playwright install chromium).
import fs from 'node:fs';
import path from 'node:path';

function candidates() {
  const env = process.env;
  if (process.platform === 'darwin') {
    const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Brave Browser.app/Contents/MacOS/Brave Browser'];
    return [...apps.map((a) => `/Applications/${a}`), ...apps.map((a) => path.join(env.HOME || '', 'Applications', a))];
  }
  if (process.platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const rel = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe',
      'Chromium\\Application\\chrome.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'];
    return rel.flatMap((r) => roots.map((root) => path.join(root, r)));
  }
  return ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/usr/lib/chromium/chromium', '/usr/bin/microsoft-edge', '/usr/bin/brave-browser'];
}

/** The browser to drive, or null. */
export async function findChrome() {
  if (process.env.CHROME) return fs.existsSync(process.env.CHROME) ? process.env.CHROME : null;
  for (const c of candidates()) if (fs.existsSync(c)) return c;
  try {
    const { chromium } = await import('playwright');
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* playwright not installed */ }
  return null;
}

/** chromium.launch() with the found browser and software WebGL (works headless everywhere). */
export async function launchBrowser(options = {}) {
  const { chromium } = await import('playwright');
  const executablePath = await findChrome();
  if (!executablePath) {
    throw new Error('No Chrome, Chromium or Edge found. Install Google Chrome, or run "npx playwright install chromium", or set CHROME=/path/to/chrome.');
  }
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(options.args || [])];
  return chromium.launch({ ...options, executablePath, args: [...new Set(args)] });
}
