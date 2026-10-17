import { describe, expect, it } from 'vitest';
import { CHECK_KINDS, brandFrom, checkBrand, checkSummary, claimPhrases, isTitleCase } from '../src/renderer/src/brand-check.js';

const REPORT = `# AI Overviews Are Eating Clicks

Teams must optimise for AI answers! Guaranteed rankings are possible. CTR fell 34% last quarter.

## How teams respond

- Track citations in [the study](https://example.com/study): 41% saw drops.
- Our tool is a game-changer for SEO.
- Revenue grew $2.4 million after the change.

\`\`\`
const share = 50%!
\`\`\`
![Hero](https://example.com/hero.png)`;
const at = (text, needle) => text.indexOf(needle);

describe('brand check', () => {
  it('finds claims to avoid, house-style slips and unsourced numbers, in reading order, each pointing at its spot', () => {
    const found = checkBrand(REPORT, { claimsToAvoid: '- Guaranteed rankings\n- "Number one in Google"', editionId: 'semrush' });
    expect(found.map((row) => row.kind)).toEqual(['heading-case', 'spelling', 'exclamation', 'claim', 'unsourced-number', 'phrase', 'unsourced-number']);
    for (const row of found) expect(Object.keys(CHECK_KINDS)).toContain(row.kind);
    const claim = found.find((row) => row.kind === 'claim');
    expect(claim).toEqual({ id: `claim-${at(REPORT, 'Guaranteed')}`, kind: 'claim', message: '“Guaranteed rankings” is on your Claims to avoid list.', excerpt: 'Guaranteed rankings', index: at(REPORT, 'Guaranteed'), length: 19 });
    expect(REPORT.slice(claim.index, claim.index + claim.length)).toBe('Guaranteed rankings');
    expect(found.find((row) => row.kind === 'spelling')).toMatchObject({ excerpt: 'optimise', message: '“optimise” is British spelling. The Semrush voice is American English: “optimize”.' });
    expect(found.find((row) => row.kind === 'heading-case')).toMatchObject({ excerpt: 'AI Overviews Are Eating Clicks', index: 2 });
    expect(found.find((row) => row.kind === 'phrase')).toMatchObject({ excerpt: 'game-changer' });
    const numbers = found.filter((row) => row.kind === 'unsourced-number');
    expect(numbers.map((row) => [row.excerpt, REPORT.slice(row.index, row.index + row.length)])).toEqual([['CTR fell 34% last quarter.', '34%'], ['Revenue grew $2.4 million after the change.', '$2.4 million']]);
    // The linked study's figure, the code block and the picture are left alone.
    expect(found.some((row) => row.excerpt.includes('41%') || row.excerpt.includes('50%'))).toBe(false);
    expect(checkSummary(found)).toBe('7 things to check');
  });

  it('checks only Claims to avoid and numbers outside the Semrush edition', () => {
    const found = checkBrand(REPORT, { claimsToAvoid: 'Guaranteed rankings', editionId: 'general' });
    expect(found.map((row) => row.kind)).toEqual(['claim', 'unsourced-number', 'unsourced-number']);
    expect(checkBrand('', { editionId: 'semrush' })).toEqual([]);
    expect(checkSummary([])).toBe('Nothing to check');
    expect(checkSummary([{}])).toBe('1 thing to check');
  });

  it('matches whole words in any case and reads claims one per line, or split by ; and ,', () => {
    expect(claimPhrases('- Guaranteed results\n* "Number one in Google"; best ever, fastest tool.\n  ')).toEqual(['Guaranteed results', 'Number one in Google', 'best ever', 'fastest tool']);
    expect(checkBrand('We promise GUARANTEED   RESULTS today.', { claimsToAvoid: 'guaranteed results' })).toHaveLength(1);
    expect(checkBrand('Unguaranteed resultsets are fine.', { claimsToAvoid: 'guaranteed results' })).toEqual([]);
    expect(checkBrand('A colourful centrepiece.', { editionId: 'semrush' })).toEqual([]); // not whole words
    expect(checkBrand('The centre of it.', { editionId: 'semrush' }).map((row) => row.excerpt)).toEqual(['centre']);
  });

  it('knows Title Case from sentence case, ignoring acronyms and small words', () => {
    expect(isTitleCase('How Teams Respond To The Change')).toBe(true);
    expect(isTitleCase('What to do next with SEO and GA4')).toBe(false);
    expect(isTitleCase('AI Overviews')).toBe(false);
    expect(isTitleCase('The State of AI Search in 2026')).toBe(true);
  });

  it('counts a number as sourced when its paragraph links or cites a source', () => {
    expect(checkBrand('Clicks fell 34% ([Ahrefs](https://ahrefs.com/study)).')).toEqual([]);
    expect(checkBrand('Clicks fell 34% according to the survey.')).toEqual([]);
    expect(checkBrand('Clicks fell 34% [1].')).toEqual([]);
    expect(checkBrand('In 2026, 3 teams met.')).toEqual([]); // years and small counts aren't claims
    expect(checkBrand('Clicks fell 34%.')).toHaveLength(1);
  });

  it('takes its inputs from the workspace', () => {
    expect(brandFrom({ editionId: 'semrush', knowledge: { forbiddenClaims: 'No guarantees', voice: 'Direct', editorialRules: 'Cite everything' } })).toEqual({ claimsToAvoid: 'No guarantees', voice: 'Direct', editorialRules: 'Cite everything', editionId: 'semrush' });
    expect(brandFrom(null)).toEqual({ claimsToAvoid: '', voice: '', editorialRules: '', editionId: '' });
  });
});
