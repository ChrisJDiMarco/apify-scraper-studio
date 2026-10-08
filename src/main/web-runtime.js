'use strict';
// The Electron main-process APIs that src/main/index.js uses, implemented for the browser-served
// studio. Under STUDIO_RUNTIME=web the same main process runs on a server: its IPC handlers become
// /api/rpc calls (see studio-server.js), file dialogs read browser uploads and turn saves into
// downloads, "open" and "reveal" offer the file as a download, links open in the browser, and
// secrets are encrypted with STUDIO_SECRET_KEY instead of the macOS keychain.
const { AsyncLocalStorage } = require('async_hooks');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const calls = new AsyncLocalStorage(); // the RPC call a dialog or shell request belongs to
const handlers = new Map();
const broadcasts = new EventEmitter(); broadcasts.setMaxListeners(0);
const settings = { dataDir: '', secretKey: '', transferDir: '' };
const MIN_SECRET_LENGTH = 32;
const CIPHER_TAG = Buffer.from('sw1');

function configure({ dataDir, secretKey, transferDir } = {}) {
  if (!dataDir) throw new Error('Set STUDIO_DATA_DIR to the folder that holds the studio data.');
  if (typeof secretKey !== 'string' || secretKey.length < MIN_SECRET_LENGTH) throw new Error(`Set STUDIO_SECRET_KEY to a random value of at least ${MIN_SECRET_LENGTH} characters; it encrypts saved keys.`);
  settings.dataDir = path.resolve(dataDir); settings.secretKey = secretKey; settings.transferDir = path.resolve(transferDir || path.join(settings.dataDir, 'web-transfers'));
  fs.mkdirSync(settings.dataDir, { recursive: true }); fs.mkdirSync(settings.transferDir, { recursive: true, mode: 0o700 });
  return { ...settings };
}

// ── app ──────────────────────────────────────────────────────────────────────────────────────────
const paths = new Map(); let appName = 'Scraper Studio';
const app = Object.assign(new EventEmitter(), {
  isPackaged: true, // behave like the installed app: no dev-only local keys, owner lock and data path rules apply
  getName: () => appName,
  setName: (name) => { appName = String(name); },
  getVersion: () => require('../../package.json').version,
  getAppPath: () => path.join(__dirname, '..', '..'),
  getPath(name) {
    if (paths.has(name)) return paths.get(name);
    if (name === 'userData') return settings.dataDir;
    if (name === 'appData') return path.dirname(settings.dataDir);
    if (['documents', 'downloads', 'desktop'].includes(name)) return calls.getStore()?.saveDir || settings.transferDir;
    if (name === 'temp') return os.tmpdir();
    if (name === 'home') return os.homedir();
    return settings.dataDir;
  },
  setPath: (name, value) => { paths.set(name, value); },
  whenReady: () => Promise.resolve(),
  isReady: () => true,
  requestSingleInstanceLock: () => true, // the studio owner lock still guards the data folder
  setAboutPanelOptions: () => {},
  focus: () => {},
  quit: () => {}, // the server process decides when to stop
  exit: (code = 0) => process.exit(code),
});

// ── windows ──────────────────────────────────────────────────────────────────────────────────────
// There is no window on a server. What the main process sends to "its window" goes to every
// connected browser through /api/events instead.
const windows = new Set();
class BrowserWindow extends EventEmitter {
  constructor() {
    super();
    this.webContents = Object.assign(new EventEmitter(), {
      send: (channel, payload) => broadcasts.emit(channel, payload),
      session: { setPermissionRequestHandler: () => {} },
      setWindowOpenHandler: () => {},
    });
    windows.add(this);
  }
  loadURL() { return Promise.resolve(); }
  loadFile() { return Promise.resolve(); }
  show() {} focus() {} restore() {}
  isMinimized() { return false; }
  isDestroyed() { return false; }
  static getAllWindows() { return [...windows]; }
  static getFocusedWindow() { return [...windows][0] || null; }
}
const Menu = { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) };
const ipcMain = { handle: (channel, handler) => { handlers.set(channel, handler); }, removeHandler: (channel) => { handlers.delete(channel); }, on: () => {} };

