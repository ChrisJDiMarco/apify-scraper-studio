import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import importer from '../src/main/workbook-import.js';
const { parseWorkbookBuffer, parseDelimited, columnIndex, formatSerialDate } = importer;

// A minimal, valid .xlsx built in memory: the same parts Google Sheets writes when you download a workbook.
function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'); const compressed = zlib.deflateRawSync(data); const crc = zlib.crc32(data); const fileName = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fileName.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, compressed); centrals.push(central, fileName); offset += local.length + fileName.length + compressed.length;
  }
  const directory = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
function goldenThreadXlsx() {
  return zip({
    'xl/workbook.xml': `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="Theme Repository" sheetId="1" r:id="rId1"/><sheet name="Trend Velocity" sheetId="2" r:id="rId2"/><sheet name="Scratch" sheetId="3" state="hidden" r:id="rId3"/><sheet name="Internal" sheetId="4" state="veryHidden" r:id="rId4"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="/xl/worksheets/sheet3.xml"/><Relationship Id="rId4" Target="worksheets/sheet4.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst ${NS}><si><t>Theme</t></si><si><t>Novelty</t></si><si><r><t>Generative Visibility </t></r><r><t>Replaces Rankings</t></r><rPh><t>ignored</t></rPh></si><si><t xml:space="preserve">NEW ANGLE</t></si><si><t>Date</t></si><si><t>% Share</t></si></sst>`,
    'xl/styles.xml': `<?xml version="1.0"?><styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd h:mm"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="10"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" state="frozen"/></sheetView></sheetViews><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>inline note</t></is></c><c r="C2" t="s"><v>3</v></c><c r="D2" t="b"><v>1</v></c></row><row r="5"><c r="A5" s="0"/></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<?xml version="1.0"?><worksheet ${NS}><sheetData><row r="1"><c r="A1" t="s"><v>4</v></c><c r="B1" t="s"><v>5</v></c><c r="C1" t="str"><f>A1</f><v>Count</v></c></row><row r="2"><c r="A2" s="1"><v>46077.1375</v></c><c r="B2" s="2"><v>0.113</v></c><c r="C2"><v>0.30000000000000004</v></c><c r="D2" s="3"><v>46077</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet3.xml': `<?xml version="1.0"?><worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>scratch</t></is></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet4.xml': `<?xml version="1.0"?><worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>secret</t></is></c></row></sheetData></worksheet>`,
  });
}

describe('xlsx import', () => {
  it('reads every visible tab in order with the values the spreadsheet showed', async () => {
    const workbook = await parseWorkbookBuffer({ buffer: goldenThreadXlsx(), fileName: 'Internal NEW - Golden Thread Data Sheet.xlsx' });
    expect(workbook.name).toBe('Internal NEW - Golden Thread Data Sheet');
    expect(workbook.sheets.map((sheet) => [sheet.name, sheet.hidden])).toEqual([['Theme Repository', false], ['Trend Velocity', false], ['Scratch', true]]);
    expect(workbook.sheets[0].frozenColumns).toBe(1); // the sheet's frozen first column carries over
    expect(workbook.sheets[1].frozenColumns).toBeUndefined();
    // Sparse cells are filled, rich text joins its runs, phonetic hints are dropped, trailing blank rows go.
    expect(workbook.sheets[0].rows).toEqual([['Theme', '', 'Novelty', ''], ['Generative Visibility Replaces Rankings', 'inline note', 'NEW ANGLE', 'TRUE']]);
    // Date and percent styles read like the sheet; formulas use their cached result; float noise is trimmed.
    expect(workbook.sheets[1].rows).toEqual([['Date', '% Share', 'Count', ''], ['2026-02-24 03:18', '11.30%', '0.3', '2026-02-24']]);
  });

  it('turns spreadsheet serials into dates in both date systems', () => {
    expect(formatSerialDate(46077, { isDate: true, hasDate: true, hasTime: false })).toBe('2026-02-24');
    expect(formatSerialDate(0.5, { isDate: true, hasDate: false, hasTime: true })).toBe('12:00');
    expect(formatSerialDate(0, { isDate: true, hasDate: true }, true)).toBe('1904-01-01');
  });

  it('maps cell references to columns', () => {
    expect(['A1', 'Z9', 'AA10', 'BA2', ''].map(columnIndex)).toEqual([0, 25, 26, 52, -1]);
  });

  it('refuses files it cannot read and explains how to get a usable copy', async () => {
    await expect(parseWorkbookBuffer({ buffer: Buffer.from('not a zip'), fileName: 'sheet.xlsx' })).rejects.toThrow(/Download it again/);
    await expect(parseWorkbookBuffer({ buffer: Buffer.from('a,b'), fileName: 'sheet.pdf' })).rejects.toThrow(/\.xlsx, \.csv or \.tsv/);
    await expect(parseWorkbookBuffer({ buffer: Buffer.alloc(0), fileName: 'sheet.csv' })).rejects.toThrow(/nonempty/);
  });
});

describe('csv import', () => {
  it('handles quoted newlines, doubled quotes, a byte-order mark and blank trailing rows', async () => {
    const text = '﻿post_url,post_text,likeCount\r\nhttps://x.com/a,"Two\nlines, ""quoted""",12\r\n,,\r\n';
    const workbook = await parseWorkbookBuffer({ buffer: Buffer.from(text, 'utf8'), fileName: 'Twitter.csv' });
    expect(workbook.sheets).toEqual([{ name: 'Twitter', hidden: false, rows: [['post_url', 'post_text', 'likeCount'], ['https://x.com/a', 'Two\nlines, "quoted"', '12']] }]);
  });

  it('sniffs semicolon and tab delimiters', async () => {
    expect((await parseWorkbookBuffer({ buffer: Buffer.from('a;b\n1;2'), fileName: 'eu.csv' })).sheets[0].rows).toEqual([['a', 'b'], ['1', '2']]);
    expect((await parseWorkbookBuffer({ buffer: Buffer.from('a\tb\n1\t2'), fileName: 'tabs.tsv' })).sheets[0].rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('x,"y,z"', ',')).toEqual([['x', 'y,z']]);
  });
});
