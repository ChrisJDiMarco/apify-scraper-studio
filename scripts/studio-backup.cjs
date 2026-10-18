#!/usr/bin/env node
'use strict';
// A consistent backup of the browser studio's data folder, while the server runs or after it stopped:
//
//   node scripts/studio-backup.cjs [--data <dir>] [--out <dir>] [--keep <n>] [--dir]
//     --data  the studio data folder (default STUDIO_DATA_DIR, else ~/.scraper-studio-web)
//     --out   where backups go (default STUDIO_BACKUP_DIR, else ./studio-backups)
//     --keep  keep only the newest n backups in --out (default STUDIO_BACKUP_KEEP; unset keeps all)
//     --dir   leave a plain folder instead of a .tar.gz
//
// The studio writes each file whole (a temporary file renamed into place), never in pieces, so one file is never torn.
// Files can still change between each other while the server runs, so the copy is repeated until a pass finds nothing
// changed (or five passes), and the manifest says whether it settled. For a guaranteed point-in-time copy, stop the
// server first or take a filesystem snapshot (LVM, ZFS, an EBS or persistent-disk snapshot).
//
// Left out: the upload/download area (web-transfers), the data-folder lock, temporary files, the restore script's
// staging folders, symbolic links and sockets. The secrets (STUDIO_SECRET_KEY) are not in the data folder: keep the
// secrets file with the backups, or the saved keys in a restored folder can't be read.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const FORMAT = 'scraper-studio-backup';
const FORMAT_VERSION = 1;
const PREFIX = 'scraper-studio-backup-';
const MAX_PASSES = 5;
const SKIP_NAMES = new Set(['.studio-owner.json', '.studio-owner-recovery']);
const SKIP_PATTERN = /(?:\.tmp|\.beat)$|^\.studio-ready-|^\.studio-healthz/;
const SKIP_TOP = /^(?:web-transfers|\.pre-restore-.*|\.restore-.*)$/;
// On Windows, Windows' own tar (bsdtar, in System32 since Windows 10 1803) by its full path: a bare "tar" is looked up in
// the working folder before PATH, and Git Bash puts GNU tar first on PATH, which reads C:\… in -f as a remote host.
const tarCommand = (platform = process.platform, env = process.env) => (platform === 'win32' ? path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar');
const TAR = tarCommand();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir' || arg === '--yes' || arg === '--force' || arg === '--help' || arg === '-h') { args[arg.replace(/^-+/, '')] = true; continue; }
    const match = arg.match(/^--([a-z-]+)(?:=(.*))?$/); if (!match) throw new Error(`Unknown argument: ${arg}`);
    args[match[1]] = match[2] !== undefined ? match[2] : argv[++i];
    if (args[match[1]] === undefined) throw new Error(`--${match[1]} needs a value.`);
  }
  return args;
}
const defaultDataDir = () => path.resolve(process.env.STUDIO_DATA_DIR || path.join(os.homedir(), '.scraper-studio-web'));
const stamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-'); // 2026-10-17T13-24-05-123Z: sortable, no colons
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const appVersion = () => { try { return require('../package.json').version || ''; } catch (_) { return ''; } };

