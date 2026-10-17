#!/usr/bin/env node
'use strict';
// Restores a backup made by scripts/studio-backup.cjs into the studio's data folder, with checks first:
//
//   node scripts/studio-restore.cjs --from <backup.tar.gz | backup folder> [--data <dir>] [--yes] [--force]
//     --from   the backup to restore
//     --data   the studio data folder (default STUDIO_DATA_DIR, else ~/.scraper-studio-web)
//     --yes    actually restore; without it the backup is only checked and nothing changes
//     --force  restore even though the data folder's lock looks held (only when you know no server uses the folder)
//
// It refuses while a server holds the data folder, checks every file against the manifest's checksums, refuses a
// backup from a newer studio than this one (its team file couldn't be read), and keeps the current data in
// <data>/.pre-restore-<time>/ so the restore can be undone. Everything happens inside the data folder, so it also works
// when that folder is a mounted volume (Docker's /data).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs, sha256, defaultDataDir, stamp, serverState, FORMAT, FORMAT_VERSION } = require('./studio-backup.cjs');

const SUPPORTED_TEAM_VERSION = (() => { try { return require('../src/main/team-store').TEAM_VERSION; } catch (_) { return null; } })();
const STAGING = /^\.(?:pre-restore|restore)-/;

// An archive may hold only plain files and folders with relative names, checked before anything is unpacked (a link
// inside it could otherwise point the unpacking outside the data folder).
function checkArchive(file) {
  const run = (flags) => execFileSync('tar', [flags, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).split('\n').filter(Boolean);
  const kinds = run('-tvzf').map((line) => line[0]);
  if (kinds.some((kind) => kind !== '-' && kind !== 'd')) throw new Error('The backup archive holds links or special files, so it wasn’t unpacked. Use an archive made by scripts/studio-backup.cjs.');
  const names = run('-tzf');
  if (names.some((name) => name.startsWith('/') || name.split('/').includes('..'))) throw new Error('The backup archive has files outside its own folder, so it wasn’t unpacked.');
}
// Restored files belong to whoever owns the data folder (the image's node user), even when this runs as root.
function chownTree(dir, uid, gid) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name); fs.lchownSync(full, uid, gid);
    if (entry.isDirectory()) chownTree(full, uid, gid);
  }
}
// Finds the backup's top folder (the one holding manifest.json) inside an extracted archive or a backup folder.
function backupRoot(dir) {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  const inner = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (inner.length === 1 && fs.existsSync(path.join(dir, inner[0].name, 'manifest.json'))) return path.join(dir, inner[0].name);
  throw new Error('This isn’t a studio backup: there is no manifest.json in it.');
}
// Checks the unpacked backup against its manifest. Returns the manifest; throws with every problem found.
function verify(root) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); } catch (_) { throw new Error('The backup’s manifest.json can’t be read.'); }
  if (manifest?.format !== FORMAT || !Number.isInteger(manifest.formatVersion)) throw new Error('This isn’t a studio backup (unknown manifest format).');
  if (manifest.formatVersion > FORMAT_VERSION) throw new Error(`This backup was made by a newer backup script (format ${manifest.formatVersion}). Restore it with that version.`);
  const problems = []; const listed = new Set();
  for (const entry of Array.isArray(manifest.files) ? manifest.files : []) {
    const rel = String(entry?.path || '');
    if (!rel || rel.startsWith('/') || rel.split('/').some((part) => part === '..' || part === '')) { problems.push(`unsafe path ${JSON.stringify(rel)}`); continue; }
    listed.add(rel);
    const file = path.join(root, 'data', ...rel.split('/'));
    let stat; try { stat = fs.lstatSync(file); } catch (_) { problems.push(`missing ${rel}`); continue; }
    if (!stat.isFile()) { problems.push(`not a file: ${rel}`); continue; }
    if (stat.size !== entry.size || sha256(file) !== entry.sha256) problems.push(`changed since the backup: ${rel}`);
  }
  // Nothing may be in the backup that the manifest doesn't list (or that isn't a plain file or folder).
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath);
      else if (!entry.isFile()) problems.push(`not a file: ${relPath}`);
      else if (!listed.has(relPath)) problems.push(`not in the manifest: ${relPath}`);
    }
  };
  if (fs.existsSync(path.join(root, 'data'))) walk(path.join(root, 'data'), ''); else problems.push('no data folder');
  const team = manifest.versions?.team;
  if (Number.isInteger(team) && Number.isInteger(SUPPORTED_TEAM_VERSION) && team > SUPPORTED_TEAM_VERSION) problems.push(`its team file is version ${team}, newer than this studio reads (${SUPPORTED_TEAM_VERSION}): update the studio first`);
  if (problems.length) throw new Error(`The backup didn’t pass its checks:\n- ${problems.slice(0, 20).join('\n- ')}${problems.length > 20 ? `\n- …and ${problems.length - 20} more` : ''}`);
  return manifest;
}

