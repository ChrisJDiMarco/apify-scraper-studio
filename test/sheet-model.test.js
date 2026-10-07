import { describe, expect, it } from 'vitest';
import { cellAddress, chipTone, columnKeys, columnLetter, compareCells, defaultColumnWidth, distinctValues, inferColumnType, isChipColumn, matchesFilter, parseDate, parseNumber, parseTSV, prettyCell, selectionBounds, selectionStats, sortRowIndexes, toCSV, toHTMLTable, toTSV } from '../src/shared/sheet-model.js';

describe('sheet addresses', () => {
  it('names columns and cells the way Google Sheets does', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(cellAddress(2, 0)).toBe('A2');
    expect(cellAddress(1822, 21)).toBe('V1822');
  });

  it('keys edits by unique labels and falls back to letters for blank or repeated headers', () => {
    expect(columnKeys(['Theme', 'Count', '', 'Count', 'Notes'])).toEqual(['Theme', '#B', '#C', '#D', 'Notes']);
  });
});

describe('cell types', () => {
  it('reads numbers with separators, currency and percentages but not dates or words', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('11.30%')).toBe(11.3);
    expect(parseNumber('$5.25')).toBe(5.25);
    expect(parseNumber('-7')).toBe(-7);
    expect(parseNumber('2026-09-28')).toBeNull();
    expect(parseNumber('NEW ANGLE')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('reads the date formats the platforms export', () => {
    expect(parseDate('2026-09-28T00:31:28.473Z')).toBe(Date.parse('2026-09-28T00:31:28.473Z'));
    expect(parseDate('2026-02-24 3:18')).not.toBeNull();
    expect(parseDate('Wed Oct 07 12:34:36 +0000 2026')).toBe(Date.parse('Wed Oct 07 12:34:36 +0000 2026'));
    expect(parseDate('42')).toBeNull();
  });

  it('infers column types from the values, with the header as a hint for empty columns', () => {
    expect(inferColumnType('post_url', ['https://x.com/a/status/1', 'https://x.com/b/status/2'])).toBe('url');
    expect(inferColumnType('likeCount', ['1', '20', '300'])).toBe('number');
    expect(inferColumnType('isReply', ['TRUE', 'FALSE', 'false'])).toBe('bool');
    expect(inferColumnType('createdAt', ['Wed Oct 07 12:34:36 +0000 2026', 'Tue Oct 06 08:00:00 +0000 2026'])).toBe('date');
    expect(inferColumnType('matching_keywords', ['["GEO","AIO"]', '["LLM"]'])).toBe('json');
    expect(inferColumnType('post_text', ['A long post '.repeat(20)])).toBe('longtext');
    expect(inferColumnType('Theme', ['Pricing', 'Reporting'])).toBe('text');
    expect(inferColumnType('Confidence Score', ['', ''])).toBe('number');
    expect(inferColumnType('Profile URL', [])).toBe('url');
  });

  it('shows short repeating labels as chips, never free text', () => {
    expect(isChipColumn('Novelty', 'text', ['NEW ANGLE', 'NEW TOPIC', 'NEW ANGLE', 'EVERGREEN'])).toBe(true);
    expect(isChipColumn('Pain_Point_Type', 'text', ['Loss of Traffic/Visibility', 'Proving ROI/Attribution', 'Loss of Traffic/Visibility', ''])).toBe(true);
    expect(isChipColumn('post_text', 'text', ['same', 'same'])).toBe(false);
    expect(isChipColumn('Entities_Companies', 'text', ['Google', 'Google'])).toBe(false);
    expect(isChipColumn('Theme', 'text', Array.from({ length: 20 }, (_, i) => `Theme ${i}`))).toBe(false);
    expect(isChipColumn('likeCount', 'number', ['1', '1'])).toBe(false);
    expect(chipTone('NEW ANGLE')).toBe(chipTone('NEW ANGLE'));
  });

  it('sizes columns by type and content within sensible bounds', () => {
    expect(defaultColumnWidth('post_text', 'longtext', ['x'])).toBe(340);
    const narrow = defaultColumnWidth('likes', 'number', ['1', '2']);
    expect(narrow).toBeGreaterThanOrEqual(72);
    expect(narrow).toBeLessThan(140);
    expect(defaultColumnWidth('author', 'text', ['a'.repeat(200)])).toBeLessThanOrEqual(300);
  });
});

describe('sorting and filtering', () => {
  const rows = [['b', '10'], ['', '2'], ['a', ''], ['C', '1,000']];
  const get = (row, column) => rows[row][column];

  it('sorts numbers numerically and keeps blanks last in both directions', () => {
    expect(sortRowIndexes([0, 1, 2, 3], get, 1, 'number', 'asc')).toEqual([1, 0, 3, 2]);
    expect(sortRowIndexes([0, 1, 2, 3], get, 1, 'number', 'desc')).toEqual([3, 0, 1, 2]);
    expect(sortRowIndexes([0, 1, 2, 3], get, 0, 'text', 'asc')).toEqual([2, 0, 3, 1]);
  });

  it('compares dates and booleans by meaning, not spelling', () => {
    expect(compareCells('2026-01-02', '2025-12-31', 'date')).toBeGreaterThan(0);
    expect(compareCells('TRUE', 'FALSE', 'bool')).toBeGreaterThan(0);
  });

  it('filters by chosen values and by contained text', () => {
    expect(matchesFilter('Reddit', { values: ['Reddit', 'LinkedIn'] })).toBe(true);
    expect(matchesFilter('Twitter', { values: ['Reddit'] })).toBe(false);
    expect(matchesFilter('AI Overviews tripled', { contains: 'overview' })).toBe(true);
    expect(matchesFilter('AI Overviews tripled', { values: ['AI Overviews tripled'], contains: 'zero' })).toBe(false);
    expect(matchesFilter('anything', null)).toBe(true);
  });

  it('lists distinct values by frequency for the filter menu', () => {
    const values = ['x', 'y', 'x', '', 'x', 'y'];
    expect(distinctValues([0, 1, 2, 3, 4, 5], (row) => values[row], 0)).toEqual([{ value: 'x', count: 3 }, { value: 'y', count: 2 }, { value: '', count: 1 }]);
  });
});

describe('selection and clipboard', () => {
  it('normalizes a dragged selection in any direction', () => {
    expect(selectionBounds({ anchor: { row: 5, column: 3 }, focus: { row: 2, column: 1 } })).toEqual({ top: 2, bottom: 5, left: 1, right: 3 });
    expect(selectionBounds(null)).toBeNull();
  });

  it('summarizes numbers like the Sheets status bar and ignores blanks and text', () => {
    expect(selectionStats(['1', '2', '', 'n/a', '3'])).toEqual({ count: 4, numericCount: 3, sum: 6, average: 2, min: 1, max: 3 });
    expect(selectionStats(['a', 'b']).average).toBeNull();
  });

  it('round-trips tabs, newlines and quotes through the TSV Google Sheets pastes', () => {
    const matrix = [['post_url', 'post_text'], ['https://x.com/a', 'line one\nline "two"\tend']];
    const text = toTSV(matrix);
    expect(text.split('\n')[0]).toBe('post_url\tpost_text');
    expect(parseTSV(text)).toEqual(matrix);
    expect(parseTSV('a\tb\r\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('writes CSV that spreadsheets cannot execute and an HTML table for rich paste', () => {
    expect(toCSV([['=SUM(A1)', 'plain, text', '+1']])).toBe("'=SUM(A1),\"plain, text\",'+1\r\n");
    expect(toHTMLTable([['<b>', 'a\nb']])).toBe('<table><tr><td>&lt;b&gt;</td><td>a<br>b</td></tr></table>');
  });

  it('expands JSON cells for reading, including fenced model output', () => {
    expect(prettyCell('{"candidates":[{"name":"GEO"}]}')).toBe('{\n  "candidates": [\n    {\n      "name": "GEO"\n    }\n  ]\n}');
    expect(prettyCell('```json\n{"a":1}\n```')).toBe('{\n  "a": 1\n}');
    expect(prettyCell('not json')).toBe('not json');
  });
});
