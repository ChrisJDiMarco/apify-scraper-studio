import { useEffect, useMemo, useState } from 'react';
import { PREVIEW_TITLE, adminNames, formatDay, formatTime, useCan, useCanRun, useViewer } from './viewer.js';
import { number, withViewTransition } from './ui.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { copyText } from './role-screens.jsx';
import { copyForGoogleDocs, slackSummary, slideOutline } from './report-handoff.js';
import { routingChannels } from './trend-decision-sheet.jsx';
import { linkFor, shareOrigin } from './deep-links.js';
import { buildTrendBoard, generationPlan } from '../../shared/trend-board.js';
import ASK_ACTIONS from '../../shared/ask-actions.json';

// Ask AI's buttons and the studio work behind them, shared by both layouts (Simple and the Advanced drawer). Which
// buttons exist, what each calls and whether it spends is src/shared/ask-actions.json, which the server's prompt reads
// too. Every button that spends or changes something is confirmed here, in the in-app dialog, with the real estimate
// where the studio has one. The return-value contract for runAiAction: a string is the result line shown under the
// button, false means the person said no in a confirmation (the button comes back), and a throw is a real failure,
// shown under the button and recorded as failed. Nothing is reported done until the save it stands for has landed.
// The direct callers (Home, Trends, the palette) keep the studio's banner: startResearch and writeReports resolve to
// their result line, false for no, or null after the banner showed the error.
//
// The layout supplies `nav`, how it takes the person somewhere. Every member is optional: a button whose way is
// missing says so instead of acting.
/**
 * @typedef {Object} StudioNav
 * @property {(assetId: string) => void} [openReport]  Open one report by asset id (Simple: the Reports reader; Advanced: Library).
 * @property {(folderKey: string) => void} [openFolder]  Open a channel-asset folder by its kit sourceKey (Simple: Assets).
 * @property {(source: { kind: 'report', assetId: string, channels?: string[] }) => void} [makeAssets]  Open the Make channel assets dialog on a report, with those channels ticked; the person presses Make.
 * @property {(tab: string) => void} [openTab]  Go to a Simple tab id: home, reports, trends, assets, ask or settings (Advanced maps it to its own page).
 * @property {(page: string) => void} [openPage]  Open an Ask AI page id (main/help-assistant.js HELP_PAGES: research, board, library, sheets, settings…).
 * @property {(workbookId: string) => void} [openSheets]  Open Sheets on one workbook ('trend-tracker' is the Trend tracker).
 * @property {(promptId: string) => void} [openPrompt]  Open one prompt in Prompts (the Prompt Library) by registry id, e.g. 'research.discovery'.
 * @property {(target: { kind: 'report'|'trend'|'folder'|'run'|'prompt'|'page', id?: string, page?: string }) => void} [openTarget]  Open anything with an id, in this layout.
 * @property {(kind: 'report'|'trend'|'assets'|'prompt', id: string) => string} [copyLink]  Copy a share link; returns it, or '' when there is no web address to build it on.
 * @property {(preset: { emails?: string[], role?: string, channelId?: string }) => void} [openInvite]  Open the invite dialog filled in; the admin presses Invite.
 * @property {(target: { role?: string, channelId?: string, memberId?: string }) => any} [viewAs]  Preview the studio as a role or a person.
 * @property {(draft: { name: string, query: string, lookbackDays: number, sources: { x: string[], linkedin: string[], reddit: string[] } }) => void} [openProgramDraft]  Open the research program editor filled in; the admin presses Save.
 */
