import { describe, expect, it } from 'vitest';
import research from '../src/shared/research-data.js';
import normalizer from '../src/shared/normalize.js';
const { prepareImport, compareSnapshots, canonicalUrl, MAX_IMPORT_BYTES } = research;
const request = (extra = {}) => ({ name: 'Customer research', sourceType: 'customer-feedback', format: 'csv', content: 'text,url\nUseful feedback,https://example.com/review', authorized: true, ...extra });
const snapshot = (id, items, extra = {}) => ({ dataset: { id, name: id, platform: 'web', recipeId: 'same-recipe', createdAt: id === 'before' ? '2026-09-20T12:00:00Z' : '2026-09-27T12:00:00Z', ...extra }, items });

describe('local research imports', () => {
  it('parses quoted commas, escaped quotation marks, and multiline CSV without executing formulas', () => {
    const result = prepareImport(request({ content: 'text,url,author\n"Line one, with comma\nLine two says ""hello""",https://example.com/one,Customer\n=HYPERLINK(""),https://example.com/two,=1+1' }));
    expect(result.items).toHaveLength(2);
    expect(result.items[0].text).toBe('Line one, with comma\nLine two says "hello"');
    expect(result.items[1]).toMatchObject({ text: '=HYPERLINK("")', author: '=1+1' });
    expect(normalizer.toCsv(result.items)).toContain("'=1+1");
    expect(normalizer.toCsv(result.items)).toContain("'=HYPERLINK");
  });

  it('previews unknown headers so users can select the text column, then imports mapped rows', () => {
    const draft = request({ preview: true, authorized: false, content: 'Response,Source\nSlow reporting,https://example.com' });
    const preview = prepareImport(draft);
    expect(preview.summary).toMatchObject({ ready: false, columns: ['Response', 'Source'], importedRows: 0 });
    const mapped = prepareImport({ ...draft, preview: false, authorized: true, mapping: { text: 'Response', url: 'Source' } });
    expect(mapped.items[0]).toMatchObject({ text: 'Slow reporting', url: 'https://example.com/' });
    expect(mapped.summary.mapping.text).toBe('Response');
  });

  it('accepts single-column CSV and detects common headers regardless of case', () => {
    expect(prepareImport(request({ content: 'Feedback\nA useful customer need' })).items[0].text).toBe('A useful customer need');
  });

  it('requires explicit authorization to import and never treats a truthy string as authorization', () => {
    expect(() => prepareImport(request({ authorized: false }))).toThrow(/permission|authorized/);
    expect(() => prepareImport(request({ authorized: 'true' }))).toThrow(/permission|authorized/);
    expect(prepareImport(request({ preview: true, authorized: false })).summary.importedRows).toBe(1);
  });

  it('deduplicates matching stable identity and semantic text while retaining changed text and different queries', () => {
    const result = prepareImport(request({ format: 'json', sourceType: 'serp', content: JSON.stringify([
      { text: 'Useful  finding', url: 'https://example.com/page?utm_source=one', query: 'query a' },
      { text: 'Useful\nfinding', url: 'https://example.com/page#heading', query: 'query a' },
      { text: 'Changed finding', url: 'https://example.com/page', query: 'query a' },
      { text: 'Useful finding', url: 'https://example.com/page', query: 'query b' },
    ]) }));
    expect(result.summary).toMatchObject({ inputRows: 4, importedRows: 3, duplicateRows: 1 });
    expect(new Set(result.items.map((item) => item.id)).size).toBe(3);
  });

  it('omits executable and credentialed links while retaining text and recording the issue', () => {
    const result = prepareImport(request({ format: 'jsonl', content: [
      { text: '<script>alert(1)</script>', url: 'javascript:alert(1)' },
      { text: 'Second record', url: 'https://user:password@example.com/private' },
      { text: 'Third record', url: 'file:///private/data' },
    ].map(JSON.stringify).join('\n') }));
    expect(result.items.map((item) => item.url)).toEqual(['', '', '']);
    expect(result.items[0].text).toBe('<script>alert(1)</script>');
    expect(result.summary.warnings.join(' ')).toMatch(/3 unsupported/);
  });

  it('flattens SERP organic results and preserves query, rank, locale, and source provenance', () => {
    const result = prepareImport(request({ format: 'json', sourceType: 'serp', content: JSON.stringify([{ searchQuery: { term: 'campaign analytics', countryCode: 'us', languageCode: 'en' }, organicResults: [{ title: 'Acme', description: 'Analytics for marketers', url: 'https://example.com', position: 3 }, { title: 'Second result', url: 'https://other.example' }] }]), metadata: { sourceName: 'Authorized search export', collectedAt: '2026-09-27' }, templateId: 'content-opportunity', brandContext: { brand: 'Acme', decision: 'Choose a topic.' } }));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ text: 'Acme\nAnalytics for marketers', query: 'campaign analytics', rank: 3, country: 'us', language: 'en', provenance: { sourceRow: 1, resultIndex: 1, collectedAt: '2026-09-27' } });
    expect(result.items[1].rank).toBeNull();
    expect(result.items[1].provenance.resultIndex).toBe(2);
    expect(result.summary.warnings.join(' ')).toMatch(/Import order is not a search ranking/);
    expect(result.dataset).toMatchObject({ platform: 'import', sourceType: 'serp', marketingBrief: { reportPresetId: 'content-opportunity', brand: 'Acme' } });
    expect(result.dataset).not.toHaveProperty('id');
  });

  it('maps ad accounts and dates without inventing a collection timestamp', () => {
    const result = prepareImport(request({ sourceType: 'ad-library', format: 'json', content: JSON.stringify([{ creative: 'Try this workflow', landing: 'https://example.com/ad', advertiser: 'Acme', started: '2026-08-01', token: 'private' }]), mapping: { text: 'creative', url: 'landing', account: 'advertiser', date: 'started' } }));
    expect(result.items[0]).toMatchObject({ type: 'ad', account: 'Acme', publishedAt: '2026-08-01', provenance: { collectedAt: '' }, raw: { token: '[redacted]' } });
  });

  it('limits preview to 20 records and rejects oversized data, malformed rows, and unmapped fields', () => {
    const content = JSON.stringify(Array.from({ length: 22 }, (_, id) => ({ id, text: `Feedback ${id}` })));
    const result = prepareImport(request({ format: 'json', content }));
    expect(result.items).toHaveLength(22);
    expect(result.summary.preview).toHaveLength(20);
    expect(() => prepareImport(request({ content: 'x'.repeat(MAX_IMPORT_BYTES + 1) }))).toThrow(/5 MB/);
    expect(() => prepareImport(request({ format: 'json', content: JSON.stringify(Array.from({ length: 5001 }, () => ({ text: 'x' }))) }))).toThrow(/5,000/);
    expect(() => prepareImport(request({ content: 'text,url\nA,b,c' }))).toThrow(/CSV row/);
    expect(() => prepareImport(request({ content: 'text,text\nA,B' }))).toThrow(/unique/);
    expect(() => prepareImport(request({ mapping: { text: 'missing' } }))).toThrow(/existing column/);
  });
});

