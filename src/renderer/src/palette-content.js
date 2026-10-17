// Command palette content and search, for both layouts. Pure and renderer-side (ESM): App adds the pages and actions,
// this module turns the studio's own records into palette items (reports per trend, trends waiting for an OK, research
// programs), and ranks and groups whatever the person types. The palette itself is mission-command.jsx.
import { buildTrendBoard } from '../../shared/trend-board.js';

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value : '');
const keywordsOf = (...values) => values.flat(Infinity).map(text).filter(Boolean).join(' ');
const newestFirst = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

// Group names, in the order the palette shows them when nothing is typed. Pages and Create come from the nav model
// (nav-model.js): the sidebar's pages and its New menu, under the same names.
export const PALETTE_GROUPS = { next: 'Next up', pages: 'Pages', create: 'Create', trends: 'Trends waiting for you', waiting: 'Trends waiting for an OK', reports: 'Reports', folders: 'Asset folders', programs: 'Research programs', prompts: 'Prompts', people: 'People', actions: 'Actions', ask: 'Ask AI' };
// The two documents every approved trend gets, in the studio's one vocabulary.
export const REPORT_LABELS = { 'evidence-report': 'Trends report', 'editorial-toolkit': 'Editorial toolkit' };

// Research reports carry "TREND:" and "— Comprehensive Trends Report" around the trend's name (asset-kit.js cleanTitle).
export function cleanReportTitle(value) {
  return text(value).replace(/^\s*TREND:\s*/i, '').replace(/\s+—\s+Comprehensive Trends Report\s*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function shortDay(value) {
  const date = new Date(value || '');
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
}

// Palette items for this workspace's reports, waiting trends and programs. A trend's trends report and editorial
// toolkit come from one content run (they share runId), so each trend is one "Read: <trend>" entry that opens the
// trends report. Other written reports (not channel assets, not pictures) are one entry each. `canDecide` false (a role
// that only reads trends) lists waiting trends as "Open:" under "Trends waiting for an OK"; `folders` adds one "Open
// folder:" entry per channel-asset folder (a kit's sourceKey), newest first.
export function paletteContent({ studio = {}, board = null, canStartResearch = false, canDecide = true, folders = false } = {}) {
  const workspaceId = studio.activeWorkspaceId || '';
  const mine = (row) => !workspaceId || !row?.workspaceId || row.workspaceId === workspaceId;
  const programs = list(studio.programs).filter(mine);
  const contentRuns = list(studio.contentRuns).filter(mine);
  const assets = list(studio.assets).filter(mine);
  const trendBoard = board || buildTrendBoard({ researchRuns: list(studio.researchRuns).filter(mine), contentRuns, assets, programs });
  const cards = list(trendBoard.cards);

  const waiting = cards.filter((card) => card.stage === 'potential').map((card) => ({
    id: `review:${card.key}`, group: canDecide ? PALETTE_GROUPS.trends : PALETTE_GROUPS.waiting, label: `${canDecide ? 'Review' : 'Open'}: ${card.name}`,
    hint: [card.priorityTier, card.programName].filter(Boolean).join(' · '),
    keywords: keywordsOf(card.category, card.keywords, text(card.description).slice(0, 200), 'trend review yes skip needs your ok approve'),
    action: 'review-trend', args: { key: card.key, runId: card.runId, themeId: card.themeId, name: card.name },
  }));

  const paired = new Set();
  const trendReports = cards.filter((card) => list(card.reportAssets).length).map((card) => {
    const docs = list(card.reportAssets);
    for (const doc of docs) paired.add(doc.id);
    const primary = docs.find((doc) => doc.deliverableId === 'evidence-report') || docs[0];
    return {
      id: `read:${card.key}`, group: PALETTE_GROUPS.reports, label: `Read: ${card.name}`,
      hint: [docs.map((doc) => REPORT_LABELS[doc.deliverableId]).filter(Boolean).join(' + '), shortDay(card.discoveredAt)].filter(Boolean).join(' · '),
      keywords: keywordsOf(docs.map((doc) => cleanReportTitle(doc.title)), card.category, card.programName, 'report trends report editorial toolkit read'),
      action: 'read-report', args: { assetId: primary.id, assetIds: docs.map((doc) => doc.id), trend: card.name },
    };
  });
  // Channel assets live in Assets, so a kit run's drafts aren't reports here.
  const kitRunIds = new Set(contentRuns.filter((run) => run.kit).map((run) => run.id));
  const otherReports = assets.filter((asset) => asset.kind !== 'image' && asset.kind !== 'video' && !kitRunIds.has(asset.runId) && !paired.has(asset.id)).sort(newestFirst).map((asset) => ({
    id: `read:${asset.id}`, group: PALETTE_GROUPS.reports, label: `Read: ${cleanReportTitle(asset.title) || 'Untitled report'}`,
    hint: [REPORT_LABELS[asset.deliverableId] || text(asset.channel), shortDay(asset.createdAt)].filter(Boolean).join(' · '),
    keywords: keywordsOf(asset.deliverableId, asset.channel, asset.format, 'report read draft'),
    action: 'read-report', args: { assetId: asset.id, assetIds: [asset.id], trend: '' },
  }));

  const research = canStartResearch ? programs.map((program) => ({
    id: `research:${program.id}`, group: PALETTE_GROUPS.programs, label: `Find new trends with ${program.name || 'this program'}`,
    hint: 'Shows the cost first',
    keywords: keywordsOf(program.query, 'research run start find new trends program scan'),
    action: 'start-research', args: { programId: program.id },
  })) : [];

  const kitFolders = [];
  if (folders) {
    const seen = new Set();
    for (const run of contentRuns.filter((row) => row.kit?.sourceKey).sort(newestFirst)) {
      if (seen.has(run.kit.sourceKey)) continue; seen.add(run.kit.sourceKey);
      kitFolders.push({ id: `folder:${run.kit.sourceKey}`, group: PALETTE_GROUPS.folders, label: `Open folder: ${cleanReportTitle(run.kit.sourceTitle || run.title) || 'Channel assets'}`, hint: ['Channel assets', shortDay(run.createdAt)].filter(Boolean).join(' · '), keywords: keywordsOf(run.kit.folderName, 'folder channel assets kit set'), action: 'open-folder', args: { folderKey: run.kit.sourceKey } });
    }
  }

  return [...waiting, ...trendReports, ...otherReports, ...kitFolders, ...research];
}

// Every typed word must appear in the label or the keywords. Label matches rank first, and a label that starts with
// the phrase (or has it at a word start, as in "Read: AI search") ranks above one that only contains it.
export function rankPaletteItems(items, query) {
  const terms = text(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return list(items);
  const phrase = terms.join(' ');
  return list(items).map((item, index) => {
    const label = text(item.label).toLowerCase();
    const haystack = `${label} ${keywordsOf(item.keywords).toLowerCase()}`;
    if (!terms.every((term) => haystack.includes(term))) return null;
    const score = label.startsWith(phrase) || label.includes(` ${phrase}`) ? 0 : label.includes(phrase) ? 1 : terms.every((term) => label.includes(term)) ? 2 : 3;
    return { item, index, score };
  }).filter(Boolean).sort((a, b) => a.score - b.score || a.index - b.index).map((row) => row.item);
}

// Sections in the order their first item appears, each capped at `limit` items (0 keeps them all).
export function groupPaletteItems(items, limit = 0) {
  const groups = new Map();
  for (const item of list(items)) {
    const name = text(item.group);
    if (!groups.has(name)) groups.set(name, []);
    const rows = groups.get(name);
    if (!limit || rows.length < limit) rows.push(item);
  }
  return [...groups.entries()].map(([group, rows]) => ({ group, items: rows }));
}
