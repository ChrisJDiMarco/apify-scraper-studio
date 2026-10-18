'use strict';
// Text files people import (CSV, TSV, TXT, Markdown) in whatever encoding their app saved. A byte-order mark decides
// first: Excel's "Unicode Text" and older Notepad saves are UTF-16, and a UTF-8 BOM is dropped. Without one the text must
// be valid UTF-8; otherwise it is read as Windows (ANSI) text, what Excel for Windows writes for "CSV (Comma delimited)",
// and `note` says so. Callers still refuse text with NUL characters (a binary file). CommonJS, Electron-free.
const ANSI_NOTE = 'Read as Windows (ANSI) text';

// → { text, encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252', note: '' | 'Read as Windows (ANSI) text' }
function decodeText(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: bytes.subarray(2).toString('utf16le'), encoding: 'utf-16le', note: '' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // Swapped into little-endian so it doesn't depend on Node's ICU build; an odd last byte can't be a character.
    const body = Buffer.from(bytes.subarray(2, bytes.length - ((bytes.length - 2) % 2))); body.swap16();
    return { text: body.toString('utf16le'), encoding: 'utf-16be', note: '' };
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(3)), encoding: 'utf-8', note: '' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8', note: '' }; }
  catch (_) { return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252', note: ANSI_NOTE }; }
}

module.exports = { decodeText, ANSI_NOTE };