function restore({ from, dataDir = defaultDataDir(), yes = false, force = false, now = new Date(), log = (line) => console.log(line) } = {}) {
  if (!from) throw new Error('Name the backup with --from <backup.tar.gz or folder>.');
  const source = path.resolve(from); dataDir = path.resolve(dataDir);
  if (!fs.existsSync(source)) throw new Error(`No backup at ${source}.`);
  const running = fs.existsSync(dataDir) ? serverState(dataDir) : 'stopped';
  const lockFile = path.join(dataDir, 'content-studio', '.studio-owner.json');
  if (running !== 'stopped' && !force) throw new Error({ running: `A studio server is using ${dataDir}. Stop it first (docker compose stop studio, systemctl stop scraper-studio), then restore.`, recent: `A studio server in another container or on another machine used ${dataDir} in the last two minutes. Stop it, wait two minutes and try again, or run again with --force if you know it has stopped.` }[running] || `The data folder's lock (${lockFile}) can't be read. If no server uses the folder, run again with --force.`);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const when = stamp(now); const staging = path.join(dataDir, `.restore-${when}`);
  fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { mode: 0o700 });
  try {
    // Unpacked inside the data folder, so the final moves are renames on one filesystem.
    if (fs.statSync(source).isDirectory()) fs.cpSync(source, staging, { recursive: true, verbatimSymlinks: true });
    else { checkArchive(source); execFileSync('tar', ['-xzf', source, '-C', staging], { stdio: ['ignore', 'ignore', 'pipe'] }); }
    const root = backupRoot(staging); const manifest = verify(root);
    log(`Checked ${manifest.files.length} files from a backup made ${manifest.createdAt}${manifest.appVersion ? ` by studio ${manifest.appVersion}` : ''}${['running', 'recent'].includes(manifest.server) ? ' while the server was running' : ''}.`);
    if (manifest.settled === false) log('Note: files were still changing while that backup was made, so some may be from slightly different moments.');
    if (!yes) { fs.rmSync(staging, { recursive: true, force: true }); log('Nothing was changed. Run again with --yes to restore it.'); return { restored: false, manifest }; }
    // The current data moves aside (to undo, move it back), then the backup's data moves in.
    const aside = path.join(dataDir, `.pre-restore-${when}`); fs.mkdirSync(aside, { mode: 0o700 });
    for (const entry of fs.readdirSync(dataDir)) if (!STAGING.test(entry)) fs.renameSync(path.join(dataDir, entry), path.join(aside, entry));
    const restored = path.join(root, 'data'); const owner = fs.statSync(dataDir);
    if (typeof process.getuid === 'function' && process.getuid() === 0 && owner.uid !== 0) chownTree(restored, owner.uid, owner.gid);
    for (const entry of fs.readdirSync(restored)) fs.renameSync(path.join(restored, entry), path.join(dataDir, entry));
    fs.rmSync(staging, { recursive: true, force: true }); fs.chmodSync(dataDir, 0o700);
    log(`Restored into ${dataDir}. The data that was there is in ${aside}; delete it once the studio works.`);
    log('Before people use it again:');
    log('- Start the studio with the same STUDIO_SECRET_KEY as when the backup was made, or the saved keys can’t be read (Settings names them).');
    log('- Check People & access: anyone added since the backup is missing, anyone removed since is back, and sign-in links made since don’t work. Send new links where needed.');
    log('- Runs that were in progress when the backup was made show as stopped; Retry finishes them.');
    return { restored: true, manifest, aside };
  } catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error; }
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  if (args.help || args.h) { console.log('Usage: node scripts/studio-restore.cjs --from <backup.tar.gz | folder> [--data <dir>] [--yes] [--force]'); return; }
  process.umask(0o077);
  try { restore({ from: args.from, dataDir: args.data, yes: Boolean(args.yes), force: Boolean(args.force) }); }
  catch (error) { console.error(`Restore failed: ${error.message}`); process.exit(1); }
}
if (require.main === module) main();
module.exports = { restore, verify };
