// Trends at scale: what the filter bar keeps, how a column or section is sorted and cut short, and what moving a card
// from one stage to another does. Pure and renderer-side, so the List, the Board, its drag and its "Move to" menu all
// follow one set of rules.
//
// filterCards(cards, filters, now) → the cards that match { query, tier, platform, since, sort }
// movePlan(card, toStage, { can }) → what dropping `card` on the `toStage` column does:
//   { allowed: false, reason }                         it can't go there; `reason` says why and what to do instead
//   { allowed: true, action, confirm? }                `action` is one of
//       { kind: 'decide', decision }                   approve, skip or undo, while the run still takes decisions
//       { kind: 'write-reports', runId }               the run's own cost check asks before anything is spent
//       { kind: 'archive', archived }                  file it away, or bring it back
//     `confirm` ({ id, title, lines, confirmLabel }) is asked first for a move that goes backwards or files a trend
//     away. `id` names the question, so "Don't ask again" silences that one question (askAgain / stopAsking). A cost
//     check is never one of these and can't be silenced.
const list = (value) => (Array.isArray(value) ? value : []);
const DAY = 24 * 60 * 60 * 1000;

export const TIER_LABELS = Object.freeze({ 'FAST-TRACK': 'Fast-track', STRONG: 'Strong', MONITOR: 'Monitor', LOW: 'Low' });
export const PLATFORM_LABELS = Object.freeze({ x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' });
export const SINCE_OPTIONS = Object.freeze([['', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']]);
export const SORT_OPTIONS = Object.freeze([['newest', 'Newest first'], ['oldest', 'Oldest first'], ['strongest', 'Strongest first'], ['sources', 'Most sources'], ['name', 'A to Z']]);
export const NO_FILTERS = Object.freeze({ query: '', tier: '', platform: '', since: '', sort: 'newest' });
// How many cards a board column or a list section shows before "Show more".
export const PAGE = 8;

const tierRank = (card) => ({ 'FAST-TRACK': 0, STRONG: 1, MONITOR: 2, LOW: 3 }[card.priorityTier] ?? 4);
const SORTS = {
  newest: (a, b) => String(b.discoveredAt || '').localeCompare(String(a.discoveredAt || '')),
  oldest: (a, b) => String(a.discoveredAt || '').localeCompare(String(b.discoveredAt || '')),
  strongest: (a, b) => tierRank(a) - tierRank(b) || (b.priorityScore ?? -1) - (a.priorityScore ?? -1) || b.evidenceCount - a.evidenceCount,
  sources: (a, b) => (b.evidenceCount || 0) - (a.evidenceCount || 0),
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
};

// Saved filters come back as whatever was stored: keep only values the bar offers.
export function cleanFilters(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    query: typeof raw.query === 'string' ? raw.query.slice(0, 120) : '',
    tier: TIER_LABELS[raw.tier] ? raw.tier : '',
    platform: PLATFORM_LABELS[raw.platform] ? raw.platform : '',
    since: SINCE_OPTIONS.some(([id]) => id === raw.since) ? raw.since : '',
    sort: SORTS[raw.sort] ? raw.sort : 'newest',
  };
}
// How many filters narrow the page (the sort doesn't).
export const activeCount = (filters) => ['query', 'tier', 'platform', 'since'].filter((key) => String(filters?.[key] || '').trim()).length;

export function filterCards(cards, filtersIn, now = Date.now()) {
  const filters = cleanFilters(filtersIn);
  const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  const cutoff = filters.since ? now - Number(filters.since) * DAY : 0;
  const kept = list(cards).filter((card) => {
    if (filters.tier && card.priorityTier !== filters.tier) return false;
    if (filters.platform && !list(card.platforms).includes(filters.platform)) return false;
    if (cutoff) { const found = Date.parse(card.discoveredAt || ''); if (!Number.isFinite(found) || found < cutoff) return false; }
    if (!words.length) return true;
    const text = [card.name, card.description, card.programName, card.category, ...list(card.keywords)].join(' ').toLowerCase();
    return words.every((word) => text.includes(word));
  });
  // Newest first is the board's own order (date, then strength), so it is left as it came.
  return filters.sort === 'newest' ? kept : [...kept].sort((a, b) => SORTS[filters.sort](a, b) || SORTS.newest(a, b));
}
// The same board with only the matching cards.
export function filterBoard(board, filters, now) {
  const cards = filterCards(board.cards, filters, now);
  return { ...board, cards, columns: Object.fromEntries(Object.keys(board.columns).map((stage) => [stage, cards.filter((card) => card.stage === stage)])) };
}
// The strengths and platforms the trends on the page actually have, for the bar's menus.
export function filterChoices(cards) {
  const tiers = new Set(); const platforms = new Set();
  for (const card of list(cards)) { if (TIER_LABELS[card.priorityTier]) tiers.add(card.priorityTier); for (const platform of list(card.platforms)) if (PLATFORM_LABELS[platform]) platforms.add(platform); }
  return { tiers: Object.keys(TIER_LABELS).filter((id) => tiers.has(id)), platforms: Object.keys(PLATFORM_LABELS).filter((id) => platforms.has(id)) };
}

const no = (reason) => ({ allowed: false, reason });
const STAGE_NAMES = { potential: 'Needs your OK', approved: 'Approved', production: 'Being written', ready: 'Ready', passed: 'Skipped', archived: 'Archived' };

export function movePlan(card, toStage, { can = () => false } = {}) {
  const from = card?.stage; const name = card?.name || 'This trend';
  if (!from || !STAGE_NAMES[toStage] || from === toStage) return no('');
  const mayDecide = can('decideResearchTheme'); const mayArchive = can('setTrendArchived');
  if (from === 'production') return no(`“${name}” is being written. Wait for it to finish, or stop the run from the trend’s page.`);
  if (from === 'archived') {
    if (toStage !== card.homeStage) return no(`“${name}” was archived from ${STAGE_NAMES[card.homeStage] || 'another column'}, so that is where it goes back to.`);
    return mayArchive ? { allowed: true, action: { kind: 'archive', archived: false } } : no('Your role can’t bring archived trends back.');
  }
  if (toStage === 'archived') {
    if (from !== 'ready' && !(from === 'passed' && !card.canDecide)) return no(`“${name}” is still being decided. Archive it once its reports are written, or after its research run has finished.`);
    if (!mayArchive) return no('Your role can’t archive trends.');
    return { allowed: true, action: { kind: 'archive', archived: true }, confirm: { id: 'archive', title: `Archive “${name}”?`, lines: [from === 'ready' ? 'It leaves Ready and Home’s next steps. Its reports and channel assets stay in Assets.' : 'It leaves the Skipped column.', 'Bring it back any time from the Archived column.'], confirmLabel: 'Archive' } };
  }
  if (from === 'ready') {
    if (toStage === 'production') return no(`“${name}” already has its reports. Open it to make channel assets from them.`);
    return no(`The reports for “${name}” are already written, so it can’t go back to ${STAGE_NAMES[toStage]}. Archive it if you’re done with it.`);
  }
  if (toStage === 'ready') return no('A trend moves to Ready by itself, when its reports are written.');
  // From here on the card is waiting, approved or skipped, and only a run that still takes decisions can change.
  if (!card.canDecide) return no(`The research run that found “${name}” has finished, so its decision can’t change. Run research again and it can be found anew.`);
  if (toStage === 'production') {
    if (from !== 'approved') return no(`Say yes to “${name}” first: reports are written for approved trends.`);
    if (!(can('approveResearchThemes') && can('continueResearchRun'))) return no('Your role can’t write reports.');
    // Its own cost check follows, naming every approved trend in the run.
    return { allowed: true, action: { kind: 'write-reports', runId: card.runId } };
  }
  if (!mayDecide) return no('Your role can’t decide trends.');
  const decision = toStage === 'approved' ? 'approved' : toStage === 'passed' ? 'passed' : 'pending';
  const action = { kind: 'decide', decision };
  if (from === 'approved' && toStage === 'potential') return { allowed: true, action, confirm: { id: 'unapprove', title: `Take back the yes on “${name}”?`, lines: ['It goes back to Needs your OK. No report is written for it until someone says yes again.', 'Nothing has been spent on it yet.'], confirmLabel: 'Take it back' } };
  if (from === 'approved' && toStage === 'passed') return { allowed: true, action, confirm: { id: 'unapprove', title: `Skip “${name}” after all?`, lines: ['It was approved. Skipping it means no report is written for it.', 'You can reconsider it until this run’s reports are written.'], confirmLabel: 'Skip it' } };
  return { allowed: true, action };
}

// "Don't ask again", per question and per person on this device. `silenced` is the saved list of question ids.
export const askAgain = (silenced, id) => !list(silenced).includes(id);
export const stopAsking = (silenced, id) => [...new Set([...list(silenced), id])];
