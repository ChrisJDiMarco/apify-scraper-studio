import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// The desktop main process (src/main/index.js) loaded as the Windows app (process.platform 'win32') and as the Mac app,
// with Electron replaced by recorders and Codex by a fixture CLI: the window, its menu, closing it while work runs, a
// Windows sign-out, the navigation guard, Ask AI's edition and the owner lock at launch. Nothing paid is called.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ANSWER = { answer: 'Open **Trends** in the sidebar.', pages: [], followUps: [], image: { create: false, title: '', prompt: '', size: '1536x1024' }, actions: [], show: { autoStart: false, steps: [] }, lookups: [] };
// studio-host's own helpers would look for CLIs on a real Windows PATH or start real processes (the login-shell PATH
// probe, taskkill); here every CLI is the fixture below.
const studioHost = mainRequire('./studio-host');
const hostForTests = {
  ...studioHost, loadLoginShellPath: () => Promise.resolve(''),
  ...(studioHost.resolveCli ? { resolveCli: (name) => ({ command: name, prefixArgs: [], env: {} }) } : {}),
  ...(studioHost.killProcessTree ? { killProcessTree: (child) => { child.kill(); } } : {}),
};
const loaded = [];
afterEach(() => {
  for (const h of loaded.splice(0)) {
    h.release(); h.app.emit('before-quit', { preventDefault: () => {} }); h.app.emit('quit');
    fs.rmSync(h.root, { recursive: true, force: true });
  }
});

async function load({ platform = 'win32', packaged = false, choice = 0, seed } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'win-main-app-'));
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ settings: { aiProvider: 'codex' } }));
  seed?.(root);
  const handlers = new Map(); const windows = []; const templates = []; const calls = []; const held = [];
  const h = { root, handlers, windows, templates, calls, choice, hold: false, exitError: null };
  // Codex: status checks answer at once; an answer is written where --output-last-message says, unless held.
  function spawn(command, args = [], options = {}) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const call = { command, args, options, stdin: '' }; calls.push(call);
    child.stdin = new Writable({ write(chunk, _encoding, done) { call.stdin += chunk.toString(); done(); } });
    child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
    if (args.includes('--help')) { queueMicrotask(() => { child.stdout.write('Options:\n      --ephemeral\n'); child.emit('close', 0, null); }); return child; }
    if (!args.includes('--output-last-message')) { queueMicrotask(() => { child.stdout.write(args.includes('status') ? 'Logged in using ChatGPT\n' : 'codex-cli 0.156.0\n'); child.emit('close', 0, null); }); return child; }
    const answer = () => { try { fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(ANSWER)); } catch (_) { /* stopped */ } child.emit('close', 0, null); };
    if (h.hold) held.push(answer); else queueMicrotask(answer);
    return child;
  }
  h.release = () => { for (const answer of held.splice(0)) answer(); };
  const exited = new Error('fixture-app-exited');
  const app = h.app = Object.assign(new EventEmitter(), {
    isPackaged: packaged, getName: () => 'Golden Thread', setName: () => {}, setPath: () => {}, getPath: () => root, getVersion: () => 'test',
    requestSingleInstanceLock: () => true, hasSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    setAboutPanelOptions: () => {}, showAboutPanel: vi.fn(), setAppUserModelId: vi.fn(), quit: vi.fn(), exit: vi.fn(() => { throw exited; }),
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; windows.push(this);
      this.webContents = Object.assign(new EventEmitter(), { send: () => {}, session: { setPermissionRequestHandler: () => {} }, setWindowOpenHandler: () => {} });
    }
    loadURL() { return Promise.resolve(); } loadFile(file) { this.loaded = file; return Promise.resolve(); } isDestroyed() { return false; } show() {}
    static getAllWindows() { return windows; } static getFocusedWindow() { return null; }
  }
  h.dialog = { showMessageBoxSync: vi.fn(() => h.choice), showErrorBox: vi.fn() };
  h.nativeTheme = { themeSource: 'system' };
  const electron = { app, BrowserWindow, Menu: { setApplicationMenu: () => {}, buildFromTemplate: (template) => { templates.push(template); return {}; } }, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: () => Promise.resolve() }, dialog: h.dialog, nativeTheme: h.nativeTheme };
  loaded.push(h);
  try {
    vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
      require: (name) => {
        if (name === 'electron') return electron;
        if (name === 'electron-updater') return {};
        if (name === 'child_process') return { spawn };
        if (name === './studio-host') return hostForTests;
        if (name === 'os') return { ...os, tmpdir: () => path.join(root, 'tmp') }; // the startup sweep of old temp folders stays in this test's folder
        return mainRequire(name);
      },
      process: { pid: process.pid, platform, env: {}, argv: [] },
      __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    }, { filename: mainPath });
  } catch (error) { if (error !== exited) throw error; h.exitError = error; return h; }
  await sleep(20); // whenReady: the menu and the window exist
  h.window = windows[0];
  return h;
}
async function waitFor(check) { for (let i = 0; i < 200; i++) { if (check()) return; await sleep(5); } throw new Error('Timed out waiting.'); }
// Ask AI on the Codex route, held until released, so an AI request is in progress (activeWorkSummary). Returns { reply }:
// the reply itself settles only when the answer is released or stopped.
async function askAndHold(h) {
  h.hold = true;
  const reply = h.handlers.get('help:ask')(null, { question: 'Where are my trends?', page: { id: 'simple-mode', label: 'Simple mode', layout: 'simple' } }).catch((error) => ({ error }));
  await waitFor(() => h.calls.some((call) => call.args.includes('--output-last-message')));
  return { reply };
}
const closeEvent = () => ({ preventDefault: vi.fn() });
const roles = (template) => template.map((item) => item.role || item.label);

