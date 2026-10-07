// Spreadsheet behaviour for the Sheets view: addresses, types, sorting, filtering, clipboard and
// selection maths. Pure functions over string cells so they test without a DOM.

export function columnLetter(index) {
  let n = index + 1; let letters = '';
  while (n > 0) { const rem = (n - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; n = Math.floor((n - 1) / 26); }
  return letters;
}

// Row numbers match the spreadsheet: row 1 is the header, data starts at row 2.
export function cellAddress(sheetRow, column) { return `${columnLetter(column)}${sheetRow}`; }

// Edits key off the column label when it is unique (survives column moves), else the letter.
export function columnKeys(columns) {
  const counts = new Map(); for (const label of columns) counts.set(label, (counts.get(label) || 0) + 1);
  return columns.map((label, index) => (label && counts.get(label) === 1 ? label : `#${columnLetter(index)}`));
}

const NUMBER_RE = /^[-+]?[$€£]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?\s?%?$/;
export function parseNumber(value) {
  const text = String(value ?? '').trim();
  if (!text || !/\d/.test(text) || !NUMBER_RE.test(text)) return null;
  const number = Number(text.replace(/[$€£,%\s+]/g, ''));
  return Number.isFinite(number) ? number : null;
}

const DATE_HINT = /^\d{4}-\d{2}-\d{2}|^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} |^\d{1,2}\/\d{1,2}\/\d{2,4}/;
export function parseDate(value) {
  const text = String(value ?? '').trim();
  if (!DATE_HINT.test(text)) return null;
  // Sheets writes "2026-02-24 3:18"; ISO parsing wants "2026-02-24T03:18".
  const time = Date.parse(text.replace(/^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2})/, (_, day, hour, minute) => `${day}T${hour.padStart(2, '0')}:${minute}`));
  return Number.isFinite(time) ? time : null;
}

