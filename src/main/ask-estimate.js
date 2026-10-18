'use strict';

// What one Ask AI question costs, for the line under the question box (ask-composer.jsx askCostLine). Pure and
// Electron-free; index.js puts the result in the state as help.estimate, and the money keys (firstUsd, followUpUsd end in
// Usd) are stripped for people without See costs, like every other amount.
//
// route: the connection Model routing resolved assistant.ask-ai to (an 'auto' route is resolved per call, so index.js
// passes the route the last answer actually used, or 'claude', Claude Code first, before any answer).
// price: that task's resolved price ({ basis, known, inputUsdPerMTok, outputUsdPerMTok }, ai-catalog priceFor), or null.
// fallback: { input, output } dollars per million tokens (research-program.js modelPrice) when the catalog doesn't know
// the model. prefixChars: the cached start of the prompt (the instructions and the app guide); bodyChars: the rest (live
// context, history, the question); outputTokens: a typical answer.
// The Anthropic API caches the prefix: the first question in five minutes writes it (1.25× the input price) and later
// ones read it (the catalog's cache-read price, else 0.1×). The Claude app's calls aren't cached and other connections
// aren't counted as cached, so each question pays the full input. Codex isn't metered: no amounts at all.
const CHARS_PER_TOKEN = 4;
const CACHE_WRITE = 1.25;
const CACHE_READ = 0.1;

const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const cents = (value) => Math.max(0.01, Math.round(value * 100) / 100);

function askEstimate({ route = '', price = null, fallback = null, prefixChars = 0, bodyChars = 24000, outputTokens = 1500 } = {}) {
  const via = typeof route === 'string' ? route.trim() : '';
  if (!via) return null;
  if (via === 'codex' || price?.basis === 'none') return { route: via, metered: false };
  const known = price && price.known && price.basis === 'tokens' && finite(price.inputUsdPerMTok) && finite(price.outputUsdPerMTok);
  const rate = known ? { input: price.inputUsdPerMTok, output: price.outputUsdPerMTok, read: finite(price.cacheReadUsdPerMTok) ? price.cacheReadUsdPerMTok : null } : fallback && finite(fallback.input) && finite(fallback.output) ? { input: fallback.input, output: fallback.output, read: null } : null;
  if (!rate) return { route: via, metered: true };
  const prefix = (finite(prefixChars) ? prefixChars : 0) / CHARS_PER_TOKEN;
  const body = (finite(bodyChars) ? bodyChars : 0) / CHARS_PER_TOKEN;
  const answer = (finite(outputTokens) ? outputTokens : 0) * rate.output;
  const cached = via === 'claude-api';
  const first = ((cached ? prefix * CACHE_WRITE : prefix) + body) * rate.input + answer;
  const followUp = (cached ? prefix * (rate.read ?? rate.input * CACHE_READ) : prefix * rate.input) + body * rate.input + answer;
  return { route: via, metered: true, firstUsd: cents(first / 1e6), followUpUsd: cents(followUp / 1e6) };
}

module.exports = { askEstimate, CHARS_PER_TOKEN };