// Write reports saves the approvals (approveResearchThemes, Approve trends) and then continues the run
// (continueResearchRun, Start research). A role needs both, or the first call saves and the second is refused.
export const canWriteReports = (check) => check('approveResearchThemes') && check('continueResearchRun');
const CATALOG = ASK_ACTIONS.actions;
const ALIASES = ASK_ACTIONS.aliases || {};
// Ask AI's buttons and every method each one calls (ask-actions.json), so a role (or a preview) never runs a button it
// can't use. A button needs all of its methods.
export const AI_ACTION_METHOD = Object.freeze(Object.fromEntries(Object.entries(CATALOG).map(([kind, row]) => [kind, Object.freeze([...(row.methods || [])])])));
export const aiActionAllowed = (kind, check) => Boolean(CATALOG[kind]) && AI_ACTION_METHOD[kind].every((method) => check(method));
// An older stored button (open-report, approve-all-trends) as the kind it is now, with its fixed params.
export function aiRequest(request = {}) {
  const alias = ALIASES[request?.kind];
  return alias ? { ...request, kind: alias.kind, params: { ...(alias.params || {}), ...(request.params || {}) } } : { ...request, params: request?.params && typeof request.params === 'object' ? request.params : {} };
}
// Retrying unfinished channel assets: about $2 an asset on top of what is reserved, never past $1,000 (the same limits as
// content-workspace's budget()). Shared with every panel that retries.
export const RETRY_USD_PER_ASSET = 2;
export const RETRY_MAX_USD = 1000;
export const retryCap = (run, unfinished) => Math.min(RETRY_MAX_USD, Math.max(Number(run?.maxBudgetUsd) || 0, Math.ceil((Number(run?.reservedUsd) || 0) + unfinished * RETRY_USD_PER_ASSET)));
const ASSET_STATUSES = ['draft', 'in-review', 'approved', 'scheduled', 'published'];
const STATUS_WORDS = { draft: 'Draft', 'in-review': 'In review', approved: 'Approved', scheduled: 'Scheduled', published: 'Published' };
const DEFAULT_TABS = ['home', 'reports', 'trends', 'assets', 'ask'];
const ACTIVE = new Set(['queued', 'running']);
const SEARCHING = new Set(['queued', 'running', 'awaiting-review']);
const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
export const money = (value) => (finite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '');
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const same = (a, b) => norm(a) === norm(b);
const and = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] || '');
const newestFirst = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
const newestProgram = (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
const runName = (run) => (run.kit ? run.kit.sourceTitle : run.title);
const isEvent = (value) => Boolean(value) && typeof value === 'object' && (typeof value.preventDefault === 'function' || 'nativeEvent' in value);
// "2:14 PM" today, "Oct 12, 2:14 PM" before that.
function startedAt(value) {
  const date = new Date(value || 0);
  if (!value || Number.isNaN(date.getTime())) return 'an earlier time';
  return date.toDateString() === new Date().toDateString() ? formatTime(value) : `${formatDay(value)}, ${formatTime(value)}`;
}
// Names from Ask AI, by the server's rules (main/index.js helpPick): an exact title first; otherwise names and titles
// under 4 characters match exactly only, and the containing title closest in length wins (rows come newest first, so a
// tie goes to the newest). The server normally sends ids; this is for older stored answers.
export function titled(rows, name, title = (row) => row.title) {
  const want = norm(name); if (!want) return null;
  const exact = rows.find((row) => norm(title(row)) === want); if (exact) return exact;
  if (want.length < 4) return null;
  let best = null; let gap = Infinity;
  for (const row of rows) { const named = norm(title(row)); if (named.length < 4 || !(named.includes(want) || want.includes(named))) continue; const diff = Math.abs(named.length - want.length); if (diff < gap) { best = row; gap = diff; } }
  return best;
}

// "This spends about $1.20 AI (cap $1.50), up to $1.10 on Apify (cap $1.50)." Unknown parts fall back to the cap.
export function spendLine({ aiUsd, aiCapUsd, apifyUsd, apifyCapUsd } = {}) {
  const parts = [
    finite(aiUsd) ? `about ${money(aiUsd)} AI${finite(aiCapUsd) ? ` (cap ${money(aiCapUsd)})` : ''}` : finite(aiCapUsd) ? `AI up to ${money(aiCapUsd)}` : '',
    finite(apifyUsd) ? `up to ${money(apifyUsd)} on Apify${finite(apifyCapUsd) ? ` (cap ${money(apifyCapUsd)})` : ''}` : finite(apifyCapUsd) ? `Apify up to ${money(apifyCapUsd)}` : '',
  ].filter(Boolean);
  return parts.length ? `This spends ${parts.join(', ')}.` : '';
}
export const CODEX_UNCAPPED = 'On Codex the studio can’t cap AI spend, so the AI cap is a guide, not a limit.';

// The lines a quick-scan confirmation shows, from estimateQuickScan's reply: the server's plan in words (describeScan,
// which already prices AI and Apify against their caps), then its warnings. Without those lines, the spend line.
export function quickScanCostLines(estimate = {}) {
  const scan = estimate.scan || {}; const ai = estimate.ai || {}; const collection = estimate.collection || {};
  const warnings = [...new Set([...list(estimate.warnings), ...list(collection.warnings)].map(String))].slice(0, 4);
  const lines = list(estimate.lines).map(String).filter(Boolean);
  if (lines.length) return [...lines, ...warnings];
  return [
    spendLine({ aiUsd: ai.totalUsd, aiCapUsd: scan.aiBudgetUsd, apifyUsd: collection.worstCaseUsd, apifyCapUsd: finite(collection.totalBudgetUsd) ? collection.totalBudgetUsd : scan.collectionBudgetUsd }),
    ...warnings,
    estimate.uncapped || estimate.route === 'codex' ? CODEX_UNCAPPED : '',
  ].filter(Boolean);
}
// estimateQuickScan says ready:false when the server would refuse the start (a cap below the minimums, a scan running).
export const quickScanBlocked = (estimate) => estimate?.ready === false;
// What finding trends with a program costs, from estimateResearchProgram's reply (all of it when reports are written
// without a review), against the program's caps; the caps alone when there is no estimate. Pure, for every panel.
export function researchCostLinesFrom(estimate, program = {}, { codex = false } = {}) {
  const budgets = program.budgets || {}; const stages = estimate?.ai?.stages || {};
  const finding = ['discovery', 'synthesis', 'matching'].reduce((sum, key) => sum + (Number(stages[key]) || 0), 0);
  const aiUsd = !estimate?.ai ? null : program.autoApproveThemes ? estimate.ai.totalUsd : Math.round(finding * 100) / 100;
  const collection = estimate?.collection && !estimate.collection.error ? estimate.collection : null;
  return [
    spendLine({ aiUsd, aiCapUsd: budgets.aiUsd, apifyUsd: collection?.worstCaseUsd, apifyCapUsd: budgets.collectionUsd }),
    !estimate ? 'The estimate isn’t available right now, so these are the program’s caps.' : '',
    estimate?.collection?.error ? `Apify: ${estimate.collection.error}` : '',
    estimate && !program.autoApproveThemes ? 'Writing reports for the trends you approve is confirmed separately.' : '',
    ...list(collection?.warnings).slice(0, 3).map(String),
    codex ? CODEX_UNCAPPED : '',
  ].filter(Boolean);
}
// Prompts a run used (run.prompts, { [promptId]: { version } }) that have a newer saved version now, from the pushed
// contentStudio.promptChanges (current rows). Pure, so the run panels that retry outside this hook ask the same way.
export function newerPromptsFor(row, promptChanges = []) {
  const used = row?.prompts && typeof row.prompts === 'object' ? row.prompts : null;
  if (!used) return [];
  const current = new Map(list(promptChanges).filter((change) => change?.current).map((change) => [change.promptId, change]));
  return Object.entries(used).map(([promptId, saved]) => { const now = current.get(promptId); return now && Number(now.version) !== Number(saved?.version) ? now : null; }).filter(Boolean);
}
// The question's words, shared with those panels' plain confirmations.
export function newestPromptsLine(newer = []) {
  return `${newer.length === 1 ? 'A prompt' : `${plural(newer.length, 'prompt')}`} this run used ${newer.length === 1 ? 'was' : 'were'} changed after it started. The unfinished steps can use the newest versions; finished steps keep theirs.`;
}

/**
 * @param {Object} options
 * @param {Object} options.api  window.apifyStudio or the web api.
 * @param {Object} options.state  The pushed studio state (state.contentStudio, state.team).
 * @param {(work: () => Promise<any>, successMessage?: string|Function, throwOnError?: boolean) => Promise<any>} options.action  App's runAction: resolves the result, or null after showing the error; with throwOnError it rethrows instead (Ask AI's buttons use that, so the error shows under the button).
 * @param {StudioNav} [options.nav]
 * @param {(options: Object|string) => Promise<boolean>} [options.confirm]  Defaults to useConfirm().
 * @param {Object} [options.viewer]  Defaults to useViewer().
 * @param {(method: string) => boolean} [options.can]  Whether this role has the control. Defaults to useCan().
 * @param {(method: string) => boolean} [options.canRun]  Whether the server takes the call now. Defaults to useCanRun().
 * @param {boolean} [options.settingsAllowed]  Whether this person may open Settings.
 * @param {string[]} [options.tabs]  The Simple tab ids open-tab may go to.
 * @param {boolean} [options.web]  The browser studio (saving a folder downloads a .zip).
 * @param {(text: string) => void} [options.onNotice]  A short note for the layout's toast.
 * @param {(text: string) => void} [options.onError]  A trend choice that couldn't be saved (defaults to onNotice).
 */
export function useStudioActions({ api, state, action, viewer: viewerIn, can: canIn, canRun: canRunIn, confirm: confirmIn, nav = {}, settingsAllowed = true, tabs = DEFAULT_TABS, web = false, onNotice, onError } = {}) {
  const contextViewer = useViewer(); const contextCan = useCan(); const contextCanRun = useCanRun(); const contextConfirm = useConfirm();
  const viewer = viewerIn || contextViewer; const can = canIn || contextCan; const canRun = canRunIn || contextCanRun; const confirm = confirmIn || contextConfirm;
  const run = action || (async (work) => work());
  // Ask AI's way: the work's own error comes back to the button (no banner), and the studio still refreshes after.
  const act = (work) => run(work, '', true);
  const [pending, setPending] = useState({}); // trend decisions shown the instant they are made
  const studio = state?.contentStudio || {};
  const workspaces = list(studio.workspaces);
  const workspace = workspaces.find((item) => item.id === studio.activeWorkspaceId) || null;
  const askAdmin = adminNames(state, 'an admin');
  const codex = studio.capabilities?.aiProvider === 'codex';
  const mine = (row) => !workspace || !row.workspaceId || row.workspaceId === workspace.id;
  const programs = list(studio.programs).filter(mine);
  // Channel asset kits live in Assets; their drafts aren't reports.
  const kitRuns = list(studio.contentRuns).filter(mine).filter((row) => row.kit);
  const kitRunIds = new Set(kitRuns.map((row) => row.id));
  const reports = list(studio.assets).filter(mine).filter((asset) => asset.kind !== 'image' && !kitRunIds.has(asset.runId)).sort(newestFirst);
  const researchRuns = useMemo(() => list(studio.researchRuns).filter(mine).map((row) => {
    const own = Object.entries(pending).filter(([key]) => key.startsWith(`${row.id}:`));
    if (!own.length || row.status !== 'awaiting-review') return row;
    const decisions = { ...(row.decisions || {}) };
    for (const [key, decision] of own) { if (decision === 'pending') delete decisions[key.slice(row.id.length + 1)]; else decisions[key.slice(row.id.length + 1)] = decision; }
    return { ...row, decisions };
  }), [studio.researchRuns, pending, workspace?.id]);
  const board = useMemo(() => buildTrendBoard({ researchRuns, contentRuns: list(studio.contentRuns).filter(mine), assets: list(studio.assets).filter(mine), programs }), [researchRuns, studio.contentRuns, studio.assets, studio.programs]);
  const waiting = board.cards.filter((card) => card.stage === 'potential');
  const approved = board.cards.filter((card) => card.stage === 'approved' && card.canDecide);
  const liveRuns = [...list(studio.researchRuns), ...list(studio.contentRuns)].filter(mine).filter((row) => ACTIVE.has(row.status)).sort(newestFirst);
  // Report folders of channel assets, newest run first, so Ask AI can name and open them.
  const kitFolders = useMemo(() => {
    const groups = new Map();
    for (const row of [...kitRuns].sort(newestFirst)) { if (!groups.has(row.kit.sourceKey)) groups.set(row.kit.sourceKey, []); groups.get(row.kit.sourceKey).push(row); }
    return [...groups.entries()].map(([key, runs]) => ({ key, title: runs[0].kit.sourceTitle || runs[0].title || '', runs }));
  }, [studio.contentRuns, workspace?.id]);
  const findReport = (name) => titled(reports, name);
  const findFolder = (name) => titled(kitFolders, name);
  const channels = useMemo(() => routingChannels(workspace?.editionId || 'general'), [workspace?.editionId]);
  const channelName = (id) => channels.find((row) => row.id === id)?.short || channels.find((row) => row.id === id)?.name || id;

  // Forget an optimistic decision once the saved state agrees with it.
  useEffect(() => {
    setPending((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key, decision]) => {
        const row = list(studio.researchRuns).find((item) => key.startsWith(`${item.id}:`));
        return row && row.status === 'awaiting-review' && (row.decisions?.[key.slice(row.id.length + 1)] || 'pending') !== decision;
      }));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [studio.researchRuns]);

  // A missing way somewhere (a layout without that page) says so rather than doing nothing.
  function go(name, ...args) {
    if (typeof nav?.[name] !== 'function') throw new Error('That isn’t available in this layout.');
    return nav[name](...args);
  }
  function noProgram() {
    if (can('saveResearchProgram')) { if (typeof nav?.openPage === 'function') nav.openPage('research'); return false; }
    const text = `There’s no research program yet. Ask ${askAdmin} to set one up.`;
    onNotice?.(text); return text;
  }
  // The real estimate for a saved program: what finding trends costs (all of it when reports are written without a
  // review), against the program's caps. The caps alone when the estimate can't be had.
  async function researchCostLines(program) {
    let estimate = null;
    try { estimate = typeof api?.estimateResearchProgram === 'function' ? await api.estimateResearchProgram(program) : null; } catch { estimate = null; }
    return researchCostLinesFrom(estimate, program, { codex });
  }

  // ── The paid-work confirmations: one place, each with its estimate. They resolve true or false. ──
  // A search with this program is still going (or waiting for review): say who started it, and ask before another.
  // Any such run counts, as on the server, not just the newest. A quick scan borrows the program's accounts but isn't
  // one of its searches (the server ignores it here too).
  async function confirmStartResearch(program) {
    const earlier = researchRuns.filter((row) => row.programId === program.id && row.origin !== 'quick-scan' && SEARCHING.has(row.status)).sort(newestFirst)[0];
    const cost = await researchCostLines(program);
    const ok = await confirm(earlier
      ? { title: `“${program.name}” is already searching`, lines: [`${earlier.createdBy?.name || 'Someone'} started a search with this program at ${startedAt(earlier.createdAt)}. ${earlier.status === 'awaiting-review' ? 'Its trends are waiting for review.' : 'It’s still running.'} Start another?`, ...cost], confirmLabel: 'Start another' }
      : { title: `Look for new trends with “${program.name}”?`, lines: [...cost, 'New trends will show up under Trends for your OK.'], confirmLabel: 'Start research' });
    return { ok, again: Boolean(earlier) };
  }
  async function confirmQuickScan(scan, program, estimate) {
    return confirm({ title: `Run a quick scan on “${scan.topic}”?`, lines: [`Accounts come from “${program.name}”. The saved program and its schedule aren’t changed.`, ...quickScanCostLines(estimate)], confirmLabel: 'Start scan' });
  }
  // chosen: the approved board cards to write. Every run that writes skips its other trends for good, so they're named.
  async function confirmWriteReports(chosen) {
    const runIds = [...new Set(chosen.map((card) => card.runId))];
    const counts = new Map(runIds.map((runId) => [runId, chosen.filter((card) => card.runId === runId).length]));
    const cost = await reportCostLines(runIds, counts);
    const plans = runIds.map((runId) => ({ runId, plan: generationPlan(board.cards, runId) }));
    const undecided = plans.reduce((sum, row) => sum + row.plan.undecided.length, 0);
    const left = plans.flatMap(({ runId, plan }) => plan.approved.filter((card) => !chosen.some((row) => row.runId === runId && row.themeId === card.themeId)));
    const twins = new Set(chosen.map((card) => norm(card.name)).filter((name, at, all) => all.indexOf(name) !== at));
    return confirm({
      title: `Write reports for ${plural(chosen.length, chosen.length === approved.length ? 'approved trend' : 'trend')}?`,
      lines: [...cost, undecided ? `${plural(undecided, 'trend')} you haven’t decided on from the same ${runIds.length === 1 ? 'run' : 'runs'} will be skipped.` : '', left.length ? `Approved trends you didn’t pick from the same ${runIds.length === 1 ? 'run' : 'runs'} will be skipped and can’t be written later: ${left.map((card) => `“${card.name}”`).slice(0, 6).join(', ')}.` : ''],
      items: chosen.map((card) => (twins.has(norm(card.name)) ? `${card.name} · ${card.programName}` : card.name)).slice(0, 12), confirmLabel: 'Write reports',
    });
  }
  async function confirmRetry(row, { unfinished = 0, title = '' } = {}) {
    if (row.kit) {
      const cap = retryCap(row, unfinished);
      return { ok: await confirm({ title: `Finish the ${plural(unfinished, 'asset')} that didn’t make it in “${title || runName(row)}”?`, lines: [`This can spend up to ${money(Math.max(0, cap - (Number(row.reservedUsd) || 0)))} more. Finished assets aren’t made again.`, codex ? CODEX_UNCAPPED : ''], confirmLabel: 'Finish them' }), cap };
    }
    const left = Math.max(0, (Number(row.maxBudgetUsd) || 0) - (Number(row.reservedUsd) || 0));
    return { ok: await confirm({ title: `Try “${runName(row)}” again?`, lines: [`It keeps finished work and can spend up to ${money(left)} more of its budget.`, codex ? CODEX_UNCAPPED : ''], confirmLabel: 'Try again' }), cap: row.maxBudgetUsd };
  }

  // inline: Ask AI's button, which shows a failure itself (a throw); otherwise the banner shows it and this resolves null.
  async function startResearch(program, { inline = false } = {}) {
    const options = isEvent(program) ? null : program;
    if (!canRun('startResearchRun')) { if (inline) throw new Error(viewer.preview ? PREVIEW_TITLE : `Your role doesn’t include starting research. Ask ${askAdmin}.`); return false; }
    if (!options) { if (inline) throw new Error(`There’s no research program yet. ${can('saveResearchProgram') ? 'Set one up under Research programs.' : `Ask ${askAdmin} to set one up.`}`); return noProgram(); }
    const { ok, again } = await confirmStartResearch(options);
    if (!ok) return false;
    const done = 'Research started. New trends will appear under Trends.';
    const work = () => api.startResearchRun({ programId: options.id, datasetIds: [], ...(again ? { again: true } : {}) });
    if (inline) { await act(work); return done; }
    return (await run(work, done)) ? done : null;
  }

  // A quick scan from Ask AI (the plain button; the scan-plan card has its own editor and runs the same two calls).
  // programId "" means the only program, or else the newest one, as on the server.
  function programFor(id) {
    if (id) return programs.find((row) => row.id === id) || null;
    return programs.length === 1 ? programs[0] : [...programs].sort(newestProgram)[0] || null;
  }
  async function quickScan(scanIn = {}, { topic = '', programId = '', inline = false } = {}) {
    if (!canRun('startQuickScan')) throw new Error(viewer.preview ? PREVIEW_TITLE : `Only an admin or editor can start a quick scan. Ask ${askAdmin}.`);
    if (typeof api?.estimateQuickScan !== 'function' || typeof api?.startQuickScan !== 'function') throw new Error('Quick scans aren’t available in this version of the studio.');
    const wanted = String(scanIn.programId || programId || '');
    const program = programFor(wanted);
    if (!program) { if (wanted) throw new Error('That research program isn’t in this workspace anymore.'); if (inline) throw new Error(`A quick scan needs a research program with accounts. ${can('saveResearchProgram') ? 'Set one up under Research programs.' : `Ask ${askAdmin} to set one up.`}`); return noProgram(); }
    const scan = { ...scanIn, topic: String(scanIn.topic || topic || '').trim(), programId: program.id };
    if (!scan.topic) throw new Error('Say what the quick scan should look for.');
    const estimate = await api.estimateQuickScan({ programId: program.id, scan });
    if (quickScanBlocked(estimate)) throw new Error(list(estimate.warnings)[0] || 'This quick scan can’t start as planned. Change it and check the cost again.');
    if (!(await confirmQuickScan(scan, program, estimate))) return false;
    const work = () => api.startQuickScan({ programId: program.id, scan, fingerprint: estimate?.fingerprint || '' });
    const started = inline ? await act(work) : await run(work, 'Quick scan started. It shows on Home while it runs.');
    return started || inline ? `Started “${started?.title || `Quick scan · ${scan.topic}`}”. It shows on Home while it runs.` : null;
  }

  // A Yes, Skip or Undo shows at once and is taken back if the save fails. With `extra` ({ note, channels }; {} for none)
  // the caller awaits the save and handles a refusal itself (it rejects, with no toast): "Yes, with a note…" and every
  // Ask AI button. Without it, a refusal shows through onError. Resolves true when saved (false when it couldn't be sent).
  function decide(card, decision, extra = null) {
    if (!card?.canDecide || !canRun('decideResearchTheme')) return Promise.resolve(false);
    const key = `${card.runId}:${card.themeId}`;
    const note = String(extra?.note || '').trim(); const routed = list(extra?.channels).map(String).filter(Boolean);
    withViewTransition(() => setPending((current) => ({ ...current, [key]: decision })));
    const undo = () => setPending((current) => { const next = { ...current }; delete next[key]; return next; });
    let sent; // sent at once (not on a later tick), so the choice leaves with the click
    try { sent = Promise.resolve(api.decideResearchTheme({ runId: card.runId, themeId: card.themeId, decision, ...(note ? { note } : {}), ...(routed.length && decision === 'approved' ? { channels: routed } : {}) })); } catch (failure) { sent = Promise.reject(failure); }
    if (extra) return sent.then(() => true, (failure) => { undo(); throw failure; });
    return sent.then(() => true, (failure) => {
      undo();
      const text = failure?.message || 'That choice could not be saved. Try again.';
      if (onError) onError(text); else if (onNotice) onNotice(text); else window.alert(text);
      return false;
    });
  }

  // Prompts a run used (run.prompts, { [promptId]: { version } }) that have a newer saved version now, from the pushed
  // promptChanges (current rows). A retry may opt in to them; unfinished steps then use the newest text.
  const newerPrompts = (row) => newerPromptsFor(row, studio.promptChanges);
  // Asked only when a prompt changed: true sends refreshPrompts. Cancel (or Esc) keeps the run's own prompts.
  async function askNewestPrompts(row) {
    const newer = newerPrompts(row);
    if (!newer.length) return false;
    return confirm({ title: 'Use the newest prompts?', lines: [newestPromptsLine(newer)], items: newer.map((change) => `${change.name || change.promptName || change.promptId} · version ${change.version}`).slice(0, 12), confirmLabel: 'Use the newest prompts', cancelLabel: 'Keep the run’s prompts' });
  }

  // One Ask AI prompt suggestion (edit-prompt), saved as a new version once the person has seen what changes. The
  // prompt-change card normally does this itself; this is the plain button's way (a card that couldn't be drawn).
  async function savePromptEdit(request) {
    const proposal = request.prompt || {};
    if (typeof api?.readPrompt !== 'function' || typeof api?.savePromptVersion !== 'function') throw new Error('Prompts aren’t available in this version of the studio.');
    if (!proposal.promptId || !proposal.blockId || typeof proposal.text !== 'string' || !proposal.text.trim()) throw new Error('That suggestion is missing the new prompt text. Ask again.');
    const detail = await api.readPrompt({ id: proposal.promptId });
    const name = detail?.prompt?.name || request.target || 'this prompt';
    const block = list(detail?.prompt?.blocks).find((row) => row.id === proposal.blockId && row.editable);
    if (!block) throw new Error(`“${name}” has no part like that to change anymore.`);
    if (detail.lockedForYou) throw new Error(`An admin locked “${name}”. Ask ${askAdmin} to make this change.`);
    const before = String(detail.blocks?.[block.id] ?? '').replace(/\r\n?/g, '\n'); const after = proposal.text.replace(/\r\n?/g, '\n');
    if (before === after) return `“${block.label}” already says that. Nothing changed.`;
    let lines = [];
    try { lines = list((await api.diffPromptVersions?.({ id: detail.prompt.id, from: 'current', to: 'draft', draft: { [block.id]: after } }))?.blocks).flatMap((row) => list(row.lines)); } catch { lines = []; }
    const added = lines.filter((line) => line.op === 'add'); const removed = lines.filter((line) => line.op === 'del');
    const next = (Number(detail.version) || 0) + 1;
    const ok = await confirm({
      title: `Save this change to “${name}”?`,
      lines: [lines.length ? `${block.label}: ${plural(added.length, 'line')} added, ${plural(removed.length, 'line')} removed.` : `${block.label} gets Ask AI’s new text.`, proposal.note ? `Why: ${proposal.note}` : '', `It becomes version ${next}. Runs already going keep the version they started with, and History in Prompts can restore the one before.`],
      items: [...removed.map((line) => `− ${line.text}`), ...added.map((line) => `+ ${line.text}`)].filter((line) => line.trim().length > 2).slice(0, 12),
      confirmLabel: `Save as version ${next}`,
    });
    if (!ok) return false;
    const saved = await api.savePromptVersion({ id: detail.prompt.id, blocks: { [block.id]: after }, expectedVersion: Number(detail.version) || 0, note: proposal.note || 'Suggested by Ask AI.', source: 'ask-ai', conversationId: String(request.conversationId || '') });
    return saved?.changed === false ? `“${name}” already says that. Nothing changed.` : `Saved as version ${saved?.version ?? next} of “${name}”.`;
  }

  // What writing the approved trends' reports costs: tagging plus each report, from the program's estimate, against
  // what is left of each research run's AI budget. `counts` (runId → reports) defaults to every approved trend.
  async function reportCostLines(runIds, counts = null) {
    const lines = [];
    for (const runId of runIds.slice(0, 3)) {
      const row = researchRuns.find((item) => item.id === runId);
      const program = programs.find((item) => item.id === row?.programId);
      const count = counts?.get(runId) ?? approved.filter((card) => card.runId === runId).length;
      const cap = Number(row?.maxBudgetUsd); const spent = Number(row?.ownCostUsd ?? row?.costUsd) || 0;
      let estimate = null;
      try { estimate = program && typeof api?.estimateResearchProgram === 'function' ? await api.estimateResearchProgram(program) : null; } catch { estimate = null; }
      const stages = estimate?.ai?.stages;
      const perReport = stages && program?.maxThemes ? (Number(stages.reports) || 0) / program.maxThemes : null;
      const aiUsd = perReport == null ? null : Math.round(((Number(stages.tagging) || 0) + perReport * count) * 100) / 100;
      const left = finite(row?.maxBudgetUsd) ? Math.max(0, cap - spent) : null;
      const where = runIds.length > 1 ? `${row?.title || 'One run'}: ` : '';
      lines.push(`${where}${aiUsd != null ? `about ${money(aiUsd)} AI for ${plural(count, 'report')}` : `${plural(count, 'report')}`}${left != null ? ` (${money(left)} left of its ${money(cap)} AI budget)` : ''}.`);
    }
    if (codex) lines.push(CODEX_UNCAPPED);
    return lines;
  }
  // Write reports for every approved trend, or only `picks` ([{ runId, themeId }], Ask AI's chosen trends; names when
  // there are no ids). Each run is approved and continued on its own: a run that fails is named in the result, and
  // nothing is reported as writing unless its run really started. inline (Ask AI) throws when none started.
  async function writeReports(options = {}) {
    const { inline = false, picks = null, names = null } = isEvent(options) || !options || typeof options !== 'object' ? {} : options;
    // The studio's own buttons show a refusal in the toast (they don't catch); Ask AI's show it under the button.
    const refuse = (text) => { if (inline) throw new Error(text); if (onError) onError(text); else onNotice?.(text); return null; };
    // Checked before anything is saved, so a role without Start research never approves trends it can't write.
    if (!canWriteReports(canRun)) return refuse(viewer.preview ? PREVIEW_TITLE : `Writing reports needs “Approve trends” and “Start research”. Ask ${askAdmin}.`);
    const chosen = list(picks).length ? approved.filter((card) => picks.some((row) => row.runId === card.runId && row.themeId === card.themeId)) : list(names).length ? approved.filter((card) => names.some((name) => same(name, card.name))) : approved;
    if (!chosen.length) { if ((list(picks).length || list(names).length) && inline) throw new Error('Those trends aren’t approved and waiting for reports anymore.'); return 'There are no approved trends waiting for reports.'; }
    const runIds = [...new Set(chosen.map((card) => card.runId))];
    if (runIds.some((runId) => chosen.filter((card) => card.runId === runId).length > 6)) return refuse('Pick up to six trends from one run; write the rest after.');
    if (!(await confirmWriteReports(chosen))) return false;
    const work = async () => {
      const started = []; const failed = [];
      for (const runId of runIds) {
        const mineHere = chosen.filter((card) => card.runId === runId);
        const name = researchRuns.find((row) => row.id === runId)?.title || mineHere[0]?.programName || 'One run';
        try {
          await api.approveResearchThemes({ runId, themes: mineHere.map((card) => card.themeId) });
          await api.continueResearchRun({ runId });
          started.push(mineHere.length);
        } catch (failure) { failed.push(runIds.length > 1 ? `“${name}” couldn’t continue: ${failure?.message || failure}` : String(failure?.message || failure)); }
      }
      if (!started.length) throw new Error(failed.join(' ') || 'The reports couldn’t be started.');
      const line = `Writing ${plural(started.reduce((sum, count) => sum + count, 0), 'report')}. They’ll appear under Reports.`;
      return failed.length ? `Started ${started.length} of ${runIds.length} runs. ${line} ${failed.join(' ')}` : line;
    };
    if (inline) return act(work);
    const result = await run(work, (text) => text);
    return typeof result === 'string' ? result : null;
  }

  // ── Finding a button's item: ids first (the server resolves them), then the same name rules as the server ──
  const split = (target) => { const text = String(target || ''); const at = text.indexOf(' · '); return at > 0 ? [text.slice(0, at).trim(), text.slice(at + 3).trim()] : [text.trim(), '']; };
  function findTrend(request, rows, what) {
    if (request.themeId && request.runId) {
      const hit = rows.find((row) => row.themeId === request.themeId && row.runId === request.runId);
      if (hit) return hit;
      throw new Error(`“${request.title || request.target || 'That trend'}” isn’t ${what} anymore.`);
    }
    const [name, hint] = split(request.target); const wanted = hint || request.params?.run || '';
    const named = rows.filter((row) => same(row.name, name));
    const narrowed = wanted ? named.filter((row) => norm(`${row.programName} · ${String(row.discoveredAt || '').slice(0, 10)}`).includes(norm(wanted))) : [];
    const pool = narrowed.length ? narrowed : named;
    if (pool.length > 1) throw new Error(`Two runs found “${name}” (${pool.map((row) => row.programName || 'a run').join(', ')}). Say which run, or decide on the Trend board.`);
    if (!pool.length) throw new Error(`“${name || 'That trend'}” isn’t ${what} anymore.`);
    return pool[0];
  }
  const twinOf = (card, rows) => rows.filter((row) => same(row.name, card.name)).length > 1;
  const textAssets = () => list(studio.assets).filter(mine).filter((asset) => asset.kind === 'text');
  function findAsset(request) {
    const all = textAssets();
    if (request.assetId) { const hit = all.find((row) => row.id === request.assetId); if (hit) return hit; throw new Error(`“${request.title || request.target || 'That file'}” isn’t in this workspace anymore.`); }
    const report = findReport(request.target); if (report) return report;
    const [folder, file] = String(request.target || '').split(/\s*(?:›|>)\s*/);
    const kit = kitFolders.find((row) => same(row.title, folder));
    const files = kit ? all.filter((asset) => asset.runId === kit.runs[0]?.id) : [];
    const hit = file ? titled(files, file, (asset) => list(kit.runs[0]?.jobs).find((job) => job.id === asset.deliverableId)?.label || asset.title) : null;
    if (!hit) throw new Error(`I couldn’t find “${request.target || 'that'}”.`);
    return hit;
  }
  const readyTrends = () => board.cards.filter((card) => card.stage === 'ready' || card.stage === 'production');
  async function clip(text, what) {
    if (!(await copyText(text))) throw new Error(`This window blocked copying. ${what}`);
  }

  // Each kind's work (the catalog's kinds; test/ask-actions-registry.test.js checks every one has an entry here).
  const executors = {
    'start-research': (request) => {
      const program = (request.programId && programs.find((row) => row.id === request.programId)) || programs.find((row) => same(row.name, request.target)) || (programs.length === 1 ? programs[0] : null);
      if (!program) throw new Error(`I couldn’t find a research program called “${request.target}”.`);
      return startResearch(program, { inline: true });
    },
    'quick-scan': (request) => quickScan(request.scan || {}, { topic: request.target || '', programId: request.programId || '', inline: true }),
    'approve-trend': async (request) => {
      const card = findTrend(request, waiting, 'waiting for your OK');
      const routed = list(request.params.channels);
      await decide(card, 'approved', { note: request.params.note || '', channels: routed }).then((saved) => { if (!saved) throw new Error('That choice couldn’t be saved. Try again.'); });
      return `Approved “${card.name}”${twinOf(card, waiting) ? ` from ${card.programName}` : ''}${routed.length ? ` for ${and(routed.map(channelName))}` : ''}.`;
    },
    'pass-trend': async (request) => {
      const card = findTrend(request, waiting, 'waiting for your OK');
      await decide(card, 'passed', { note: request.params.note || '' }).then((saved) => { if (!saved) throw new Error('That choice couldn’t be saved. Try again.'); });
      return `Skipped “${card.name}”${twinOf(card, waiting) ? ` from ${card.programName}` : ''}.`;
    },
    'undo-trend': async (request) => {
      const decided = board.cards.filter((card) => card.canDecide && card.decision !== 'pending');
      const card = findTrend(request, decided, 'decided and waiting for reports');
      await decide(card, 'pending', {}).then((saved) => { if (!saved) throw new Error('That couldn’t be undone. Try again.'); });
      return `“${card.name}” needs your OK again.`;
    },
    'approve-trends': async (request) => {
      const picks = list(request.picks); const names = list(request.params.trends);
      const cards = picks.length ? waiting.filter((card) => picks.some((row) => row.runId === card.runId && row.themeId === card.themeId)) : names.length ? waiting.filter((card) => names.some((name) => same(name, card.name))) : waiting;
      if (!cards.length) return (picks.length || names.length) ? 'Those trends aren’t waiting for your OK anymore.' : 'No trends are waiting for your OK.';
      const ok = await confirm({ title: `Say yes to ${cards.length === waiting.length && !picks.length && !names.length ? `all ${plural(cards.length, 'waiting trend')}` : plural(cards.length, 'trend')}?`, lines: ['Nothing is written or spent until you write the reports.'], items: cards.map((card) => (twinOf(card, cards) ? `${card.name} · ${card.programName}` : card.name)).slice(0, 12), confirmLabel: 'Approve' });
      if (!ok) return false;
      // Sent together, so the board updates at once; then the real result.
      const results = await Promise.allSettled(cards.map((card) => decide(card, 'approved', {})));
      const failed = cards.map((card, at) => ({ card, result: results[at] })).filter(({ result }) => result.status === 'rejected' || result.value !== true);
      const why = (result) => (result.status === 'rejected' && result.reason?.message) || 'it couldn’t be saved';
      if (failed.length === cards.length) throw new Error(why(failed[0].result));
      if (failed.length) return `Approved ${cards.length - failed.length} of ${cards.length}. “${failed[0].card.name}”${failed.length > 1 ? ` and ${plural(failed.length - 1, 'other')}` : ''} couldn’t be saved: ${why(failed[0].result)}`;
      return `Approved ${plural(cards.length, 'trend')}.`;
    },
    'write-reports': (request) => writeReports({ inline: true, picks: request.picks || null, names: list(request.params.trends) }),
    'make-assets': (request) => {
      const report = (request.assetId && reports.find((row) => row.id === request.assetId)) || findReport(request.target);
      if (!report) throw new Error(`I couldn’t find a report called “${request.target}”.`);
      const routed = list(request.params.channels);
      go('makeAssets', { kind: 'report', assetId: report.id, ...(routed.length ? { channels: routed } : {}) });
      return `Opened the asset dialog${routed.length ? ` with ${and(routed.map(channelName))} ticked` : ''}. Check what will be made, then press Make.`;
    },
    'set-status': async (request) => {
      const status = String(request.params.status || '');
      if (!ASSET_STATUSES.includes(status)) throw new Error('Choose a status first: Draft, In review, Approved, Scheduled or Published.');
      const asset = findAsset(request);
      const link = status === 'published' ? String(request.params.link || '').trim() : '';
      const result = await act(() => api.setAssetStatus({ assetId: asset.id, status, ...(link ? { link } : {}) }));
      const suggested = result?.adoptionSuggested && result.channelId && canRun('setTrendAdoption') ? ` You can also mark ${channelName(result.channelId)} as using this trend.` : '';
      return `Moved “${asset.title}” to ${STATUS_WORDS[status]}${link ? ' with its live link' : ''}.${suggested}`;
    },
    'mark-used': async (request) => {
      const channelId = String(request.params.channel || '');
      if (!channelId) throw new Error('Choose the channel first.');
      const rows = readyTrends();
      const card = (request.themeId && rows.find((row) => row.themeId === request.themeId)) || rows.find((row) => same(row.name, request.target));
      if (!request.themeId && !card) throw new Error(`“${request.target || 'That trend'}” doesn’t have a ready report yet.`);
      const status = ['using', 'not-using', 'clear'].includes(request.params.status) ? request.params.status : 'using';
      const link = String(request.params.link || '').trim(); const plannedFor = String(request.params.date || ''); const note = String(request.params.note || '').trim();
      await act(() => api.setTrendAdoption({ themeId: request.themeId || card.themeId, channelId, status, ...(link ? { link } : {}), ...(plannedFor ? { plannedFor } : {}), ...(note ? { note } : {}) }));
      const name = card?.name || request.title || request.target;
      return status === 'clear' ? `Cleared ${channelName(channelId)}’s answer on “${name}”.` : `Saved: ${channelName(channelId)} ${status === 'using' ? 'is using' : 'isn’t using'} “${name}”${plannedFor && status === 'using' ? `, planned for ${formatDay(plannedFor)}` : ''}.`;
    },
    // The report-change card applies an edit itself; this plain button (a card that couldn't be drawn) opens the report.
    'edit-report': (request) => {
      const report = (request.assetId && reports.find((row) => row.id === request.assetId)) || findReport(request.target);
      if (!report) throw new Error(`I couldn’t find a report called “${request.target}”.`);
      go('openReport', report.id);
      return 'Opened the report. Press Edit to make the change there.';
    },
    'finish-assets': async (request) => {
      const folder = (request.folderKey && kitFolders.find((row) => row.key === request.folderKey)) || findFolder(request.target);
      if (!folder) throw new Error(`I couldn’t find an asset folder called “${request.target}”.`);
      const latest = folder.runs[0]; const left = list(latest.jobs).filter((job) => job.status !== 'succeeded').length;
      if (ACTIVE.has(latest.status)) return 'That run is still going. Assets appear in its folder as they’re ready.';
      if (!left) return 'Every asset in that run is already finished.';
      const { ok, cap } = await confirmRetry(latest, { unfinished: left, title: folder.title });
      if (!ok) return false;
      const refreshPrompts = await askNewestPrompts(latest);
      await act(() => api.retryStudioRun({ runId: latest.id, maxBudgetUsd: cap, ...(refreshPrompts ? { refreshPrompts: true } : {}) }));
      if (typeof nav?.openFolder === 'function') nav.openFolder(folder.key);
      return `Finishing ${plural(left, 'asset')}.`;
    },
    'save-folder': async (request) => {
      const folder = (request.folderKey && kitFolders.find((row) => row.key === request.folderKey)) || findFolder(request.target);
      if (!folder) throw new Error(`I couldn’t find an asset folder called “${request.target}”.`);
      const saved = folder.runs.find((row) => list(studio.assets).some((asset) => asset.runId === row.id));
      if (!saved) return 'Nothing in that folder is ready to save yet.';
      await act(() => api.saveAssetKitFolder({ runId: saved.id }));
      return web ? 'Download started.' : 'Saved to your Downloads folder.';
    },
    'stop-run': async (request) => {
      const live = (request.runId && liveRuns.find((row) => row.id === request.runId)) || titled(liveRuns, request.target, runName);
      if (!live) throw new Error(`Nothing called “${request.target || 'that'}” is running.`);
      const ok = await confirm({ title: `Stop “${runName(live)}”?`, lines: ['Finished work is kept, and you can try the rest later.'], confirmLabel: 'Stop', tone: 'danger' });
      if (!ok) return false;
      await act(() => api.cancelStudioRun({ runId: live.id }));
      return 'Stopped. Finished work is kept.';
    },
    'retry-run': async (request) => {
      const candidates = [...list(studio.researchRuns), ...list(studio.contentRuns)].filter(mine).filter((row) => ['failed', 'partial', 'cancelled'].includes(row.status)).sort(newestFirst);
      const failed = (request.runId && candidates.find((row) => row.id === request.runId)) || titled(candidates, request.target, runName);
      if (!failed) throw new Error(`I couldn’t find a stopped or failed run called “${request.target || 'that'}”.`);
      const unfinished = list(failed.jobs).filter((job) => job.status !== 'succeeded').length;
      const { ok, cap } = await confirmRetry(failed, { unfinished });
      if (!ok) return false;
      const refreshPrompts = await askNewestPrompts(failed);
      await act(() => api.retryStudioRun({ runId: failed.id, maxBudgetUsd: cap, ...(refreshPrompts ? { refreshPrompts: true } : {}) }));
      return 'Trying again. Progress shows on Home.';
    },
    open: (request) => {
      const ref = request.ref || {}; const type = ref.kind || request.params.type || '';
      const page = ref.kind === 'page' ? ref.id : request.page || (type === 'page' ? norm(request.target) : '');
      if (type === 'report' || request.assetId) { const report = (request.assetId && reports.find((row) => row.id === request.assetId)) || findReport(request.target); if (!report) throw new Error(`I couldn’t find a report called “${request.target}”.`); go('openReport', report.id); return 'Opened.'; }
      if (type === 'folder' || request.folderKey) { const folder = (request.folderKey && kitFolders.find((row) => row.key === request.folderKey)) || findFolder(request.target); if (!folder) throw new Error(`I couldn’t find an asset folder called “${request.target}”.`); go('openFolder', folder.key); return 'Opened.'; }
      if (type === 'prompt') { go('openPrompt', request.promptId || ref.id); return 'Opened.'; }
      if (type === 'program') { go('openPage', 'research'); return 'Opened Research programs.'; }
      if (type === 'page') {
        if (page === 'settings' && !settingsAllowed) throw new Error(`Settings are for admins. Ask ${askAdmin} if something needs changing.`);
        if (typeof nav?.openTarget === 'function') nav.openTarget({ kind: 'page', page, id: page }); else go('openPage', page);
        return 'Opened.';
      }
      // A trend opens on its card (or the Trends tab); a run where its progress shows (or Home).
      if (type === 'trend') { const id = request.themeId || ref.id; if (id && typeof nav?.openTarget === 'function') nav.openTarget({ kind: 'trend', id }); else go('openTab', 'trends'); return 'Opened.'; }
      if (type === 'run') { const id = request.runId || ref.id; if (id && typeof nav?.openTarget === 'function') nav.openTarget({ kind: 'run', id }); else go('openTab', 'home'); return 'Opened.'; }
      throw new Error(`I couldn’t find “${request.target || 'that'}”.`);
    },
    'open-tab': (request) => {
      const tab = String(request.target || '').toLowerCase();
      if (tab === 'settings' && !settingsAllowed) throw new Error(`Settings are for admins. Ask ${askAdmin} if something needs changing.`);
      if (![...tabs, ...(settingsAllowed ? ['settings'] : [])].includes(tab)) throw new Error(`There’s no “${request.target}” tab.`);
      go('openTab', tab);
      return 'Opened.';
    },
    'open-tracker': () => { go('openSheets', 'trend-tracker'); return 'Opened the Trend tracker.'; },
    copy: async (request) => {
      const ref = request.ref || {}; const kind = ref.kind || request.params.type || (request.assetId ? 'report' : request.folderKey ? 'folder' : request.themeId ? 'trend' : request.promptId ? 'prompt' : '');
      const id = ref.id || request.assetId || request.folderKey || request.themeId || request.promptId || '';
      const what = request.params.what || 'link';
      const linkKind = { report: 'report', trend: 'trend', folder: 'assets', prompt: 'prompt' }[kind];
      // The share link (deep-links.js), built quietly for a Slack summary; Copy link itself goes through the layout's
      // copyLink, which copies and says so.
      const link = linkKind && id ? linkFor(linkKind, id, { origin: shareOrigin({ web, settings: state?.settings }) }) : '';
      const noLink = () => new Error(web ? 'This link couldn’t be made. Try Copy link on the page itself.' : `Share links need a Studio web address. Ask ${askAdmin} to add one in Settings.`);
      if (what === 'link') {
        if (!linkKind || !id) throw new Error(`I couldn’t find “${request.target || 'that'}” to link to.`);
        if (typeof nav?.copyLink === 'function') { if (!String(nav.copyLink(linkKind, id) || '')) throw noLink(); return 'Copied the link.'; }
        if (!link) throw noLink();
        await clip(link, 'Open it and use Copy link there.');
        return 'Copied the link.';
      }
      if (kind !== 'report' || !id) throw new Error('Only a report can be copied as text, for Google Docs, as a Slack summary or as a slide outline.');
      const report = reports.find((row) => row.id === id) || textAssets().find((row) => row.id === id);
      const read = await api.readStudioAsset({ assetId: id });
      const markdown = String(read?.markdown || '');
      if (!markdown.trim()) throw new Error('That report has no text to copy.');
      const title = report?.title || request.title || '';
      if (what === 'doc') { const copied = await copyForGoogleDocs(markdown, title); if (!copied.ok) throw new Error('This window blocked copying. Open the report and use Share there.'); return copied.rich ? 'Copied for Google Docs. Paste it into a doc.' : 'Copied the report as plain text.'; }
      const text = what === 'slack' ? slackSummary(markdown, { title, link }) : what === 'outline' ? slideOutline(markdown, title) : markdown;
      await clip(text, 'Open the report and use Copy text there.');
      return what === 'slack' ? 'Copied a Slack summary.' : what === 'outline' ? 'Copied a slide outline.' : 'Copied the report.';
    },
    'export-run': async (request) => {
      const report = (request.assetId && reports.find((row) => row.id === request.assetId)) || findReport(request.target);
      if (!report) throw new Error(`I couldn’t find a report called “${request.target}”.`);
      const result = await act(() => api.exportStudioRun({ runId: report.runId }));
      return web ? 'Download started.' : `Exported ${plural(Number(result?.assetCount) || 1, 'file')} to the studio’s exports folder.`;
    },
    'publish-docs': async (request) => {
      const report = (request.assetId && reports.find((row) => row.id === request.assetId)) || findReport(request.target);
      if (!report) throw new Error(`I couldn’t find a report called “${request.target}”.`);
      if (!studio.capabilities?.googlePublishConfigured) throw new Error(`Google Drive isn’t connected. Ask ${askAdmin} to connect it.`);
      const ok = await confirm({ title: `Send “${report.title}” to Google Docs?`, lines: ['It creates Google Docs from this report’s files in the team’s Drive folder.'], confirmLabel: 'Send to Google Docs' });
      if (!ok) return false;
      await act(() => api.publishStudioRun({ runId: report.runId }));
      return 'Sent to Google Docs.';
    },
    // Ask AI asks it itself (help-assistant.jsx); a layout with an ask hook takes it here.
    ask: (request) => { go('ask', request.target); return 'Asked.'; },
    'draft-program': (request) => {
      const params = request.params;
      go('openProgramDraft', { name: params.name || '', query: params.topic || '', lookbackDays: Number(params.days) || 7, sources: { x: list(params.x), linkedin: list(params.linkedin), reddit: list(params.reddit) } });
      return 'Opened a new research program with these settings. Check the estimate, then press Save.';
    },
    'invite-people': (request) => {
      const params = request.params;
      go('openInvite', { emails: list(params.emails), ...(params.role ? { role: params.role } : {}), ...(params.channel ? { channelId: params.channel } : {}) });
      return 'Opened the invite dialog. Check it, then press Invite.';
    },
    'view-as': async (request) => {
      if (!request.roleId && !request.memberId) throw new Error(`I couldn’t find a role or person called “${request.target}”.`);
      const ok = await go('viewAs', { ...(request.roleId ? { role: request.roleId } : {}), ...(request.channelId || request.params.channel ? { channelId: request.channelId || request.params.channel } : {}), ...(request.memberId ? { memberId: request.memberId } : {}) });
      if (ok === false) return false; // the unsaved-edits question was answered No
      return `Showing the studio as ${request.title || request.target}. Choose Admin under View as to come back.`;
    },
    'lock-prompt': async (request) => {
      const id = request.promptId || ''; const locked = request.params.locked !== false;
      if (!id) throw new Error(`I couldn’t find a prompt called “${request.target}”.`);
      const name = request.title || request.target;
      const ok = await confirm({ title: locked ? `Lock “${name}”?` : `Unlock “${name}”?`, lines: [locked ? 'Only admins can change it while it’s locked. Runs keep using its current version.' : 'People who can edit prompts can change it again.'], confirmLabel: locked ? 'Lock it' : 'Unlock it' });
      if (!ok) return false;
      await act(() => api.setPromptLock({ id, locked }));
      return locked ? `Locked “${name}”.` : `Unlocked “${name}”.`;
    },
    'edit-prompt': (request) => savePromptEdit(request),
  };

  // Buttons Ask AI offers, and the ones its cards draw. The server sends the item's ids (runId + themeId, assetId,
  // folderKey, programId, promptId, ref); names are the fallback for older stored answers.
  async function runAiAction(raw = {}) {
    const request = aiRequest(raw);
    const execute = executors[request.kind];
    if (!execute) throw new Error('That action isn’t available.');
    const blocked = AI_ACTION_METHOD[request.kind].find((method) => !canRun(method));
    // writeReports names the two capabilities it needs.
    if (blocked && request.kind !== 'write-reports') throw new Error(viewer.preview ? PREVIEW_TITLE : request.kind === 'edit-prompt' ? `Your role can see prompts but not change them. Ask ${askAdmin}.` : `Your role doesn’t include that. Ask ${askAdmin} if you need it.`);
    return execute(request);
  }

  return { runAiAction, startResearch, quickScan, decide, writeReports, confirmStartResearch, confirmWriteReports, confirmRetry, confirmQuickScan, newerPrompts, askNewestPrompts, savePromptEdit, waiting, approved, reports, kitRuns, kitFolders, findReport, findFolder, board, researchRuns, programs, liveRuns, workspace, askAdmin, executors };
}
