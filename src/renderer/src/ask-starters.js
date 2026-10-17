// Ask AI's empty-thread suggestions, built from the state the studio already pushes: what changed in the latest run,
// which waiting trends deserve a report, a Slack summary of the newest report, why a run stopped, when a schedule runs
// next. Each is gated by what this role can do (`can`), so nobody is offered something they can't open, and the static
// starters fill in when the studio has nothing to suggest yet. Pure (ESM); asking one is a normal question, with its
// own cost line, and never starts paid work by itself.
const list = (value) => (Array.isArray(value) ? value : []);
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : 0; };
const short = (value, max = 50) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text; };
const newest = (rows) => [...rows].sort((a, b) => time(b.updatedAt || b.finishedAt || b.createdAt) - time(a.updatedAt || a.finishedAt || a.createdAt))[0] || null;
const themesOf = (run) => (list(run?.discoveredThemes).length ? run.discoveredThemes : list(run?.themes));

export const DEFAULT_STARTERS = Object.freeze([
  'How do I run my first research program?',
  'What will a research run cost?',
  'Why did my last run stop?',
  'Create a hero image for my latest trend',
]);

// → up to `max` questions, the state's first, then `fallback` (with picture starters only when pictures are on).
export function smartStarters({ state = null, can = () => true, fallback = DEFAULT_STARTERS, imagesReady = false, now = Date.now(), max = 4 } = {}) {
  const studio = state?.contentStudio || {}; const workspaceId = studio.activeWorkspaceId;
  const mine = (row) => !workspaceId || !row?.workspaceId || row.workspaceId === workspaceId;
  const runs = list(studio.researchRuns).filter(mine);
  const out = [];
  const finished = newest(runs.filter((run) => ['succeeded', 'awaiting-review', 'partial'].includes(run.status) && run.title));
  if (finished && (can('readStudioRun') || can('readTrendHistory'))) out.push(`What changed in “${short(finished.title)}”?`);
  const waiting = runs.filter((run) => run.status === 'awaiting-review' && run.origin !== 'quick-scan').reduce((sum, run) => sum + themesOf(run).filter((theme) => !run.decisions?.[theme.id]).length, 0);
  if (waiting && can('decideResearchTheme')) out.push(`Which of the ${waiting} waiting ${waiting === 1 ? 'trend is' : 'trends are'} worth a report?`);
  const report = newest(list(studio.assets).filter((asset) => mine(asset) && asset.kind === 'text' && asset.title));
  if (report && can('readStudioAsset')) out.push(`Summarize “${short(report.title)}” for Slack`);
  const week = now - 7 * 86400000;
  const stopped = newest([...runs, ...list(studio.contentRuns).filter(mine).filter((run) => !run.kit)].filter((run) => ['failed', 'partial'].includes(run.status) && run.title && time(run.updatedAt || run.createdAt) >= week));
  if (stopped && can('readStudioRun')) out.push(`Why did “${short(stopped.title)}” stop?`);
  const scheduled = list(studio.programs).find((program) => mine(program) && program.name && program.schedule?.enabled && program.schedule.frequency !== 'manual');
  if (scheduled && (can('readResearchProgram') || can('saveResearchProgram') || can('readStudioRun'))) out.push(`When does “${short(scheduled.name)}” run next?`);
  const fill = list(fallback).filter((question) => imagesReady || !/\b(image|picture)\b/i.test(question));
  return [...new Set([...out, ...fill])].slice(0, Math.max(1, max));
}
