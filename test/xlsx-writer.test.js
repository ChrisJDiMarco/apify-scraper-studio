import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import unzipper from 'unzipper';
import writer from '../src/shared/xlsx-writer.js';
import importer from '../src/main/workbook-import.js';
const { buildXlsx, exactNumber, sheetNames, crc32, MAX_XLSX_CELL_CHARS } = writer;
const { parseWorkbookBuffer } = importer;

const read = (buffer) => parseWorkbookBuffer({ buffer, fileName: 'Export.xlsx' });
async function parts(buffer) {
  const directory = await unzipper.Open.buffer(buffer);
  return Object.fromEntries(await Promise.all(directory.files.map(async (entry) => [entry.path, { text: (await entry.buffer()).toString('utf8'), flags: entry.flags, method: entry.compressionMethod }])));
}

const twitter = {
  name: 'Twitter', frozenColumns: 1,
  columns: ['post_url', 'post_text', 'likeCount', 'Confidence_Score', 'Theme'],
  rows: [
    ['https://x.com/aleyda/status/1', 'AI Overviews are eating branded clicks & <reporting> can’t show it.', '100', '0.86', 'Generative Visibility'],
    ['https://x.com/lily/status/2', 'Reporting AI visibility is manual.\nSecond line.', '4', '', ''],
  ],
};
const themes = { name: 'Theme Repository', columns: ['Theme', 'matching_keywords', 'Novelty'], rows: [['Generative Visibility', '["GEO","AI Overviews"]', 'NEW ANGLE']] };