// Every regular file under `root` the backup keeps, as relative POSIX paths → { size, mtimeMs }.
function listFiles(root, { exclude = [] } = {}) {
  const files = new Map(); const skipped = [];
  const excluded = exclude.map((dir) => path.resolve(dir));
  const walk = (dir, rel) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name); const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if ((!rel && SKIP_TOP.test(entry.name)) || SKIP_NAMES.has(entry.name) || SKIP_PATTERN.test(entry.name) || excluded.some((target) => full === target || full.startsWith(target + path.sep))) continue;
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) { skipped.push(relPath); continue; }
      if (entry.isDirectory()) { walk(full, relPath); continue; }
      try { const stat = fs.statSync(full); files.set(relPath, { size: stat.size, mtimeMs: stat.mtimeMs }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
  walk(root, '');
  return { files, skipped };
}
// Copies one file, again if it changed while being copied. Returns its { size, mtimeMs }, or null if it vanished.
function copyStable(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 5; attempt++) {
    let before; try { before = fs.statSync(source); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try { fs.copyFileSync(source, target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const after = fs.statSync(source);
    if (after.size === before.size && after.mtimeMs === before.mtimeMs) { fs.chmodSync(target, 0o600); return { size: after.size, mtimeMs: after.mtimeMs }; }
  }
  const stat = fs.statSync(source); fs.chmodSync(target, 0o600); return { size: stat.size, mtimeMs: stat.mtimeMs, moving: true };
}
const ownerLock = () => require('../src/main/studio-owner-lock');
// Whether a server holds the folder: 'running', 'stopped', 'recent' (a server in another container or on another
// machine refreshed its lock within the last two minutes: running, or only just stopped) or 'unknown' (unreadable lock).
function serverState(dataDir) {
  const { state } = ownerLock().inspectOwnerLock(path.join(dataDir, 'content-studio'));
  return { live: 'running', held: 'running', unsure: 'recent', unreadable: 'unknown' }[state] || 'stopped';
}
function readVersions(dataDir) {
  const read = (rel) => { try { const value = JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8')).version; return Number.isInteger(value) ? value : null; } catch (_) { return null; } };
  return { team: read('content-studio/team.json'), contentState: read('content-studio/state.json') };
}

function backup({ dataDir = defaultDataDir(), outDir = process.env.STUDIO_BACKUP_DIR || path.resolve('studio-backups'), keep = process.env.STUDIO_BACKUP_KEEP, archive = true, now = new Date(), log = (line) => console.log(line) } = {}) {
  dataDir = path.resolve(dataDir); outDir = path.resolve(outDir);
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) throw new Error(`No studio data folder at ${dataDir}. Pass --data or set STUDIO_DATA_DIR.`);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  // Built in a hidden work folder (<out>/.partial-<name>/<name>/{manifest.json,data/}), then archived or moved into place.
  const name = `${PREFIX}${stamp(now)}`; const work = path.join(outDir, `.partial-${name}`); const top = path.join(work, name); const dataCopy = path.join(top, 'data');
  fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(dataCopy, { recursive: true, mode: 0o700 });
  const exclude = [outDir, process.env.STUDIO_TRANSFER_DIR].filter(Boolean);
  const running = serverState(dataDir);
  try {
    // Copy everything, then copy again whatever changed meanwhile, until a pass finds nothing new.
    const copied = new Map(); let settled = false; let passes = 0; let skipped = [];
    for (; passes < MAX_PASSES && !settled; passes++) {
      const listing = listFiles(dataDir, { exclude }); skipped = listing.skipped; settled = passes > 0;
      for (const [rel, seen] of listing.files) {
        const previous = copied.get(rel);
        if (previous && previous.size === seen.size && previous.mtimeMs === seen.mtimeMs) continue;
        settled = false;
        const result = copyStable(path.join(dataDir, ...rel.split('/')), path.join(dataCopy, ...rel.split('/')));
        if (result) copied.set(rel, result); else { copied.delete(rel); fs.rmSync(path.join(dataCopy, ...rel.split('/')), { force: true }); }
      }
      for (const rel of [...copied.keys()]) if (!listing.files.has(rel)) { settled = false; copied.delete(rel); fs.rmSync(path.join(dataCopy, ...rel.split('/')), { force: true }); }
    }
    const files = [...copied.keys()].sort().map((rel) => {
      const file = path.join(dataCopy, ...rel.split('/')); const entry = { path: rel, size: fs.statSync(file).size, sha256: sha256(file) };
      if (rel.endsWith('.json')) { try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { entry.unreadableJson = true; } }
      return entry;
    });
    const manifest = { format: FORMAT, formatVersion: FORMAT_VERSION, createdAt: now.toISOString(), appVersion: appVersion(), server: running, settled, passes, versions: readVersions(dataCopy), files, skipped };
    fs.writeFileSync(path.join(top, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    let result;
    if (archive) {
      const file = path.join(outDir, `${name}.tar.gz`); const temp = path.join(work, `${name}.tar.gz`);
      // Run from the work folder (made by this script) with relative names.
      execFileSync(TAR, ['-czf', path.basename(temp), name], { cwd: work, stdio: ['ignore', 'ignore', 'pipe'] });
      fs.chmodSync(temp, 0o600); fs.renameSync(temp, file); result = file;
    } else {
      result = path.join(outDir, name); fs.renameSync(top, result);
    }
    fs.rmSync(work, { recursive: true, force: true });
    const removed = prune(outDir, keep);
    log(`Backed up ${files.length} files from ${dataDir} to ${result}${running === 'running' || running === 'recent' ? ' while the server was running' : ''}.`);
    if (!settled) log('Warning: files were still changing after five passes, so some may be from slightly different moments. For a point-in-time copy, stop the server or use a filesystem snapshot.');
    if (files.some((entry) => entry.unreadableJson)) log(`Warning: these files were already damaged in the data folder: ${files.filter((entry) => entry.unreadableJson).map((entry) => entry.path).join(', ')}.`);
    if (removed.length) log(`Removed ${removed.length} older ${removed.length === 1 ? 'backup' : 'backups'} (keeping ${Number(keep)}).`);
    log('Keep the secrets file (STUDIO_SECRET_KEY) with your backups: without it the saved keys in a restored folder can’t be read.');
    return { path: result, manifest, removed };
  } catch (error) { fs.rmSync(work, { recursive: true, force: true }); throw error; }
}
// Keeps the newest `keep` backups this script made in `outDir`.
function prune(outDir, keep) {
  const count = Number(keep); if (keep === undefined || keep === null || keep === '' || !Number.isInteger(count) || count < 1) return [];
  const ours = fs.readdirSync(outDir).filter((entry) => /^scraper-studio-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:\.tar\.gz)?$/.test(entry)).sort();
  const old = ours.slice(0, Math.max(0, ours.length - count));
  for (const entry of old) fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  return old;
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  if (args.help || args.h) { console.log('Usage: node scripts/studio-backup.cjs [--data <dir>] [--out <dir>] [--keep <n>] [--dir]'); return; }
  process.umask(0o077);
  try { backup({ dataDir: args.data, outDir: args.out, keep: args.keep, archive: !args.dir }); }
  catch (error) { console.error(`Backup failed: ${error.message}`); process.exit(1); }
}
if (require.main === module) main();
module.exports = { backup, prune, listFiles, parseArgs, serverState, sha256, defaultDataDir, stamp, tarCommand, TAR, FORMAT, FORMAT_VERSION, PREFIX };
