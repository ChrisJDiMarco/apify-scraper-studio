// Brand check for the report editor: local, deterministic checks against the workspace's Claims to avoid and the
// edition's house rules (src/shared/content-studio.js holds the same rules for the writers). It never calls an AI,
// never blocks Save and only points at spots worth a second look. Pure ESM.
//
// checkBrand(markdown, { claimsToAvoid, editionId }) → [{ id, kind, message, excerpt, index }], in reading order.
// kind: 'claim' | 'phrase' | 'heading-case' | 'spelling' | 'exclamation' | 'unsourced-number'. index (and length) is
// the spot in the Markdown the editor selects; excerpt is the words around it, for the list.

export const MAX_FINDINGS = 40;
export const CHECK_KINDS = Object.freeze({
  claim: 'Claims to avoid',
  phrase: 'Phrases the style avoids',
  'heading-case': 'Sentence case headings',
  spelling: 'American spelling',
  exclamation: 'No exclamation marks',
  'unsourced-number': 'Numbers need a source',
});
// The Semrush edition's banned phrases (content-studio.js editionRules) and the one product never to recommend.
const SEMRUSH_PHRASES = ['flying blind', 'blind spots', 'blind spot', 'game-changer', 'game changer', 'revolutionary', 'unleash', 'supercharge', 'Semrush One'];
// British spellings the Semrush voice (American English) writes the American way. Matched whole-word, any case.
const SPELLINGS = {
  colour: 'color', colours: 'colors', favour: 'favor', favourite: 'favorite', behaviour: 'behavior', behaviours: 'behaviors', humour: 'humor', honour: 'honor', labour: 'labor', neighbour: 'neighbor',
  organisation: 'organization', organisations: 'organizations', organise: 'organize', organised: 'organized', optimise: 'optimize', optimised: 'optimized', optimising: 'optimizing', optimisation: 'optimization',
  analyse: 'analyze', analysed: 'analyzed', analysing: 'analyzing', prioritise: 'prioritize', prioritised: 'prioritized', realise: 'realize', realised: 'realized', recognise: 'recognize', recognised: 'recognized',
  utilise: 'utilize', customise: 'customize', customised: 'customized', summarise: 'summarize', summarised: 'summarized', minimise: 'minimize', maximise: 'maximize', categorise: 'categorize', monetise: 'monetize', monetisation: 'monetization',
  emphasise: 'emphasize', personalise: 'personalize', personalised: 'personalized', personalisation: 'personalization', standardise: 'standardize', visualise: 'visualize', visualisation: 'visualization',
  centre: 'center', centres: 'centers', metre: 'meter', theatre: 'theater', fibre: 'fiber', programme: 'program', programmes: 'programs', catalogue: 'catalog', dialogue: 'dialog',
  travelling: 'traveling', travelled: 'traveled', labelled: 'labeled', labelling: 'labeling', modelling: 'modeling', modelled: 'modeled', cancelled: 'canceled', defence: 'defense', offence: 'offense', licence: 'license',
  whilst: 'while', amongst: 'among', learnt: 'learned', judgement: 'judgment', grey: 'gray', cheque: 'check',
};
// Small words that stay lower case in Title Case, so they don't count either way.
const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'if', 'in', 'into', 'is', 'nor', 'of', 'on', 'or', 'over', 'per', 'so', 'the', 'than', 'to', 'up', 'via', 'vs', 'with', 'yet']);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clip = (value, max = 90) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text; };
// "Phrase", one per line or separated by ; or , (a sentence-long claim stays whole when it has no separators).
export function claimPhrases(claimsToAvoid) {
  const text = Array.isArray(claimsToAvoid) ? claimsToAvoid.join('\n') : String(claimsToAvoid || '');
  return [...new Set(text.split(/\n|;|,(?=\s)/).map((part) => part.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["“'‘]|["”'’]$/g, '').replace(/\.$/, '').trim()).filter((part) => part.length >= 3 && part.length <= 120))];
}
// Spans that aren't prose: fenced code, inline code, link targets and bare URLs. Checks skip anything inside them.
function maskedRanges(markdown) {
  const ranges = [];
  for (const pattern of [/```[\s\S]*?(```|$)/g, /`[^`\n]+`/g, /\]\([^)]*\)/g, /\bhttps?:\/\/\S+/g, /<[^>\n]+>/g]) {
    for (const match of markdown.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}
const inside = (ranges, index) => ranges.some(([start, end]) => index >= start && index < end);

// A heading in Title Case: most words after the first start with a capital, and at least two do.
export function isTitleCase(heading) {
  const words = String(heading || '').replace(/[*_`[\]()]/g, '').split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  const rest = words.slice(1).map((word) => word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')).filter((word) => word && !MINOR.has(word.toLowerCase()));
  // Acronyms and product names written in capitals (SEO, AI, GA4) don't count either way.
  const counted = rest.filter((word) => !/^[A-Z0-9]{2,}$/.test(word) && !/[a-z][A-Z]/.test(word));
  const capped = counted.filter((word) => /^[A-Z]/.test(word));
  return counted.length >= 2 && capped.length >= 2 && capped.length / counted.length >= 0.75;
}

// Numbers worth sourcing: percentages, money, multiples and large figures. Years, dates, ordinals and list numbers don't count.
const FIGURE = /(?:[$€£]\s?\d[\d,.]*(?:\s?(?:million|billion|thousand)\b|[kKmMbB]\b)?|\b\d[\d,.]*\s?(?:%|percent\b|x\b|times\b|million\b|billion\b|thousand\b)|\b\d{1,3}(?:,\d{3})+\b|\b\d{5,}\b)/g;
// A block (paragraph, list item, table row) counts as sourced when it links somewhere or cites a reference.
const SOURCED = /\]\(\s*https?:\/\/|\bhttps?:\/\/|\[\d+\]|\[\^[^\]]+\]|\(source[:\s]|\bsource:|\baccording to\b|\bper\s+[A-Z]|\bevidence\s*id\b|\b(?:ev|evidence|post)-[\w-]+/i;

export function checkBrand(markdown, { claimsToAvoid = '', editionId = '' } = {}) {
  const text = String(markdown || ''); if (!text.trim()) return [];
  const semrush = editionId === 'semrush'; const masked = maskedRanges(text); const findings = []; const seen = new Set();
  const add = (kind, index, excerpt, message, length = excerpt.length) => {
    const key = `${kind}:${index}`; if (seen.has(key) || findings.length >= MAX_FINDINGS * 2) return; seen.add(key);
    findings.push({ id: `${kind}-${index}`, kind, message, excerpt, index, length });
  };
  // Claims to avoid, then the edition's phrases: whole words, any case.
  const phrase = (kind, value, message) => {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(value).replace(/\\?\s+/g, '\\s+')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    for (const match of text.matchAll(pattern)) { const index = match.index + match[1].length; if (!inside(masked, index)) add(kind, index, match[2], message(match[2])); }
  };
  for (const claim of claimPhrases(claimsToAvoid)) phrase('claim', claim, (found) => `“${clip(found, 60)}” is on your Claims to avoid list.`);
  if (semrush) {
    for (const value of SEMRUSH_PHRASES) phrase('phrase', value, (found) => (/semrush one/i.test(found) ? 'The Semrush style doesn’t recommend Semrush One.' : `“${found}” is a phrase the Semrush style avoids.`));
    for (const [british, american] of Object.entries(SPELLINGS)) phrase('spelling', british, (found) => `“${found}” is British spelling. The Semrush voice is American English: “${/^[A-Z]/.test(found) ? american[0].toUpperCase() + american.slice(1) : american}”.`);
  }
  // Headings, line by line, with their offsets.
  let offset = 0; let inCode = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const heading = !inCode && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading && semrush && isTitleCase(heading[2])) add('heading-case', offset + line.indexOf(heading[2]), clip(heading[2]), `“${clip(heading[2], 60)}” is in Title Case. Semrush headings use sentence case.`, heading[2].length);
    offset += line.length + 1;
  }
  // "Huge news!" but not an image (![alt](…)) or code: the mark has to follow a word.
  if (semrush) for (const match of text.matchAll(/[\p{L}\p{N}”’")*_]!+/gu)) { const index = match.index + 1; if (!inside(masked, index)) add('exclamation', index, clip(text.slice(text.lastIndexOf(' ', index) + 1, index + match[0].length - 1), 40), 'The Semrush voice uses no exclamation marks.', match[0].length - 1); }
  // Figures without a source, per block.
  const blocks = []; let start = 0;
  for (const match of text.matchAll(/\n\s*\n|\n(?=\s*(?:[-*+]|\d+[.)]|\||#{1,6})\s)/g)) { blocks.push([start, match.index]); start = match.index + match[0].length; }
  blocks.push([start, text.length]);
  for (const [from, to] of blocks) {
    const block = text.slice(from, to); if (/^\s*#{1,6}\s/.test(block) || /^\s*```/.test(block) || SOURCED.test(block)) continue;
    for (const match of block.matchAll(FIGURE)) {
      const index = from + match.index; if (inside(masked, index)) continue;
      // The sentence the figure sits in, so the note reads on its own.
      const before = block.slice(0, match.index); const begin = Math.max(before.search(/[^.!?]*$/), 0);
      const after = block.slice(match.index); const stop = after.search(/[.!?](\s|$)/);
      const sentence = block.slice(begin, match.index + (stop < 0 ? after.length : stop + 1)).replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
      add('unsourced-number', index, clip(sentence, 90), `“${clip(match[0].trim(), 24)}” has no source link nearby. Link the post or study it comes from.`, match[0].trim().length);
      break; // one note per block is enough
    }
  }
  return findings.sort((a, b) => a.index - b.index).slice(0, MAX_FINDINGS);
}

// "2 things to check" / "Nothing to check".
export const checkSummary = (findings) => (findings.length ? `${findings.length} ${findings.length === 1 ? 'thing' : 'things'} to check` : 'Nothing to check');

// The brand inputs a screen passes to the editor, from the active workspace.
export function brandFrom(workspace) {
  const knowledge = workspace?.knowledge || {};
  return { claimsToAvoid: String(knowledge.forbiddenClaims || ''), voice: String(knowledge.voice || ''), editorialRules: String(knowledge.editorialRules || ''), editionId: workspace?.editionId || '' };
}
