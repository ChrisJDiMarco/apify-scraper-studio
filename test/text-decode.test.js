import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import textDecode from '../src/shared/text-decode.js';
import workbookImport from '../src/main/workbook-import.js';
import documentImport from '../src/main/document-import.js';
import researchWorkspace from '../src/main/research-workspace.js';
const { decodeText } = textDecode;

// Files saved on Windows: Excel's "CSV (Comma delimited)" is Windows (ANSI) text, its "Unicode Text" and older Notepad
// saves are UTF-16. Imports read all of them instead of refusing them or turning accents into U+FFFD.
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const ansi = (text) => Buffer.from(text, 'latin1'); // the accents used here are the same bytes in Windows-1252
const utf16le = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

describe('decodeText', () => {
  it('reads Windows (ANSI) text and says so', () => {
    expect(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toEqual({ text: 'café', encoding: 'windows-1252', note: 'Read as Windows (ANSI) text' });
    expect(decodeText(Buffer.from([0x93, 0x51, 0x94, 0x20, 0x80])).text).toBe('“Q” €'); // Excel's curly quotes and the euro sign
  });

  it('reads UTF-16 by its byte-order mark, little- and big-endian', () => {
    expect(decodeText(utf16le('name,city\nRiley,Zürich'))).toEqual({ text: 'name,city\nRiley,Zürich', encoding: 'utf-16le', note: '' });
    const big = Buffer.from('Jordan, Montréal', 'utf16le'); big.swap16();
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), big]))).toEqual({ text: 'Jordan, Montréal', encoding: 'utf-16be', note: '' });
  });

  it('reads plain UTF-8 with no note, dropping a byte-order mark', () => {
    expect(decodeText(Buffer.from('Sam — naïve café ✓', 'utf8'))).toEqual({ text: 'Sam — naïve café ✓', encoding: 'utf-8', note: '' });
    expect(decodeText(Buffer.from('﻿a,b', 'utf8'))).toEqual({ text: 'a,b', encoding: 'utf-8', note: '' });
    expect(decodeText(Buffer.alloc(0))).toEqual({ text: '', encoding: 'utf-8', note: '' });
  });
});

describe('imports that use it', () => {
  it('Sheets: an ANSI CSV from Excel imports with a warning, a UTF-16 one imports cleanly, and binary is still refused', async () => {
    const workbook = await workbookImport.parseWorkbookBuffer({ buffer: ansi('name,city\r\nAlex,Montréal\r\n'), fileName: 'People.csv' });
    expect(workbook.sheets[0].rows).toEqual([['name', 'city'], ['Alex', 'Montréal']]);
    expect(workbook.warnings).toEqual([expect.stringMatching(/^Read as Windows \(ANSI\) text\. .*CSV UTF-8/)]);
    const unicode = await workbookImport.parseWorkbookBuffer({ buffer: utf16le('name\tcity\r\nSam\tZürich\r\n'), fileName: 'People.txt' });
    expect(unicode.sheets[0].rows).toEqual([['name', 'city'], ['Sam', 'Zürich']]); expect(unicode.warnings).toEqual([]);
    await expect(workbookImport.parseWorkbookBuffer({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0xff]), fileName: 'image.csv' })).rejects.toThrow(/binary file/);
  });

  it('Documents: ANSI text imports with a warning instead of being refused', async () => {
    const result = await documentImport.extractDocumentText({ buffer: ansi('Notes for Jordan: café visits up.'), fileName: 'notes.txt' });
    expect(result.text).toBe('Notes for Jordan: café visits up.');
    expect(result.warnings).toEqual([expect.stringMatching(/^Read as Windows \(ANSI\) text\./)]);
    const plain = await documentImport.extractDocumentText({ buffer: Buffer.from('Plain UTF-8 — fine.'), fileName: 'notes.md' });
    expect(plain.warnings).toEqual([]);
  });

  it('Research data: an ANSI CSV picked for import has no U+FFFD and says how it was read', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'text-decode-')); roots.push(root);
    const file = path.join(root, 'feedback.csv'); fs.writeFileSync(file, ansi('text,author\r\n"Résumé tips were “great”",Riley\r\n'.replace('“', '\u0093').replace('”', '\u0094')));
    const pick = (filePath) => researchWorkspace.createResearchWorkspace({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }) }, getWindow: () => null }).pickImportFile();
    const picked = await pick(file);
    expect(picked.content).not.toContain('�');
    expect(picked.content).toContain('Résumé tips were “great”');
    expect(picked).toMatchObject({ name: 'feedback.csv', format: 'csv', encodingNote: 'Read as Windows (ANSI) text' });
    const utf8 = path.join(root, 'plain.csv'); fs.writeFileSync(utf8, 'text\nZürich\n');
    expect(await pick(utf8)).toEqual({ name: 'plain.csv', format: 'csv', content: 'text\nZürich\n' });
  });
});
