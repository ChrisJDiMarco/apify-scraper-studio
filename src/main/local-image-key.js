const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

// Installed apps may read one explicitly configured external file; only development
// enables app-directory discovery. Never populate process.env or copy the key file.
function readLocalImageKey({ appPath, enabled = false, credentialFile } = {}) {
  let fd;
  try {
    const explicit = credentialFile !== undefined;
    if (!explicit && (!enabled || !appPath)) return '';
    if (explicit && (typeof credentialFile !== 'string' || !credentialFile || credentialFile.length > 4096 || credentialFile.includes('\0') || !path.isAbsolute(credentialFile))) throw new Error('An absolute credential file path is required.');
    const target = explicit ? credentialFile : path.join(appPath, '.env.local');
    const original = fs.lstatSync(target);
    if (original.isSymbolicLink() || !original.isFile()) throw new Error('Credential path must name a regular file, not a symbolic link.');
    fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > 64000) throw new Error('Invalid local image credential file.');
    const bytes = Buffer.alloc(64001); let length = 0;
    while (length < bytes.length) { const count = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    if (length > 64000) throw new Error('Invalid local image credential file.');
    const value = parseEnv(bytes.subarray(0, length).toString('utf8')).OPENAI_API_KEY || '';
    if (value.length > 3000 || /\s/.test(value)) throw new Error('Invalid local image credential.');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw new Error('The local image credential file could not be read. Use Settings to connect OpenAI.');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
module.exports = { readLocalImageKey };
