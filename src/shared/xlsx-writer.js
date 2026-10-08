// Minimal Office Open XML (.xlsx) writer for Sheets exports. No dependencies beyond zlib: the ZIP container is
// written here. Cells are inline strings or plain numbers. Formulas are never written, and text that starts like
// a formula (= + - @) stays text, so nothing in a downloaded workbook runs when it is opened or edited.
const zlib = require('node:zlib');

const MAX_XLSX_CELL_CHARS = 32767; // Excel's per-cell limit; longer text makes Excel "repair" the file.
const MAX_SHEETS = 255;
const ZIP_LIMIT = 0xfffffffe; // no ZIP64: every part and offset must fit in 32 bits
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
// Characters XML 1.0 cannot carry at all, including unpaired surrogates.
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const FORMULA_LIKE = /^[\s\u0000-\u001f]*[=+@-]/;
const STYLE = { header: 1, quoted: 2 };

function fail(message) { throw new Error(message); }
const escapeText = (value) => value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
const escapeAttr = (value) => String(value).replace(XML_ILLEGAL, '').replace(/[&<>"'\t\n\r]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\t': '&#9;', '\n': '&#10;', '\r': '&#13;' }[char]));
// Cut to a length without splitting a surrogate pair.
function cut(text, max) { if (text.length <= max) return text; const end = /[\uD800-\uDBFF]/.test(text[max - 1]) ? max - 1 : max; return text.slice(0, end); }

function columnLetter(index) {
  let n = index + 1; let letters = '';
  while (n > 0) { const rem = (n - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; n = Math.floor((n - 1) / 26); }
  return letters;
}

// A numeric string becomes a real number only when it reads back exactly: plain decimal notation, no sign, no
// leading or trailing zeros, at most 15 significant digits (what Excel keeps). "007", "1e5", "-3" and long IDs stay text.
function exactNumber(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d*[1-9])?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && String(number) === value && Number(number.toPrecision(15)) === number ? number : null;
}

// Text as Excel stores it: XML-safe, \n line breaks, at most 32,767 characters.
const normalizeText = (value) => String(value ?? '').replace(XML_ILLEGAL, '').replace(/\r\n?/g, '\n');

// Excel sheet names: 1–31 characters, none of [ ] : * ? / \, no leading or trailing apostrophe, unique ignoring
// case, and never "History" (Excel reserves it).
function sheetNames(names) {
  const used = new Set(['history']);
  return names.map((raw, index) => {
    const clean = (text) => text.replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
    const base = cut(clean(String(raw ?? '').replace(XML_ILLEGAL, '').replace(/[\u0000-\u001f\u007f[\]:*?/\\]/g, ' ')), 31) || `Sheet${index + 1}`;
    let name = clean(base) || `Sheet${index + 1}`; let copy = 2;
    while (used.has(name.toLowerCase())) { const suffix = ` (${copy++})`; name = `${clean(cut(base, 31 - suffix.length))}${suffix}`; }
    used.add(name.toLowerCase());
    return name;
  });
}

// Widths in Excel's character units, from the header and a sample of rows.
function columnWidths(columns, rows, width) {
  return Array.from({ length: width }, (_, index) => {
    let longest = String(columns[index] ?? '').length + 3; // the header is bold
    for (let row = 0; row < rows.length && row < 300; row++) {
      const value = rows[row]?.[index]; if (value === undefined || value === null || value === '') continue;
      longest = Math.max(longest, Math.min(String(value).split('\n', 1)[0].length, 90) + 1);
    }
    return Math.max(8, Math.min(60, Math.round(longest * 1.08 + 1)));
  });
}

// Large sheets are assembled as a list of UTF-8 chunks, never one giant string.
function chunkedXml() {
  const parts = []; let pending = []; let size = 0;
  const flush = () => { if (pending.length) { parts.push(Buffer.from(pending.join(''), 'utf8')); pending = []; size = 0; } };
  return {
    push(text) { pending.push(text); size += text.length; if (size > 1 << 20) flush(); },
    buffer() { flush(); return Buffer.concat(parts); },
  };
}

function textCell(ref, text, style) {
  const preserve = /^\s|\s$|[\n\t]/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t${preserve}>${escapeText(text)}</t></is></c>`;
}

function worksheetXml(sheet, selected, stats) {
  const columns = sheet.columns; const rows = sheet.rows;
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), columns.length);
  const letters = Array.from({ length: Math.max(width, 1) }, (_, index) => columnLetter(index));
  const frozen = Number.isInteger(sheet.frozenColumns) && sheet.frozenColumns > 0 && sheet.frozenColumns < width ? Math.min(sheet.frozenColumns, 10) : 0;
  const xml = chunkedXml();
  xml.push(`${XML_HEAD}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">`);
  xml.push(`<dimension ref="${width ? `A1:${letters[width - 1]}${rows.length + 1}` : 'A1'}"/>`);
  // Row 1 is the header, frozen like the Golden Thread sheet; frozen columns carry over too.
  const pane = !width ? '' : frozen
    ? `<pane xSplit="${frozen}" ySplit="1" topLeftCell="${letters[frozen]}2" activePane="bottomRight" state="frozen"/><selection pane="topRight" activeCell="${letters[frozen]}1" sqref="${letters[frozen]}1"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/><selection pane="bottomRight" activeCell="${letters[frozen]}2" sqref="${letters[frozen]}2"/>`
    : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';
  xml.push(`<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>`);
  if (width) xml.push(`<cols>${columnWidths(columns, rows, width).map((size, index) => `<col min="${index + 1}" max="${index + 1}" width="${size}" customWidth="1"/>`).join('')}</cols>`);
  xml.push('<sheetData>');
  if (width) xml.push(`<row r="1">${letters.slice(0, width).map((letter, index) => { const text = cut(normalizeText(columns[index]), MAX_XLSX_CELL_CHARS); return text ? textCell(`${letter}1`, text, STYLE.header) : `<c r="${letter}1" s="${STYLE.header}"/>`; }).join('')}</row>`);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]; const number = index + 2; let cells = '';
    for (let column = 0; column < row.length; column++) {
      const value = row[column];
      const raw = value === undefined || value === null ? '' : typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
      if (!raw) continue;
      if (exactNumber(raw) !== null) { cells += `<c r="${letters[column]}${number}"><v>${raw}</v></c>`; continue; }
      const normalized = normalizeText(raw); if (!normalized) continue;
      const text = cut(normalized, MAX_XLSX_CELL_CHARS); if (text.length < normalized.length) stats.truncatedCells++;
      cells += textCell(`${letters[column]}${number}`, text, FORMULA_LIKE.test(text) ? STYLE.quoted : 0);
    }
    if (cells) xml.push(`<row r="${number}">${cells}</row>`);
  }
  xml.push('</sheetData></worksheet>');
  return xml.buffer();
}