// ── secrets ──────────────────────────────────────────────────────────────────────────────────────
const cipherKey = () => crypto.createHash('sha256').update(`scraper-studio-web\0${settings.secretKey}`).digest();
const safeStorage = {
  isEncryptionAvailable: () => settings.secretKey.length >= MIN_SECRET_LENGTH,
  encryptString(text) {
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
    const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    return Buffer.concat([CIPHER_TAG, iv, cipher.getAuthTag(), body]);
  },
  decryptString(buffer) {
    const value = Buffer.from(buffer);
    // Keys saved by the Mac app are keychain-encrypted and can't be read here; the caller treats them as unset.
    if (value.length < 31 || !value.subarray(0, 3).equals(CIPHER_TAG)) throw new Error('This key was saved by another installation.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey(), value.subarray(3, 15)); decipher.setAuthTag(value.subarray(15, 31));
    return Buffer.concat([decipher.update(value.subarray(31)), decipher.final()]).toString('utf8');
  },
};

// ── files: dialogs and shell ─────────────────────────────────────────────────────────────────────
const inside = (target, root) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
const safeName = (value) => path.basename(String(value || 'download')).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 180) || 'download';
// "Open" and "Show in Finder" hand the file to the browser as a download. Only files in the studio's own
// data or transfer folders can leave the server.
function offerFile(target) {
  const call = calls.getStore(); if (!call) return 'This action needs the studio page.';
  let real; try { real = fs.realpathSync(String(target || '')); } catch { return 'That file no longer exists.'; }
  if (![settings.dataDir, settings.transferDir].some((root) => inside(real, fs.realpathSync(root)))) return 'That file is outside the studio folder.';
  const stat = fs.statSync(real);
  if (stat.isDirectory()) {
    // An export folder (anything inside an "exports" folder) downloads as one .zip; other folders stay put.
    const parts = path.relative(fs.realpathSync(settings.dataDir), real).split(path.sep);
    if (!call.saveDir || inside(real, fs.realpathSync(settings.dataDir)) === false || !parts.slice(0, -1).includes('exports')) return 'Folders stay on the server in the web version. Open a file to download it.';
    call.files.push(zipFolder(real, call.saveDir)); return '';
  }
  call.files.push(real); return '';
}
const MAX_ZIP_BYTES = 300 * 1024 * 1024;
function zipFolder(folder, saveDir) {
  const entries = []; let total = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { const data = fs.readFileSync(full); total += data.length; if (total > MAX_ZIP_BYTES) throw new Error('This export is too large to download from the browser. Ask for it from the studio server.'); entries.push({ name: path.relative(folder, full).split(path.sep).join('/'), data }); }
    }
  };
  walk(folder);
  const target = path.join(saveDir, `${safeName(path.basename(folder))}.zip`);
  fs.writeFileSync(target, require('../shared/xlsx-writer').zip(entries, new Date()));
  return target;
}
const dialog = {
  showOpenDialog(_window, options = {}) {
    const uploads = calls.getStore()?.uploads || [];
    if (!uploads.length) return Promise.resolve({ canceled: true, filePaths: [] }); // the person closed the file picker
    const multiple = Array.isArray(options.properties) && options.properties.includes('multiSelections');
    return Promise.resolve({ canceled: false, filePaths: (multiple ? uploads : uploads.slice(0, 1)).map((upload) => upload.path) });
  },
  showSaveDialog(_window, options = {}) {
    const call = calls.getStore(); if (!call?.saveDir) return Promise.resolve({ canceled: true });
    const filePath = path.join(call.saveDir, safeName(options.defaultPath)); call.saves.push(filePath);
    return Promise.resolve({ canceled: false, filePath });
  },
  showMessageBoxSync: (_window, options = {}) => options.cancelId ?? 0,
  showMessageBox: (_window, options = {}) => Promise.resolve({ response: options.cancelId ?? 0 }),
  showErrorBox: (title, message) => { console.error(`${title}: ${message}`); },
};
const shell = {
  openExternal(url) { const call = calls.getStore(); if (call) call.opens.push(String(url)); return Promise.resolve(); },
  openPath: (target) => Promise.resolve(offerFile(target)),
  showItemInFolder: (target) => { offerFile(target); },
};

const electron = { app, BrowserWindow, Menu, ipcMain, safeStorage, dialog, shell };
const autoUpdater = { on: () => {}, setFeedURL: () => {}, checkForUpdates: () => Promise.resolve(null), autoDownload: false, autoInstallOnAppQuit: false };

// Runs one main-process handler for a browser request. Returns what the browser must do afterwards:
// downloads (saved or opened files) and links to open.
async function invoke(channel, payload, { uploads = [], saveDir = '' } = {}) {
  const handler = handlers.get(channel); if (!handler) throw new Error('Unknown studio action.');
  const call = { uploads, saveDir, saves: [], files: [], opens: [] };
  const result = await calls.run(call, () => handler({ sender: null, senderFrame: null }, payload));
  const saved = call.saves.filter((file) => fs.existsSync(file));
  return { result, files: [...new Set([...saved, ...call.files])], opens: call.opens };
}

module.exports = {
  configure, electron, autoUpdater, invoke, settings,
  channels: () => [...handlers.keys()],
  onBroadcast: (channel, listener) => { broadcasts.on(channel, listener); return () => broadcasts.off(channel, listener); },
  shutdown: () => app.emit('quit'),
};
