const fs = require('node:fs/promises');
const path = require('node:path');
const { SaxesParser } = require('saxes');
const unzipper = require('unzipper');

// Reads spreadsheet files into plain sheets of text cells. Formulas are never evaluated: the value the
// spreadsheet last showed (its cached result) is what comes in, so an import matches what people reviewed.
const MAX_WORKBOOK_BYTES = 50 * 1024 * 1024;
const MAX_PART_BYTES = 96 * 1024 * 1024;
const MAX_SHEETS = 60;
const MAX_ROWS = 60000;
const MAX_COLUMNS = 256;
const MAX_CELL_CHARS = 50000;
const SHEET_NS = new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']);
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function fail(field, message) { const error = new Error(message); error.field = field; throw error; }
function xmlParser() {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => fail('file', 'Spreadsheets with XML entity declarations are not supported.'));
  parser.on('error', () => fail('file', 'This spreadsheet contains invalid XML. Download a fresh copy and try again.'));
  return parser;
}
const attr = (node, name) => Object.values(node.attributes).find(attribute => attribute.local === name)?.value;
const cellText = (value) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').slice(0, MAX_CELL_CHARS);

async function entryText(entry) {
  if (entry.flags & 1) fail('file', 'Encrypted spreadsheets are not supported. Save an unprotected copy.');
  if (![0, 8].includes(entry.compressionMethod) || entry.uncompressedSize > MAX_PART_BYTES) fail('file', 'A part of this spreadsheet is too large to import. Split it into smaller files.');
  const stream = entry.stream(); const chunks = []; let size = 0;
  try { for await (const chunk of stream) { size += chunk.length; if (size > MAX_PART_BYTES) { stream.destroy(); fail('file', 'A part of this spreadsheet is too large to import.'); } chunks.push(chunk); } }
  catch (error) { if (error.field) throw error; fail('file', 'The spreadsheet could not be decompressed. Download a fresh copy.'); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch (_) { fail('file', 'This spreadsheet uses an unsupported text encoding.'); }
}

function columnIndex(reference) {
  const letters = /^([A-Z]+)/i.exec(String(reference || ''))?.[1]?.toUpperCase();
  if (!letters) return -1;
  let index = 0; for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function parseSharedStrings(xml) {
  const strings = []; if (!xml) return strings;
  const parser = xmlParser(); let current = null; let inText = 0; let phonetic = 0;
  parser.on('opentag', node => {
    if (!SHEET_NS.has(node.uri)) return;
    if (node.local === 'si') current = [];
    else if (node.local === 'rPh') phonetic += 1;
    else if (node.local === 't' && current && !phonetic) inText += 1;
  });
  parser.on('text', value => { if (inText && current) current.push(value); });
  parser.on('cdata', value => { if (inText && current) current.push(value); });
  parser.on('closetag', node => {
    if (!SHEET_NS.has(node.uri)) return;
    if (node.local === 't' && inText) inText -= 1;
    else if (node.local === 'rPh') phonetic -= 1;
    else if (node.local === 'si' && current) { strings.push(cellText(current.join(''))); current = null; }
  });
  parser.write(xml).close();
  return strings;
}

// Which cell styles show numbers as dates or percentages, so a serial like 46077.13 reads as 2026-02-24 03:18.
function parseStyles(xml) {
  const formats = new Map(); const styles = []; if (!xml) return styles;
  const parser = xmlParser(); let inCellXfs = false;
  parser.on('opentag', node => {
    if (!SHEET_NS.has(node.uri)) return;
    if (node.local === 'numFmt') formats.set(Number(attr(node, 'numFmtId')), String(attr(node, 'formatCode') || ''));
    else if (node.local === 'cellXfs') inCellXfs = true;
    else if (node.local === 'xf' && inCellXfs) {
      const id = Number(attr(node, 'numFmtId') || 0); const code = formats.get(id) || '';
      const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
      const isDate = BUILT_IN_DATE_FORMATS.has(id) || (/[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim()));
      const percent = id === 9 ? 0 : id === 10 ? 2 : bare.includes('%') ? (/\.(0+)%/.exec(bare)?.[1].length || 0) : null;
      styles.push({ isDate, percent, hasTime: isDate && (/[hs]/i.test(bare) || [18, 19, 20, 21, 22, 45, 46, 47].includes(id)), hasDate: isDate && (/[dy]/i.test(bare) || [14, 15, 16, 17, 22].includes(id)) });
    }
  });
  parser.on('closetag', node => { if (SHEET_NS.has(node.uri) && node.local === 'cellXfs') inCellXfs = false; });
  parser.write(xml).close();
  return styles;
}

function formatSerialDate(serial, style, date1904) {
  const days = Number(serial); if (!Number.isFinite(days)) return String(serial);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(days * 86400000));
  if (Number.isNaN(date.getTime())) return String(serial);
  const pad = (value) => String(value).padStart(2, '0');
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}${date.getUTCSeconds() ? `:${pad(date.getUTCSeconds())}` : ''}`;
  const fraction = days % 1 !== 0;
  if (style?.hasDate === false && style?.hasTime) return time;
  return style?.hasTime || fraction ? `${day} ${time}` : day;
}

function formatNumber(raw, style, date1904) {
  if (style?.isDate) return formatSerialDate(raw, style, date1904);
  const value = Number(raw); if (!Number.isFinite(value)) return String(raw);
  if (style?.percent !== null && style?.percent !== undefined) return `${(value * 100).toFixed(style.percent)}%`;
  return String(Number(value.toPrecision(15)));
}

function parseWorksheet(xml, { sharedStrings, styles, date1904 }) {
  const rows = []; const parser = xmlParser(); let row = null; let rowIndex = -1; let cell = null; let capture = ''; let nextColumn = 0; let nodes = 0; let frozenColumns = 0;
  parser.on('opentag', node => {
    if (!SHEET_NS.has(node.uri)) return;
    if (++nodes > 8000000) fail('file', 'This sheet is too large to import. Split it into smaller sheets.');
    // Keep the sheet's own frozen columns, so a frozen post_url column stays frozen here too.
    if (node.local === 'pane' && /^frozen/.test(String(attr(node, 'state') || ''))) { const split = Number(attr(node, 'xSplit') || 0); if (Number.isInteger(split) && split > 0 && split <= 10) frozenColumns = split; return; }
    if (node.local === 'row') {
      const declared = Number(attr(node, 'r')); rowIndex = Number.isInteger(declared) && declared > 0 ? declared - 1 : rowIndex + 1;
      if (rowIndex >= MAX_ROWS) fail('file', `A sheet has more than ${MAX_ROWS.toLocaleString()} rows. Split it before importing.`);
      row = []; nextColumn = 0;
    } else if (node.local === 'c' && row) {
      const declared = columnIndex(attr(node, 'r')); const column = declared >= 0 ? declared : nextColumn;
      if (column >= MAX_COLUMNS) fail('file', `A sheet has more than ${MAX_COLUMNS} columns. Remove unused columns before importing.`);
      cell = { column, type: attr(node, 't') || 'n', style: Number(attr(node, 's') || 0), value: '', inline: [] }; nextColumn = column + 1;
    } else if (cell && (node.local === 'v' || (node.local === 't' && cell.type === 'inlineStr'))) capture = node.local;
  });
  const onText = (value) => { if (!cell || !capture) return; if (capture === 'v') cell.value += value; else cell.inline.push(value); };
  parser.on('text', onText); parser.on('cdata', onText);
  parser.on('closetag', node => {
    if (!SHEET_NS.has(node.uri)) return;
    if ((node.local === 'v' || node.local === 't') && capture) capture = '';
    else if (node.local === 'c' && cell && row) {
      let value = '';
      if (cell.type === 's') value = sharedStrings[Number(cell.value)] ?? '';
      else if (cell.type === 'inlineStr') value = cell.inline.join('');
      else if (cell.type === 'b') value = cell.value === '1' ? 'TRUE' : 'FALSE';
      else if (cell.type === 'str' || cell.type === 'e' || cell.type === 'd') value = cell.value;
      else if (cell.value !== '') value = formatNumber(cell.value, styles[cell.style], date1904);
      row[cell.column] = cellText(value); cell = null;
    } else if (node.local === 'row' && row) { rows[rowIndex] = row; row = null; }
  });
  parser.write(xml).close();
  return { rows: tidyRows(rows), frozenColumns };
}

// Dense rectangular rows with trailing empty rows and columns removed (sheets often carry formatted blanks).
function tidyRows(rows) {
  let lastRow = -1; let width = 0;
  rows.forEach((row, index) => {
    if (!row) return;
    let last = -1; for (let i = row.length - 1; i >= 0; i--) if (row[i] !== undefined && row[i] !== '') { last = i; break; }
    if (last >= 0) { lastRow = index; width = Math.max(width, last + 1); }
  });
  const out = [];
  for (let index = 0; index <= lastRow; index++) { const row = rows[index] || []; out.push(Array.from({ length: width }, (_, column) => row[column] ?? '')); }
  return out;
}

async function readXlsx(buffer, fileName) {
  let directory; try { directory = await unzipper.Open.buffer(buffer); } catch (_) { fail('file', 'This file is not a readable .xlsx workbook. Download it again from Google Sheets (File → Download → Microsoft Excel).'); }
  if (directory.files.length > 10000) fail('file', 'This workbook contains too many parts to import safely.');
  const entries = new Map(directory.files.map(entry => [entry.path.replace(/^\/+/, ''), entry]));
  const read = async (name) => { const entry = entries.get(name); return entry ? entryText(entry) : ''; };
  const workbookXml = await read('xl/workbook.xml');
  if (!workbookXml) fail('file', 'This .xlsx file has no workbook. Download a fresh copy and try again.');
  const declared = []; let date1904 = false;
  const workbookParser = xmlParser();
  workbookParser.on('opentag', node => {
    if (node.local === 'workbookPr' && ['1', 'true'].includes(String(attr(node, 'date1904')))) date1904 = true;
    if (node.local === 'sheet' && SHEET_NS.has(node.uri)) declared.push({ name: String(attr(node, 'name') || `Sheet${declared.length + 1}`), relationship: attr(node, 'id'), state: attr(node, 'state') || 'visible' });
  });
  workbookParser.write(workbookXml).close();
  const targets = new Map(); const relationsXml = await read('xl/_rels/workbook.xml.rels');
  if (relationsXml) {
    const relations = xmlParser();
    relations.on('opentag', node => { if (node.local === 'Relationship') targets.set(attr(node, 'Id'), String(attr(node, 'Target') || '')); });
    relations.write(relationsXml).close();
  }
  const context = { sharedStrings: parseSharedStrings(await read('xl/sharedStrings.xml')), styles: parseStyles(await read('xl/styles.xml')), date1904 };
  const sheets = []; const warnings = [];
  for (const sheet of declared) {
    if (sheet.state === 'veryHidden') continue;
    if (sheets.length >= MAX_SHEETS) { warnings.push(`Only the first ${MAX_SHEETS} sheets were imported.`); break; }
    const target = targets.get(sheet.relationship) || '';
    const partPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('xl', target));
    if (!partPath.startsWith('xl/') || !entries.has(partPath)) { warnings.push(`“${sheet.name}” could not be found in the file and was skipped.`); continue; }
    const { rows, frozenColumns } = parseWorksheet(await read(partPath), context);
    sheets.push({ name: sheet.name.slice(0, 120), hidden: sheet.state === 'hidden', rows, ...(frozenColumns ? { frozenColumns } : {}) });
  }
  if (!sheets.length) fail('file', 'This workbook has no sheets with readable cells.');
  return { name: workbookName(fileName), sheets, warnings };
}

// RFC 4180 CSV with quoted fields, embedded newlines and a sniffed delimiter (comma, semicolon or tab).
function parseDelimited(text, delimiter) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
      if (rows.length > MAX_ROWS) fail('file', `This file has more than ${MAX_ROWS.toLocaleString()} rows. Split it before importing.`);
    } else field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function sniffDelimiter(text, extension) {
  if (extension === '.tsv') return '\t';
  const firstLine = text.slice(0, 4000).split(/\r?\n/)[0] || '';
  const counts = [',', ';', '\t'].map(delimiter => [delimiter, firstLine.split(delimiter).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts[0][0] : ',';
}
function readDelimited(buffer, fileName) {
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (_) { fail('file', 'Save this file as UTF-8 CSV and try again.'); }
  if (text.includes('\u0000')) fail('file', 'This looks like a binary file. Choose a .xlsx, .csv or .tsv file.');
  text = text.replace(/^﻿/, '');
  const extension = path.extname(fileName).toLowerCase();
  const raw = parseDelimited(text, sniffDelimiter(text, extension));
  if (raw.some(row => row.length > MAX_COLUMNS)) fail('file', `This file has more than ${MAX_COLUMNS} columns. Remove unused columns before importing.`);
  const rows = tidyRows(raw.map(row => row.map(cellText)));
  if (!rows.length) fail('file', 'This file has no readable cells.');
  return { name: workbookName(fileName), sheets: [{ name: workbookName(fileName).slice(0, 120), hidden: false, rows }], warnings: [] };
}
function workbookName(fileName) {
  const base = path.basename(String(fileName || ''), path.extname(String(fileName || ''))).trim();
  return (base || 'Imported workbook').slice(0, 160);
}

async function parseWorkbookBuffer({ buffer, fileName } = {}) {
  if (!Buffer.isBuffer(buffer)) fail('file', 'Provide the spreadsheet bytes to import.');
  if (!buffer.length || buffer.length > MAX_WORKBOOK_BYTES) fail('file', 'Choose a nonempty spreadsheet no larger than 50 MB.');
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (extension === '.xlsx') return readXlsx(buffer, fileName);
  if (['.csv', '.tsv', '.txt'].includes(extension)) return readDelimited(buffer, fileName);
  fail('file', 'Choose a .xlsx, .csv or .tsv file. In Google Sheets use File → Download → Microsoft Excel (.xlsx) to bring every tab at once.');
}

async function readWorkbookFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) fail('filePath', 'Choose a local spreadsheet file.');
  let stat; try { stat = await fs.stat(filePath); } catch (_) { fail('file', 'The selected file could not be read. Check access and try again.'); }
  if (!stat.isFile() || stat.size > MAX_WORKBOOK_BYTES) fail('file', 'Choose a regular spreadsheet file no larger than 50 MB.');
  return parseWorkbookBuffer({ buffer: await fs.readFile(filePath), fileName: path.basename(filePath) });
}

module.exports = { MAX_WORKBOOK_BYTES, MAX_ROWS, MAX_COLUMNS, parseWorkbookBuffer, readWorkbookFile, parseDelimited, columnIndex, formatSerialDate };