describe('deterministic snapshot comparisons', () => {
  it('strips only known tracking parameters and fragments while retaining semantic query values', () => {
    expect(canonicalUrl('https://EXAMPLE.com/page?q=pricing&utm_source=mail#faq')).toBe('https://example.com/page?q=pricing');
    expect(canonicalUrl('https://example.com/page?ref=partner&id=2')).toBe('https://example.com/page?ref=partner&id=2');
    expect(canonicalUrl('javascript:alert(1)')).toBe('');
  });

  it('classifies whitespace-equivalent, changed, new, and unavailable records with separate capture dates', () => {
    const baseline = snapshot('before', [{ url: 'https://example.com/a?utm_source=x', text: 'Same  text' }, { url: 'https://example.com/b', text: 'Price is $10' }, { url: 'https://example.com/missing', text: 'Prior content' }]);
    const current = snapshot('after', [{ url: 'https://example.com/a#top', text: 'Same\ntext' }, { url: 'https://example.com/b', text: 'Price is $15' }, { url: 'https://example.com/new', text: 'New content' }]);
    const result = compareSnapshots({ baseline, current });
    expect(result.summary).toMatchObject({ changed: 1, unchanged: 1, new: 1, unavailable: 1, compared: 2 });
    expect(result.changes.find((change) => change.status === 'changed')).toMatchObject({ beforeExcerpt: 'Price is $10', afterExcerpt: 'Price is $15', beforeCollectedAt: '2026-09-20T12:00:00Z', afterCollectedAt: '2026-09-27T12:00:00Z' });
    expect(result.changes.find((change) => change.status === 'unavailable')).toMatchObject({ beforeExcerpt: 'Prior content', afterExcerpt: '', afterCollectedAt: '' });
    expect(result.changes.find((change) => change.status === 'new').beforeCollectedAt).toBe('');
    expect(result.warnings.join(' ')).toMatch(/does not establish.*removed/);
    expect(result.changes.some((change) => change.status === 'removed')).toBe(false);
  });

  it('centers excerpts around the first actual change even late in a long page', () => {
    const prefix = 'Shared unchanged introduction. '.repeat(150);
    const result = compareSnapshots({ baseline: snapshot('before', [{ url: 'https://example.com', text: `${prefix}Old offer.` }]), current: snapshot('after', [{ url: 'https://example.com', text: `${prefix}New offer.` }]) });
    expect(result.changes[0].beforeExcerpt).toContain('Old offer.');
    expect(result.changes[0].afterExcerpt).toContain('New offer.');
    expect(result.changes[0].beforeExcerpt.length).toBeLessThan(1700);
  });

  it('treats a first snapshot as a baseline without inventing changes', () => {
    const result = compareSnapshots({ current: snapshot('after', [{ url: 'https://example.com', text: 'First capture' }]) });
    expect(result.summary).toMatchObject({ baselineEstablished: true, changed: 0, new: 0, compared: 0 });
    expect(result.changes).toEqual([]);
  });

  it('surfaces incompatible source types and changed collection scope', () => {
    const before = snapshot('before', [{ url: 'https://example.com', text: 'A' }]);
    const after = snapshot('after', [{ url: 'https://example.com', text: 'B' }], { recipeId: 'other-recipe' });
    expect(compareSnapshots({ baseline: before, current: after })).toMatchObject({ scopeStatus: 'needs-review', summary: { changed: 1 } });
    expect(compareSnapshots({ baseline: before, current: { ...after, dataset: { ...after.dataset, platform: 'x' } } })).toMatchObject({ scopeStatus: 'incompatible', changes: [] });
    expect(() => compareSnapshots({ baseline: before, current: before })).toThrow(/different snapshots/);
  });

  it('does not make a definite change claim for conflicting duplicate URLs or empty captures', () => {
    const result = compareSnapshots({ baseline: snapshot('before', [{ url: 'https://example.com', text: 'A' }, { url: 'https://example.com', text: 'Conflicting A' }]), current: snapshot('after', [{ url: 'https://example.com', text: 'B' }, { url: 'https://empty.example', text: '' }]) });
    expect(result.summary).toMatchObject({ changed: 0, unavailable: 2 });
    expect(result.warnings.join(' ')).toMatch(/conflicting records/);
  });
});
