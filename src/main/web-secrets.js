'use strict';
// The browser studio's two secrets: STUDIO_SECRET_KEY (decrypts every key saved in Settings) and STUDIO_PASSWORD (the
// admin password). A process's environment can't be taken back: deleting a variable from process.env leaves it in the
// environment block the process was started with, which any process running as the same user can read (/proc/<pid>/environ
// on Linux, `ps eww` or sysctl on macOS). On the Codex route the AI runs shell commands as that user, so a secret that
// arrived in the environment can be printed by anyone who can prompt it.
//
// STUDIO_SECRETS_FD names an open file descriptor holding `NAME=value` lines instead. scripts/studio-web.cjs reads it once
// at start and closes it, so the secrets live only in the server's memory. Use 0 with systemd's
// `StandardInput=file:/etc/scraper-studio/secrets` (a root-owned 0600 file the service user can't open itself) or with
// `docker run -i … < secrets.env`. Secrets still accepted from the environment work as before, with a warning.
const fs = require('fs');

const SECRET_NAMES = Object.freeze(['STUDIO_SECRET_KEY', 'STUDIO_PASSWORD']);
const MAX_SECRETS_BYTES = 64 * 1024;

// "NAME=value", "export NAME=value", optional single or double quotes; blank lines and # comments are skipped.
function parseSecrets(text) {
  const values = {}; const unknown = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error('STUDIO_SECRETS_FD must hold NAME=value lines (STUDIO_SECRET_KEY and STUDIO_PASSWORD).');
    let value = match[2];
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    if (SECRET_NAMES.includes(match[1])) values[match[1]] = value; else unknown.push(match[1]);
  }
  return { values, unknown };
}

// Returns { values: { STUDIO_SECRET_KEY?, STUDIO_PASSWORD? }, fromEnvironment: [names], unknown: [names] }. A value from
// the descriptor wins over the environment. `fromEnvironment` lists the secrets that sat in the environment at start,
// for the startup warning; studio-web.cjs still removes them from process.env so nothing the server starts inherits them.
function readSecrets({ env = process.env, readFd = (fd) => readAll(fd), closeFd = (fd) => fs.closeSync(fd) } = {}) {
  const fromEnvironment = SECRET_NAMES.filter((name) => typeof env[name] === 'string' && env[name] !== '');
  const values = Object.fromEntries(fromEnvironment.map((name) => [name, env[name]]));
  const raw = String(env.STUDIO_SECRETS_FD ?? '').trim();
  let unknown = [];
  if (raw) {
    if (!/^\d{1,4}$/.test(raw)) throw new Error('STUDIO_SECRETS_FD must be the number of an open file descriptor, such as 0 for standard input.');
    const fd = Number(raw); let text;
    try { text = readFd(fd); } catch (error) { throw new Error(`STUDIO_SECRETS_FD ${fd} could not be read (${error.code || error.message}). Open it for the server, for example with systemd StandardInput=file:… or \`< secrets.env\`.`); }
    // Standard input stays open (drained) so nothing else takes descriptor 0; any other descriptor would be inherited by
    // every program the server starts, so it is closed.
    if (fd > 2) { try { closeFd(fd); } catch (_) { /* already closed */ } }
    const parsed = parseSecrets(text);
    Object.assign(values, parsed.values); unknown = parsed.unknown;
  }
  return { values, fromEnvironment, unknown };
}
// Reads to the end. A non-blocking pipe answers EAGAIN until its writer catches up, so wait briefly (up to 30 s) then retry.
function readAll(fd) {
  const chunks = []; let size = 0; let waited = 0; const buffer = Buffer.alloc(8192); const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    let read;
    try { read = fs.readSync(fd, buffer, 0, buffer.length, null); } catch (error) {
      if (error.code === 'EAGAIN' && waited < 30000) { Atomics.wait(pause, 0, 0, 20); waited += 20; continue; }
      if (error.code === 'EOF') break;
      throw error;
    }
    if (!read) break;
    size += read; if (size > MAX_SECRETS_BYTES) throw new Error('more than 64 KB');
    chunks.push(Buffer.from(buffer.subarray(0, read)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = { SECRET_NAMES, parseSecrets, readSecrets };