describe('the Windows app window and menu', () => {
  it('opens with the system frame, the menu bar shown by Alt, a minimum that snaps to half a laptop screen, and a light title bar', async () => {
    const h = await load();
    expect(h.window.options).not.toHaveProperty('titleBarStyle');
    expect(h.window.options).toMatchObject({ autoHideMenuBar: true, minWidth: 560, minHeight: 560, title: 'Golden Thread' });
    expect(h.nativeTheme.themeSource).toBe('light');
    expect(h.app.setAppUserModelId).toHaveBeenCalledWith(pkg.build.appId);
    expect(h.window.loaded).toBe(path.resolve('src/renderer/index.html'));
  });

  it('has About in a Help menu, and keeps the developer View menu only for a dev run', async () => {
    const dev = await load();
    const menu = dev.templates.at(-1);
    expect(roles(menu)).toEqual(['fileMenu', 'editMenu', 'viewMenu', 'windowMenu', 'help']);
    const about = menu.at(-1).submenu[0];
    expect(about.label).toBe('About Golden Thread');
    about.click(); expect(dev.app.showAboutPanel).toHaveBeenCalledOnce();
    const installed = await load({ packaged: true });
    const view = installed.templates.at(-1).find((item) => item.label === 'View');
    expect(view.submenu.map((item) => item.role || item.type)).toEqual(['resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen']);
    expect(roles(installed.templates.at(-1))).toEqual(['fileMenu', 'editMenu', 'View', 'windowMenu', 'help']);
  });

  it('keeps the Mac window and menu as they were', async () => {
    const h = await load({ platform: 'darwin', packaged: true });
    expect(h.window.options).toMatchObject({ titleBarStyle: 'hiddenInset', minWidth: 720 });
    expect(h.window.options).not.toHaveProperty('autoHideMenuBar');
    expect(h.nativeTheme.themeSource).toBe('system');
    expect(h.app.setAppUserModelId).not.toHaveBeenCalled();
    expect(roles(h.templates.at(-1))).toEqual(['Golden Thread', 'editMenu', 'viewMenu', 'windowMenu']);
    expect(h.window.listenerCount('close')).toBe(0); // closing the Mac window keeps the app and its work running
    expect(h.window.listenerCount('session-end')).toBe(0);
  });

  it('gives Windows the installer’s AppUserModelID, written as a literal that matches build.appId', () => {
    const source = fs.readFileSync(mainPath, 'utf8');
    const ids = [...source.matchAll(/setAppUserModelId\??\.?\('([^']+)'\)/g)].map((match) => match[1]);
    expect(ids).toEqual([pkg.build.appId]);
  });
});

describe('closing the Windows window while work is running', () => {
  it('asks first, titled Golden Thread, and Keep working leaves the window open', async () => {
    const h = await load();
    const idle = closeEvent(); h.window.emit('close', idle);
    expect(idle.preventDefault).not.toHaveBeenCalled(); expect(h.dialog.showMessageBoxSync).not.toHaveBeenCalled(); // nothing running: no question
    const { reply } = await askAndHold(h);
    const event = closeEvent(); h.window.emit('close', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(h.dialog.showMessageBoxSync).toHaveBeenCalledOnce();
    const [parent, options] = h.dialog.showMessageBoxSync.mock.calls[0];
    expect(parent).toBe(h.window);
    expect(options).toMatchObject({ type: 'warning', title: 'Golden Thread', buttons: ['Keep working', 'Quit anyway'], defaultId: 0, cancelId: 0, noLink: true, message: 'Something is still running', detail: expect.stringContaining('Ask AI answer') });
    h.release(); expect(await reply).toMatchObject({ answer: 'Open **Trends** in the sidebar.' }); // the work carried on
  });

  it('lets the window close on Quit anyway, without asking again when the app then quits', async () => {
    const h = await load({ choice: 1 });
    const { reply } = await askAndHold(h);
    const event = closeEvent(); h.window.emit('close', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    const quitting = closeEvent(); h.app.emit('before-quit', quitting); // window-all-closed → app.quit()
    expect(quitting.preventDefault).not.toHaveBeenCalled();
    expect(h.dialog.showMessageBoxSync).toHaveBeenCalledOnce();
    expect(await reply).toHaveProperty('error'); // the AI request was stopped
  });

  it('asks from Quit with the window as the parent, titled Golden Thread', async () => {
    const h = await load();
    const { reply } = await askAndHold(h);
    const event = closeEvent(); h.app.emit('before-quit', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(h.dialog.showMessageBoxSync).toHaveBeenCalledWith(h.window, expect.objectContaining({ title: 'Golden Thread', message: 'Something is still running' }));
    h.release(); await reply;
  });
});

describe('a Windows sign-out, restart or shutdown', () => {
  it('stops the work and frees the data folder when the session ends', async () => {
    const h = await load();
    const lock = path.join(h.root, 'content-studio', '.studio-owner.json');
    expect(fs.existsSync(lock)).toBe(true);
    const { reply } = await askAndHold(h);
    h.window.emit('session-end');
    expect(fs.existsSync(lock)).toBe(false);
    expect(await reply).toHaveProperty('error'); // stopped, not left running
    const event = closeEvent(); h.window.emit('close', event); // no question while the session ends
    expect(event.preventDefault).not.toHaveBeenCalled(); expect(h.dialog.showMessageBoxSync).not.toHaveBeenCalled();
  });
});

describe('temp folders an AI CLI still held when its call ended', () => {
  // Windows keeps a running program's folder busy, so removeQuietly leaves it; the next launch removes those a day old.
  const twoDaysAgo = (Date.now() - 2 * 86400000) / 1000;
  const seed = (root) => {
    const made = {};
    for (const [key, parts, old] of [
      ['codexOld', ['tmp', 'studio-codex-old'], true], ['codexNew', ['tmp', 'studio-codex-new'], false], ['otherOld', ['tmp', 'someone-else-old'], true],
      ['helpOld', ['help', 'calls', 'call-old'], true], ['helpNew', ['help', 'calls', 'call-new'], false],
      ['testOld', ['content-studio', 'prompt-tests', 'ptest-old'], true], ['testOtherOld', ['content-studio', 'prompt-tests', 'kept-old'], true],
    ]) {
      const dir = made[key] = path.join(root, ...parts); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'output.raw.json'), '{}');
      if (old) fs.utimesSync(dir, twoDaysAgo, twoDaysAgo);
    }
    return made;
  };

  it('removes only the studio’s own folders a day old when the Windows app starts', async () => {
    let made;
    const h = await load({ seed: (root) => { made = seed(root); } });
    await waitFor(() => !fs.existsSync(made.codexOld) && !fs.existsSync(made.helpOld) && !fs.existsSync(made.testOld));
    for (const kept of [made.codexNew, made.otherOld, made.helpNew, made.testOtherOld]) expect(fs.existsSync(kept), kept).toBe(true);
    expect(h.exitError).toBeNull();
  });

  it('leaves them alone on the Mac, where removal never waits', async () => {
    let made;
    await load({ platform: 'darwin', seed: (root) => { made = seed(root); } });
    for (const kept of Object.values(made)) expect(fs.existsSync(kept), kept).toBe(true);
  });
});

describe('the navigation guard', () => {
  it('allows only the studio’s own page among file: URLs', async () => {
    for (const platform of ['win32', 'darwin']) {
      const h = await load({ platform });
      const navigate = (url) => { const event = closeEvent(); h.window.webContents.emit('will-navigate', event, url); return event.preventDefault.mock.calls.length > 0; };
      expect(navigate('file://server/share/x.html'), platform).toBe(true); // a UNC share: blocked
      expect(navigate('file:///etc/x.html'), platform).toBe(true);
      expect(navigate('https://example.com/'), platform).toBe(true);
      expect(navigate(pathToFileURL(path.resolve('src/renderer/index.html')).href), platform).toBe(false);
      expect(navigate(`${pathToFileURL(path.resolve('src/renderer/index.html')).href}#/trends`), platform).toBe(false);
    }
  });
});

describe('Ask AI on the Windows app', () => {
  it('tells the AI it runs in the Windows app, and the Mac app on the Mac', async () => {
    for (const [platform, edition] of [['win32', 'Windows app'], ['darwin', 'Mac app']]) {
      const h = await load({ platform });
      const reply = await h.handlers.get('help:ask')(null, { question: 'Where are my trends?', page: { id: 'simple-mode', label: 'Simple mode', layout: 'simple' } });
      expect(reply.answer).toBe('Open **Trends** in the sidebar.');
      const codex = h.calls.find((call) => call.args.includes('--output-last-message'));
      expect(codex.stdin, platform).toMatch(new RegExp(`"edition":\\s*"${edition}"`));
    }
  });
});

describe('the owner lock at launch', () => {
  // What a desktop app left behind at a crash or a Windows restart: its PID now names a live process (vitest's parent).
  const leftover = (root) => { fs.mkdirSync(path.join(root, 'content-studio'), { recursive: true }); fs.writeFileSync(path.join(root, 'content-studio', '.studio-owner.json'), JSON.stringify({ pid: process.ppid, nonce: 'before-restart', hostname: os.hostname(), desktop: true, heartbeatAt: Date.now() })); };
  const owner = (h) => JSON.parse(fs.readFileSync(path.join(h.root, 'content-studio', '.studio-owner.json'), 'utf8'));

  it('lets the installed app take over a lock an earlier installed app left, and marks its own', async () => {
    const h = await load({ packaged: true, seed: leftover });
    expect(h.exitError).toBeNull(); expect(h.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(owner(h)).toMatchObject({ pid: process.pid, desktop: true });
  });

  it('never lets a dev run take it, and says how to recover in plain words', async () => {
    const h = await load({ seed: leftover });
    expect(h.exitError).toBeTruthy(); expect(h.app.exit).toHaveBeenCalledWith(1);
    expect(h.dialog.showErrorBox).toHaveBeenCalledWith('Golden Thread is already open', expect.stringMatching(/^Golden Thread is already running, or it did not close cleanly\. If it is not running, delete .+\.studio-owner\.json and open it again\.$/));
    expect(owner(h).nonce).toBe('before-restart');
  });

  it('writes no desktop flag from a dev run', async () => {
    const h = await load();
    expect(owner(h)).toMatchObject({ pid: process.pid }); expect(owner(h)).not.toHaveProperty('desktop');
  });
});