export function inferColumnType(label, values) {
  const sample = []; for (const value of values) { const text = String(value ?? '').trim(); if (text) sample.push(text); if (sample.length >= 400) break; }
  const name = String(label || '').toLowerCase();
  if (!sample.length) return /url|link/.test(name) ? 'url' : /count|score|total|number|views|likes|upvotes|reactions|comments/.test(name) ? 'number' : 'text';
  const share = (test) => sample.filter(test).length / sample.length;
  if (share((v) => /^https?:\/\//i.test(v)) >= 0.8) return 'url';
  if (share((v) => /^(true|false)$/i.test(v)) >= 0.95) return 'bool';
  if (share((v) => parseNumber(v) !== null) >= 0.95) return 'number';
  if (share((v) => parseDate(v) !== null) >= 0.9) return 'date';
  if (share((v) => /^\s*[[{]/.test(v) || /^```json/.test(v)) >= 0.8) return 'json';
  const average = sample.reduce((sum, v) => sum + v.length, 0) / sample.length;
  return average > 90 ? 'longtext' : 'text';
}

// Short, repeating labels (Novelty, Status, Zone, Urgency_Signal…) read as Sheets-style chips.
const FREE_TEXT = /text|reason|description|criteria|summary|notes|headline|rationale|title|output|keywords|phrases|name|author|user|entit|tools|people|companies|url|link/i;
export function isChipColumn(label, type, values) {
  if (type !== 'text' || FREE_TEXT.test(String(label || ''))) return false;
  const seen = new Set(); let filled = 0;
  for (const value of values) { const text = String(value ?? '').trim(); if (!text) continue; filled++; if (text.length > 32) return false; seen.add(text); if (seen.size > 12) return false; }
  return filled >= 2 && seen.size < filled; // at least one value repeats, so it is a label, not an identifier
}
const CHIP_TONES = 8;
export function chipTone(value) { let hash = 0; for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return hash % CHIP_TONES; }

export function defaultColumnWidth(label, type, values = []) {
  const base = { number: 104, bool: 84, date: 156, url: 220, json: 260, longtext: 340, text: 150 }[type] || 150;
  if (type === 'longtext' || type === 'json') return base;
  let longest = String(label || '').length * 7.6 + 34; let seen = 0;
  for (const value of values) { longest = Math.max(longest, Math.min(String(value ?? '').length, 48) * 7.2 + 24); if (++seen > 200) break; }
  return Math.round(Math.max(type === 'number' || type === 'bool' ? 72 : 96, Math.min(type === 'url' ? 260 : 300, Math.max(base * 0.6, longest))));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function compareCells(a, b, type) {
  const emptyA = String(a ?? '').trim() === ''; const emptyB = String(b ?? '').trim() === '';
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1; // blanks sink, whichever way the sort runs
  if (type === 'number') { const x = parseNumber(a); const y = parseNumber(b); if (x !== null && y !== null) return x - y; }
  if (type === 'date') { const x = parseDate(a); const y = parseDate(b); if (x !== null && y !== null) return x - y; }
  if (type === 'bool') return (String(a).toUpperCase() === 'TRUE') - (String(b).toUpperCase() === 'TRUE');
  return collator.compare(String(a), String(b));
}

// Stable sort of row indexes; blanks stay last in both directions, like Sheets.
export function sortRowIndexes(indexes, getValue, column, type, direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1;
  return indexes.map((rowIndex, order) => ({ rowIndex, order, value: getValue(rowIndex, column) })).sort((a, b) => {
    const emptyA = String(a.value ?? '').trim() === ''; const emptyB = String(b.value ?? '').trim() === '';
    if (emptyA !== emptyB) return emptyA ? 1 : -1;
    return (compareCells(a.value, b.value, type) * sign) || (a.order - b.order);
  }).map((entry) => entry.rowIndex);
}

export function matchesFilter(value, filter) {
  if (!filter) return true;
  const text = String(value ?? '');
  if (filter.values && !filter.values.includes(text)) return false;
  if (filter.contains && !text.toLowerCase().includes(String(filter.contains).toLowerCase())) return false;
  return true;
}

export function distinctValues(indexes, getValue, column, limit = 300) {
  const counts = new Map();
  for (const rowIndex of indexes) { const value = String(getValue(rowIndex, column) ?? ''); counts.set(value, (counts.get(value) || 0) + 1); }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || collator.compare(a.value, b.value)).slice(0, limit);
}

export function selectionBounds(selection) {
  if (!selection) return null;
  const { anchor, focus } = selection;
  return { top: Math.min(anchor.row, focus.row), bottom: Math.max(anchor.row, focus.row), left: Math.min(anchor.column, focus.column), right: Math.max(anchor.column, focus.column) };
}

export function selectionStats(values) {
  let count = 0; let numericCount = 0; let sum = 0; let min = Infinity; let max = -Infinity;
  for (const value of values) {
    if (String(value ?? '').trim() === '') continue; count++;
    const number = parseNumber(value); if (number === null) continue;
    numericCount++; sum += number; min = Math.min(min, number); max = Math.max(max, number);
  }
  return { count, numericCount, sum, average: numericCount ? sum / numericCount : null, min: numericCount ? min : null, max: numericCount ? max : null };
}

// Clipboard formats Google Sheets reads back cell-for-cell: TSV with quoted multi-line cells, plus an HTML table.
const tsvCell = (value) => { const text = String(value ?? ''); return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
export function toTSV(matrix) { return matrix.map((row) => row.map(tsvCell).join('\t')).join('\n'); }
const csvCell = (value) => { const text = String(value ?? ''); const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
export function toCSV(matrix) { return `${matrix.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`; }
const escapeHtml = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function toHTMLTable(matrix) { return `<table>${matrix.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</table>`; }

export function parseTSV(text) {
  const rows = []; let row = []; let field = ''; let quoted = false; const input = String(text ?? '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) { if (char === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += char; continue; }
    if (char === '"' && field === '') quoted = true;
    else if (char === '\t') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function formatStat(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const rounded = Math.abs(value) >= 100 ? Math.round(value * 100) / 100 : Math.round(value * 10000) / 10000;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(rounded);
}

// Long-form JSON (batch output, keyword lists) reads better expanded in the formula bar.
export function prettyCell(value) {
  const text = String(value ?? '');
  const body = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
  if (!/^\s*[[{]/.test(body)) return text;
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch (_) { return text; }
}