const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">`
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F4F2"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  // 0 default · 1 bold header · 2 text that starts like a formula (quotePrefix keeps it text when edited)
  + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

// CRC-32 (IEEE 802.3), as every ZIP entry records it.
const CRC_TABLE = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(buffer) { let crc = 0xffffffff; for (let index = 0; index < buffer.length; index++) crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

function dosStamp(date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}

// A plain ZIP archive: deflated entries with UTF-8 names (flag bit 11), a central directory and its end record.
function zip(entries, modifiedAt) {
  const { time, date } = dosStamp(modifiedAt); const locals = []; const centrals = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8'); const data = entry.data; const compressed = zlib.deflateRawSync(data); const crc = crc32(data);
    if (data.length > ZIP_LIMIT || compressed.length > ZIP_LIMIT || offset > ZIP_LIMIT) fail('This workbook is too large for a .xlsx file. Download fewer rows or one tab at a time.');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed); centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals); const end = Buffer.alloc(22);
  if (offset > ZIP_LIMIT || directory.length > ZIP_LIMIT) fail('This workbook is too large for a .xlsx file. Download fewer rows or one tab at a time.');
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function checkSheets(sheets) {
  if (!Array.isArray(sheets) || !sheets.length) fail('A workbook needs at least one sheet to download.');
  if (sheets.length > MAX_SHEETS) fail(`A .xlsx workbook can hold up to ${MAX_SHEETS} sheets.`);
  sheets.forEach((sheet, index) => {
    if (!sheet || typeof sheet !== 'object') fail(`Sheet ${index + 1} is missing.`);
    if (!Array.isArray(sheet.columns) || !Array.isArray(sheet.rows) || sheet.rows.some((row) => !Array.isArray(row))) fail(`Sheet ${index + 1} needs a header row and rows of cells.`);
  });
}

// buildXlsx({ sheets: [{ name, columns, rows, frozenColumns? }], title? }) → Buffer
// Optional modifiedAt pins the file timestamps; onStats({ truncatedCells }) reports cells cut to Excel's limit.
function buildXlsx({ sheets, title, modifiedAt = new Date(), onStats } = {}) {
  checkSheets(sheets);
  const stamp = modifiedAt instanceof Date && Number.isFinite(modifiedAt.getTime()) ? modifiedAt : new Date();
  const names = sheetNames(sheets.map((sheet) => sheet.name)); const stats = { truncatedCells: 0 };
  const worksheets = sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet, index === 0, stats) }));
  const iso = stamp.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const docTitle = cut(String(title ?? '').replace(XML_ILLEGAL, '').trim(), 255);
  const text = (name, value) => ({ name, data: Buffer.from(value, 'utf8') });
  const entries = [
    text('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${worksheets.map((sheet) => `<Override PartName="/${sheet.name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    text('_rels/.rels', `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    text('docProps/core.xml', `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${docTitle ? `<dc:title>${escapeText(docTitle)}</dc:title>` : ''}<dc:creator>Scraper Studio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`),
    text('docProps/app.xml', `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Scraper Studio</Application></Properties>`),
    text('xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((name, index) => `<sheet name="${escapeAttr(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`),
    text('xl/_rels/workbook.xml.rels', `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">${worksheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${worksheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`),
    text('xl/styles.xml', STYLES_XML),
    ...worksheets,
  ];
  if (typeof onStats === 'function') onStats({ ...stats, sheetNames: names });
  return zip(entries, stamp);
}

module.exports = { buildXlsx, exactNumber, sheetNames, crc32, columnLetter, MAX_XLSX_CELL_CHARS };
