import { describe, expect, it } from 'vitest';
import estimateModule from '../src/main/ask-estimate.js';
import roles from '../src/main/roles.js';
import { askCostLine } from '../src/renderer/src/ask-composer.jsx';

const { askEstimate } = estimateModule;
// Opus-class prices ($5 in, $25 out, $0.50 cache read per million tokens) and a prompt the size of today's (guide +
// instructions, about 185,000 characters).
const price = { basis: 'tokens', known: true, inputUsdPerMTok: 5, outputUsdPerMTok: 25, cacheReadUsdPerMTok: 0.5 };
const prefixChars = 185000;

describe('Ask AI cost estimate', () => {
  it('charges the cache write once on the Anthropic API and the cache read after it', () => {
    const estimate = askEstimate({ route: 'claude-api', price, prefixChars });
    expect(estimate).toEqual({ route: 'claude-api', metered: true, firstUsd: expect.any(Number), followUpUsd: expect.any(Number) });
    // (46,250 × 1.25 + 6,000) × $5 + 1,500 × $25 ≈ $0.36; (46,250 × $0.50 + 6,000 × $5) + 1,500 × $25 ≈ $0.09
    expect(estimate.firstUsd).toBeCloseTo(0.36, 2);
    expect(estimate.followUpUsd).toBeCloseTo(0.09, 2);
  });

  it('charges the full input every time on the Claude app, and falls back to the model’s list price', () => {
    const app = askEstimate({ route: 'claude', price, prefixChars });
    expect(app.firstUsd).toBe(app.followUpUsd);
    expect(app.followUpUsd).toBeCloseTo(0.30, 2);
    const listed = askEstimate({ route: 'openrouter', price: { basis: 'tokens', known: false }, fallback: { input: 1, output: 5 }, prefixChars });
    expect(listed.metered).toBe(true);
    expect(listed.followUpUsd).toBeCloseTo(0.06, 2);
  });

  it('shows no amounts for Codex, for an unknown price, or without a route', () => {
    expect(askEstimate({ route: 'codex', prefixChars })).toEqual({ route: 'codex', metered: false });
    expect(askEstimate({ route: 'openai', price: { basis: 'none', known: true } })).toEqual({ route: 'openai', metered: false });
    expect(askEstimate({ route: 'openrouter', price: { basis: 'tokens', known: false } })).toEqual({ route: 'openrouter', metered: true });
    expect(askEstimate({ route: '' })).toBeNull();
    expect(askEstimate({ route: 'claude-api', price, prefixChars: 0, bodyChars: 0, outputTokens: 0 }).followUpUsd).toBe(0.01); // never "$0.00"
  });

  it('is money, so a role without See costs never receives the amounts', () => {
    const stripped = roles.stripMoney({ help: { estimate: askEstimate({ route: 'claude-api', price, prefixChars }) } });
    expect(stripped.help).toEqual({}); // "estimate" is a money key, and its amounts end in Usd
    expect(roles.stripMoney(askEstimate({ route: 'claude-api', price, prefixChars }))).toEqual({ route: 'claude-api', metered: true });
  });
});

describe('the line under Ask AI’s question box', () => {
  const estimate = askEstimate({ route: 'claude-api', price, prefixChars });
  it('names the connection and the first-question cost on the Anthropic API', () => {
    expect(askCostLine({ persisted: true, estimate })).toBe('Saved for you only. About $0.09 a question on the Anthropic API ($0.36 for the first in five minutes). AI can be mistaken.');
    expect(askCostLine({ estimate: askEstimate({ route: 'claude', price, prefixChars }) })).toBe('About $0.30 a question on the Claude app. AI can be mistaken.');
  });
  it('says Codex isn’t metered, and shows no money without See costs or an estimate', () => {
    expect(askCostLine({ estimate: { route: 'codex', metered: false } })).toMatch(/^Codex isn’t metered/);
    expect(askCostLine({ persisted: true, seesCosts: false, estimate })).toBe('Saved for you only. AI can be mistaken.');
    expect(askCostLine({ estimate: roles.stripMoney(estimate) })).toMatch(/^Each question is one AI call/);
  });
});
