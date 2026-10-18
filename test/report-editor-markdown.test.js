import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { jsonToMarkdown, markdownToJSON, normalizeMarkdown, safeHref } from '../src/renderer/src/report-editor/markdown.js';
import { FIELD, createReportYDoc, fromBase64, seedClientId, seedUpdate, toBase64 } from '../src/renderer/src/report-editor/ydoc.js';

const roundTrip = (markdown) => jsonToMarkdown(markdownToJSON(markdown));
// A block survives when Markdown → document → Markdown gives it back, and a second trip changes nothing.
function survives(markdown, expected = markdown) {
  const once = roundTrip(markdown);
  expect(once).toBe(expected);
  expect(roundTrip(once)).toBe(once);
  expect(markdownToJSON(once)).toEqual(markdownToJSON(markdown));
}

describe('report Markdown round trip', () => {
  it.each([
    ['headings', '# Title\n\n## Section\n\n### Detail\n\n#### Small'],
    ['paragraphs', 'First paragraph.\n\nSecond paragraph with more words.'],
    ['bold, italic, strike and code', 'Some **bold**, *italic*, ~~gone~~ and `code` text.'],
    ['links', 'Read [the source](https://example.com/a?b=1) first.'],
    ['bullet lists', '- one\n- two with **bold**\n- three'],
    ['nested lists', '- parent\n  - child\n  - second child\n- next'],
    ['numbered lists', '1. first\n2. second\n3. third'],
    ['quotes', '> A quote from the research.'],
    ['code blocks', '```js\nconst a = 1;\n\n\nconst b = 2;\n```'],
    ['dividers', 'Above\n\n---\n\nBelow'],
  ])('keeps %s', (_name, markdown) => survives(markdown));

  it('keeps tables (columns padded once, then stable)', () => {
    const markdown = '| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |';
    const once = roundTrip(markdown);
    expect(once).toBe('| Name | Value |\n| ---- | ----- |\n| A    | 1     |\n| B    | 2     |');
    expect(roundTrip(once)).toBe(once);
    expect(markdownToJSON(once)).toEqual(markdownToJSON(markdown));
  });

  it('keeps a whole generated report readable and stable', () => {
    const report = '# AI Overviews\n\nIntro with **bold** and a [link](https://example.com).\n\n## What we saw\n\n- Posts rose\n- Threads grew\n\n> “Zero-click is the new normal.”\n\n| Platform | Posts |\n| -------- | ----- |\n| X        | 120   |\n\n```\nraw\n```\n\n---\n\n1. Act\n2. Measure';
    survives(report);
  });

  it('tidies blank lines outside code only', () => {
    expect(normalizeMarkdown('A\n\n\n\nB\n\n```\nx\n\n\ny\n```\n\n\n')).toBe('A\n\nB\n\n```\nx\n\n\ny\n```');
    expect(normalizeMarkdown('A\n\n&nbsp;\n\nB')).toBe('A\n\nB');
  });

  it('reads empty and odd input without throwing', () => {
    expect(markdownToJSON('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(jsonToMarkdown(null)).toBe('');
    expect(roundTrip('Just text')).toBe('Just text');
  });

  it('only allows web and mail links', () => {
    expect(safeHref('example.com/page')).toBe('https://example.com/page');
    expect(safeHref('https://semrush.com')).toBe('https://semrush.com');
    expect(safeHref('pat@example.com')).toBe('mailto:pat@example.com');
    expect(safeHref('javascript:alert(1)')).toBe('');
    expect(safeHref('')).toBe('');
  });
});

describe('report live document', () => {
  it('seeds the same document under the same id from the same Markdown, so two first openers merge into one copy', () => {
    const markdown = '# Title\n\nBody.';
    expect(seedClientId(markdown)).toBe(seedClientId(markdown));
    expect(seedClientId(markdown)).not.toBe(seedClientId(`${markdown}!`));
    const a = createReportYDoc({ markdown }); const b = createReportYDoc({ markdown });
    expect(a.seeded).toBe(true);
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc));
    expect(a.ydoc.getXmlFragment(FIELD).length).toBe(2); // heading + paragraph, not four
  });

  it('opens from saved live state when the studio has it', () => {
    const update = seedUpdate('Saved text.');
    const { ydoc, seeded } = createReportYDoc({ yState: toBase64(update), markdown: 'Ignored.' });
    expect(seeded).toBe(false);
    expect(ydoc.getXmlFragment(FIELD).toString()).toContain('Saved text.');
  });

  it('encodes base64 both ways', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
    expect(toBase64(new Uint8Array(0))).toBe('');
  });
});