describe('xlsx writer', () => {
  it('round-trips several tabs through the app’s own spreadsheet reader', async () => {
    const workbook = await read(buildXlsx({ title: 'Semrush social trends', sheets: [themes, twitter, { name: 'Taxonomy Lookup', columns: ['Category', '% Share'], rows: [] }] }));
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Theme Repository', 'Twitter', 'Taxonomy Lookup']);
    expect(workbook.sheets[0].rows).toEqual([themes.columns, ...themes.rows]);
    expect(workbook.sheets[1].rows).toEqual([twitter.columns, ...twitter.rows]);
    expect(workbook.sheets[2].rows).toEqual([['Category', '% Share']]); // header-only tabs keep their header
    expect(workbook.warnings).toEqual([]);
  });

  it('keeps unicode, empty cells, whitespace and long text exactly', async () => {
    const long = 'Long post. '.repeat(2500).trim(); // 27,499 characters: under Excel’s per-cell limit
    const sheet = { name: 'Données ☕ 日本', columns: ['Nom', 'Note', 'Texte'], rows: [['Café ☕', '', '  indented and trailing  '], ['', 'Ünïcödé — “quotes” 🚀', long], ['emoji 👩🏽‍💻', 'tab\tinside', 'x']] };
    const [parsed] = (await read(buildXlsx({ sheets: [sheet] }))).sheets;
    expect(parsed.name).toBe('Données ☕ 日本');
    expect(parsed.rows).toEqual([sheet.columns, ...sheet.rows]);
  });

  it('writes numbers that read back exactly as real numbers and everything else as text', async () => {
    const cells = ['100', '0.86', '0', '123456789012345', '007', '1e5', '1.50', '-3', '+5', '12345678901234567', '0.30000000000000004', '1,234', '$5'];
    const buffer = buildXlsx({ sheets: [{ name: 'Numbers', columns: cells.map((_, index) => `c${index}`), rows: [cells] }] });
    const sheetXml = (await parts(buffer))['xl/worksheets/sheet1.xml'].text;
    const numeric = [...sheetXml.matchAll(/<c r="([A-Z]+)2"><v>([^<]*)<\/v><\/c>/g)].map((match) => match[2]);
    expect(numeric).toEqual(['100', '0.86', '0', '123456789012345']);
    expect((await read(buffer)).sheets[0].rows[1]).toEqual(cells);
    expect(cells.map(exactNumber)).toEqual([100, 0.86, 0, 123456789012345, null, null, null, null, null, null, null, null, null]);
  });

  it('never writes formulas and keeps formula-like text as quoted text', async () => {
    const risky = ['=HYPERLINK("https://evil.example","click")', '+1 to this', '-5', '@aleyda said', ' =SUM(A1:A2)'];
    const buffer = buildXlsx({ sheets: [{ name: 'Risky', columns: ['a', 'b', 'c', 'd', 'e'], rows: [risky] }] });
    const files = await parts(buffer);
    const sheetXml = files['xl/worksheets/sheet1.xml'].text;
    expect(sheetXml).not.toMatch(/<f[ >]/);
    expect([...sheetXml.matchAll(/<c r="[A-E]2" t="inlineStr" s="2">/g)]).toHaveLength(5);
    expect(files['xl/styles.xml'].text).toContain('quotePrefix="1"');
    expect((await read(buffer)).sheets[0].rows[1]).toEqual(risky);
  });

  it('bolds and freezes the header row and keeps frozen columns', async () => {
    const buffer = buildXlsx({ sheets: [twitter, themes] });
    const files = await parts(buffer);
    expect(files['xl/worksheets/sheet1.xml'].text).toContain('<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>');
    expect(files['xl/worksheets/sheet2.xml'].text).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(files['xl/worksheets/sheet1.xml'].text).toMatch(/<row r="1"><c r="A1" t="inlineStr" s="1">/);
    expect(files['xl/styles.xml'].text).toMatch(/<font><b\/>/);
    expect(files['xl/worksheets/sheet1.xml'].text).toMatch(/<cols><col min="1" max="1" width="\d+" customWidth="1"\/>/);
    const workbook = await read(buffer);
    expect(workbook.sheets[0].frozenColumns).toBe(1);
    expect(workbook.sheets[1].frozenColumns).toBeUndefined();
  });

  it('sanitizes sheet names to Excel’s rules and keeps them unique', () => {
    expect(sheetNames(['Theme/Repository: [draft]?', 'a'.repeat(40), 'Twitter', 'twitter', "'quoted'", '', 'History', 'x\ty', 'nul\u0000l'])).toEqual([
      'Theme Repository draft', 'a'.repeat(31), 'Twitter', 'twitter (2)', 'quoted', 'Sheet6', 'History (2)', 'x y', 'null',
    ]);
    const names = sheetNames(Array.from({ length: 3 }, () => 'A very long tab name that keeps going'));
    expect(names.every((name) => name.length <= 31)).toBe(true);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(3);
  });

  it('escapes XML, strips characters XML cannot carry, and clips cells to Excel’s limit', async () => {
    const huge = 'y'.repeat(MAX_XLSX_CELL_CHARS + 50);
    let stats = null;
    const buffer = buildXlsx({ title: 'R&D <draft>', sheets: [{ name: 'Tom & "Jerry"', columns: ['a<b', 'c'], rows: [['x\u0001\u0008y\uFFFEz', huge], ['lone \uD800 surrogate', 'ok']] }], onStats: (value) => { stats = value; } });
    const files = await parts(buffer);
    expect(files['docProps/core.xml'].text).toContain('<dc:title>R&amp;D &lt;draft&gt;</dc:title>');
    expect(files['xl/workbook.xml'].text).toContain('name="Tom &amp; &quot;Jerry&quot;"');
    const [sheet] = (await read(buffer)).sheets;
    expect(sheet.name).toBe('Tom & "Jerry"');
    expect(sheet.rows[0]).toEqual(['a<b', 'c']);
    expect(sheet.rows[1]).toEqual(['xyz', 'y'.repeat(MAX_XLSX_CELL_CHARS)]);
    expect(sheet.rows[2]).toEqual(['lone  surrogate', 'ok']);
    expect(stats.truncatedCells).toBe(1);
  });

  it('writes a standard ZIP container: UTF-8 names, deflate, valid CRC-32', async () => {
    const buffer = buildXlsx({ sheets: [twitter] });
    expect(buffer.readUInt32LE(0)).toBe(0x04034b50);
    expect(buffer.readUInt32LE(buffer.length - 22)).toBe(0x06054b50);
    const files = await parts(buffer);
    expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
    expect(Object.values(files).every((file) => file.method === 8 && (file.flags & 0x0800))).toBe(true);
    for (const sample of [Buffer.alloc(0), Buffer.from('hello'), Buffer.from('é☕'.repeat(1000))]) if (zlib.crc32) expect(crc32(sample)).toBe(zlib.crc32(sample));
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926); // the standard check value
  });

  it('rejects malformed input with a clear message', () => {
    expect(() => buildXlsx({ sheets: [] })).toThrow(/at least one sheet/);
    expect(() => buildXlsx({ sheets: [{ name: 'x', columns: 'nope', rows: [] }] })).toThrow(/header row and rows/);
    expect(() => buildXlsx({ sheets: [{ name: 'x', columns: [], rows: ['not a row'] }] })).toThrow(/header row and rows/);
  });

  it('builds a 3,000 × 22 research tab quickly', async () => {
    const columns = Array.from({ length: 22 }, (_, index) => `column_${index}`);
    const rows = Array.from({ length: 3000 }, (_, row) => columns.map((_, column) => (column % 4 === 0 ? String(row * column) : `Row ${row} column ${column}: AI Overviews and GEO reporting notes`)));
    const started = performance.now();
    const buffer = buildXlsx({ sheets: [{ name: 'Twitter', columns, rows, frozenColumns: 1 }] });
    expect(performance.now() - started).toBeLessThan(1500);
    const [sheet] = (await read(buffer)).sheets;
    expect(sheet.rows).toHaveLength(3001);
    expect(sheet.rows[3000]).toEqual(rows[2999]);
  });
});
