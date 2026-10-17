import { useEffect, useMemo, useState } from 'react';
import { PREVIEW_TITLE, adminNames, formatDay, formatTime, useCan, useCanRun, useViewer } from './viewer.js';
import { number, withViewTransition } from './ui.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { buildTrendBoard, generationPlan } from '../../shared/trend-board.js';

// Ask AI's buttons and the studio work behind them, shared by both layouts (Simple and the Advanced drawer). Every
// button that spends or changes something is confirmed here, in the in-app dialog, with the real estimate where the
// studio has one. The return-value contract for runAiAction and the starters: a string is the result line shown under
// the button, false means the person said no (the button comes back), and a throw shows the error under the button.
//
// The layout supplies `nav`, how it takes the person somewhere. Every member is optional: a button whose way is
// missing says so instead of acting.
/**
 * @typedef {Object} StudioNav
 * @property {(assetId: string) => void} [openReport]  Open one report by asset id (Simple: the Reports reader; Advanced: Library).
 * @property {(folderKey: string) => void} [openFolder]  Open a channel-asset folder by its kit sourceKey (Simple: Assets).
 * @property {(source: { kind: 'report', assetId: string }) => void} [makeAssets]  Open the Make channel assets dialog on a report; the person presses Make.
 * @property {(tab: string) => void} [openTab]  Go to a Simple tab id: home, reports, trends, assets, ask or settings (Advanced maps it to its own page).
 * @property {(page: string) => void} [openPage]  Open an Ask AI page id (main/help-assistant.js HELP_PAGES: research, board, library, sheets, settings…).
 * @property {(workbookId: string) => void} [openSheets]  Open Sheets on one workbook ('trend-tracker' is the Trend tracker).
 * @property {(promptId: string) => void} [openPrompt]  Open one prompt in Prompts (the Prompt Library) by registry id, e.g. 'research.discovery'.
 */
// Write reports saves the approvals (approveResearchThemes, Approve trends) and then continues the run
// (continueResearchRun, Start research). A role needs both, or the first call saves and the second is refused.
export const canWriteReports = (check) => check('approveResearchThemes') && check('continueResearchRun');
// Ask AI's buttons and the method each one ends up calling, so a role (or a preview) never runs a button it can't use.
export const AI_ACTION_METHOD = { 'start-research': 'startResearchRun', 'quick-scan': 'startQuickScan', 'approve-trend': 'decideResearchTheme', 'pass-trend': 'decideResearchTheme', 'approve-all-trends': 'decideResearchTheme', 'write-reports': 'approveResearchThemes', 'make-assets': 'planAssetKit', 'finish-assets': 'retryStudioRun', 'save-folder': 'saveAssetKitFolder', 'stop-run': 'cancelStudioRun', 'retry-run': 'retryStudioRun', 'open-tracker': 'readWorkbook', 'edit-prompt': 'savePromptVersion' };
const DEFAULT_TABS = ['home', 'reports', 'trends', 'assets', 'ask'];
const ACTIVE = new Set(['queued', 'running']);
const SEARCHING = new Set(['queued', 'running', 'awaiting-review']);
const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
export const money = (value) => (finite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '');
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const newestFirst = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
const newestProgram = (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
const runName = (run) => (run.kit ? run.kit.sourceTitle : run.title);
// "2:14 PM" today, "Oct 12, 2:14 PM" before that.
function startedAt(value) {
  const date = new Date(value || 0);
  if (!value || Number.isNaN(date.getTime())) return 'an earlier time';
  return date.toDateString() === new Date().toDateString() ? formatTime(value) : `${formatDay(value)}, ${formatTime(value)}`;
}
// Titles from Ask AI match exactly, else by containment ("AI Citation Tracking" finds its report and toolkit).
export function titled(rows, name, title = (row) => row.title) {
  const want = String(name || '').trim().toLowerCase(); if (!want) return null;
  const named = (row) => String(title(row) || '').trim().toLowerCase();
  return rows.find((row) => named(row) === want) || rows.find((row) => named(row) && (named(row).includes(want) || want.includes(named(row)))) || null;
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
 * @param {(work: () => Promise<any>, successMessage?: string) => Promise<any>} options.action  App's runAction: resolves the result, or null after showing the error.
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
    for (const [key, decision] of own) decisions[key.slice(row.id.length + 1)] = decision;
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
    nav[name](...args);
  }
  function noProgram() {
    if (can('saveResearchProgram')) { if (typeof nav?.openPage === 'function') nav.openPage('research'); return false; }
    const text = `There’s no research program yet. Ask ${askAdmin} to set one up.`;
    onNotice?.(text); return text;
  }
  // The real estimate for a saved program: what finding trends costs (all of it when reports are written without a
  // review), against the program's caps. The caps alone when the estimate can't be had.
  async function researchCostLines(program) {
    const budgets = program.budgets || {};
    let estimate = null;
    try { estimate = typeof api?.estimateResearchProgram === 'function' ? await api.estimateResearchProgram(program) : null; } catch { estimate = null; }
    const stages = estimate?.ai?.stages || {};
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

  async function startResearch(program) {
    if (!canRun('startResearchRun')) return false;
    if (!program) return noProgram();
    // A search with this program is still going (or waiting for review): say who started it, and ask before another.
    // Any such run counts, as on the server, not just the newest. A quick scan borrows the program's accounts but isn't
    // one of its searches (the server ignores it here too).
    const earlier = researchRuns.filter((row) => row.programId === program.id && row.origin !== 'quick-scan' && SEARCHING.has(row.status)).sort(newestFirst)[0];
    const again = Boolean(earlier);
    const cost = await researchCostLines(program);
    const ok = await confirm(again
      ? { title: `“${program.name}” is already searching`, lines: [`${earlier.createdBy?.name || 'Someone'} started a search with this program at ${startedAt(earlier.createdAt)}. ${earlier.status === 'awaiting-review' ? 'Its trends are waiting for review.' : 'It’s still running.'} Start another?`, ...cost], confirmLabel: 'Start another' }
      : { title: `Look for new trends with “${program.name}”?`, lines: [...cost, 'New trends will show up under Trends for your OK.'], confirmLabel: 'Start research' });
    if (!ok) return false;
    const result = await run(() => api.startResearchRun({ programId: program.id, datasetIds: [], ...(again ? { again: true } : {}) }), 'Research started. New trends will appear under Trends.');
    return result ? 'Research started. New trends will appear under Trends.' : false;
  }

  // A quick scan from Ask AI (the plain button; the scan-plan card has its own editor and runs the same two calls).
  // programId "" means the only program, or else the newest one, as on the server.
  function programFor(id) {
    if (id) return programs.find((row) => row.id === id) || null;
    return programs.length === 1 ? programs[0] : [...programs].sort(newestProgram)[0] || null;
  }
  async function quickScan(scanIn = {}, { topic = '', programId = '' } = {}) {
    if (!canRun('startQuickScan')) throw new Error(viewer.preview ? PREVIEW_TITLE : `Only an admin or editor can start a quick scan. Ask ${askAdmin}.`);
    if (typeof api?.estimateQuickScan !== 'function' || typeof api?.startQuickScan !== 'function') throw new Error('Quick scans aren’t available in this version of the studio.');
    const wanted = String(scanIn.programId || programId || '');
    const program = programFor(wanted);
    if (!program) { if (wanted) throw new Error('That research program isn’t in this workspace anymore.'); return noProgram(); }
    const scan = { ...scanIn, topic: String(scanIn.topic || topic || '').trim(), programId: program.id };
    if (!scan.topic) throw new Error('Say what the quick scan should look for.');
    const estimate = await api.estimateQuickScan({ programId: program.id, scan });
    if (quickScanBlocked(estimate)) throw new Error(list(estimate.warnings)[0] || 'This quick scan can’t start as planned. Change it and check the cost again.');
    const ok = await confirm({ title: `Run a quick scan on “${scan.topic}”?`, lines: [`Accounts come from “${program.name}”. The saved program and its schedule aren’t changed.`, ...quickScanCostLines(estimate)], confirmLabel: 'Start scan' });
    if (!ok) return false;
    const started = await run(() => api.startQuickScan({ programId: program.id, scan, fingerprint: estimate?.fingerprint || '' }), 'Quick scan started. It shows on Home while it runs.');
    return started ? `Started “${started.title || `Quick scan · ${scan.topic}`}”. It shows on Home while it runs.` : false;
  }

  // A Yes or Skip shows at once and is undone if the save fails. `extra` ({ note, channels }) is "Yes, with a note…": its
  // sheet awaits the returned promise and shows a refusal itself, so only a plain Yes or Skip reports through onError.
  // Resolves true when saved (false when it couldn't be sent).
  function decide(card, decision, extra = null) {
    if (!card?.canDecide || !canRun('decideResearchTheme')) return Promise.resolve(false);
    const key = `${card.runId}:${card.themeId}`;
    const note = String(extra?.note || '').trim(); const channels = list(extra?.channels).map(String).filter(Boolean);
    withViewTransition(() => setPending((current) => ({ ...current, [key]: decision })));
    const undo = () => setPending((current) => { const next = { ...current }; delete next[key]; return next; });
    let sent; // sent at once (not on a later tick), so the choice leaves with the click
    try { sent = Promise.resolve(api.decideResearchTheme({ runId: card.runId, themeId: card.themeId, decision, ...(note ? { note } : {}), ...(channels.length ? { channels } : {}) })); } catch (failure) { sent = Promise.reject(failure); }
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
  // what is left of each research run's AI budget.
  async function reportCostLines(runIds) {
    const lines = [];
    for (const runId of runIds.slice(0, 3)) {
      const row = researchRuns.find((item) => item.id === runId);
      const program = programs.find((item) => item.id === row?.programId);
      const count = approved.filter((card) => card.runId === runId).length;
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
  async function writeReports() {
    // Checked before anything is saved, so a role without Start research never approves trends it can't write.
    if (!canWriteReports(canRun)) throw new Error(viewer.preview ? PREVIEW_TITLE : `Writing reports needs “Approve trends” and “Start research”. Ask ${askAdmin}.`);
    const runIds = [...new Set(approved.map((card) => card.runId))];
    if (!runIds.length) return 'There are no approved trends waiting for reports.';
    const undecided = runIds.reduce((sum, runId) => sum + generationPlan(board.cards, runId).undecided.length, 0);
    const cost = await reportCostLines(runIds);
    const ok = await confirm({ title: `Write reports for ${plural(approved.length, 'approved trend')}?`, lines: [...cost, undecided ? `${plural(undecided, 'trend')} you haven’t decided on from the same run will be skipped.` : ''], items: approved.map((card) => card.name).slice(0, 12), confirmLabel: 'Write reports' });
    if (!ok) return false;
    for (const runId of runIds) {
      const plan = generationPlan(board.cards, runId);
      await run(async () => {
        await api.approveResearchThemes({ runId, themes: plan.approved.map((card) => card.themeId) });
        return api.continueResearchRun({ runId });
      }, `Writing reports for ${plural(approved.length, 'trend')}. They’ll appear under Reports when done.`);
    }
    return `Writing ${plural(approved.length, 'report')}. They’ll appear under Reports.`;
  }

  // Buttons Ask AI offers (and chat cards, which add ids: runId, themeId, assetId, folderKey, programId). Ids match
  // first; titles from the model match exactly, else by containment.
  async function runAiAction(request = {}) {
    const method = AI_ACTION_METHOD[request.kind];
    if (method && !canRun(method)) throw new Error(viewer.preview ? PREVIEW_TITLE : request.kind === 'edit-prompt' ? `Your role can see prompts but not change them. Ask ${askAdmin}.` : `Your role doesn’t include that. Ask ${askAdmin} if you need it.`);
    const target = request.target || '';
    if (request.kind === 'start-research') {
      const program = (request.programId && programs.find((row) => row.id === request.programId)) || programs.find((row) => same(row.name, target)) || (programs.length === 1 ? programs[0] : null);
      if (!program) throw new Error(`I couldn’t find a research program called “${target}”.`);
      return startResearch(program);
    }
    if (request.kind === 'quick-scan') return quickScan(request.scan || {}, { topic: target, programId: request.programId || '' });
    if (request.kind === 'approve-trend' || request.kind === 'pass-trend') {
      const card = (request.themeId && waiting.find((row) => row.themeId === request.themeId && (!request.runId || row.runId === request.runId))) || waiting.find((row) => same(row.name, target));
      if (!card) throw new Error(`“${target || 'That trend'}” isn’t waiting for your OK anymore.`);
      decide(card, request.kind === 'approve-trend' ? 'approved' : 'passed');
      return request.kind === 'approve-trend' ? `Approved “${card.name}”.` : `Skipped “${card.name}”.`;
    }
    if (request.kind === 'approve-all-trends') {
      if (!waiting.length) return 'No trends are waiting for your OK.';
      const ok = await confirm({ title: `Say yes to all ${plural(waiting.length, 'waiting trend')}?`, lines: ['Nothing is written or spent until you write the reports.'], items: waiting.map((card) => card.name).slice(0, 12), confirmLabel: 'Approve all' });
      if (!ok) return false;
      for (const card of waiting) decide(card, 'approved');
      return `Approved ${plural(waiting.length, 'trend')}.`;
    }
    if (request.kind === 'write-reports') return writeReports();
    if (request.kind === 'open-report' || request.kind === 'make-assets') {
      const report = (request.assetId && reports.find((row) => row.id === request.assetId)) || findReport(target);
      if (!report) throw new Error(`I couldn’t find a report called “${target}”.`);
      if (request.kind === 'open-report') { go('openReport', report.id); return 'Opened.'; }
      go('makeAssets', { kind: 'report', assetId: report.id });
      return 'Opened the asset dialog. Check what will be made, then press Make.';
    }
    const foldered = ['open-folder', 'finish-assets', 'save-folder'].includes(request.kind);
    const folder = foldered ? (request.folderKey && kitFolders.find((row) => row.key === request.folderKey)) || findFolder(target) : null;
    if (foldered && !folder) throw new Error(`I couldn’t find an asset folder called “${target}”.`);
    if (request.kind === 'open-folder') { go('openFolder', folder.key); return 'Opened.'; }
    if (request.kind === 'finish-assets') {
      const latest = folder.runs[0]; const left = list(latest.jobs).filter((job) => job.status !== 'succeeded').length;
      if (ACTIVE.has(latest.status)) return 'That run is still going. Assets appear in its folder as they’re ready.';
      if (!left) return 'Every asset in that run is already finished.';
      const cap = Math.min(1000, Math.max(Number(latest.maxBudgetUsd) || 0, Math.ceil((Number(latest.reservedUsd) || 0) + left * 2)));
      const ok = await confirm({ title: `Finish the ${plural(left, 'asset')} that didn’t make it in “${folder.title}”?`, lines: [`This can spend up to ${money(Math.max(0, cap - (Number(latest.reservedUsd) || 0)))} more. Finished assets aren’t made again.`, codex ? CODEX_UNCAPPED : ''], confirmLabel: 'Finish them' });
      if (!ok) return false;
      const refreshPrompts = await askNewestPrompts(latest);
      const result = await run(() => api.retryStudioRun({ runId: latest.id, maxBudgetUsd: cap, ...(refreshPrompts ? { refreshPrompts: true } : {}) }), 'Finishing the rest.');
      if (result && typeof nav?.openFolder === 'function') nav.openFolder(folder.key);
      return result ? `Finishing ${plural(left, 'asset')}.` : false;
    }
    if (request.kind === 'save-folder') {
      const saved = folder.runs.find((row) => list(studio.assets).some((asset) => asset.runId === row.id));
      if (!saved) return 'Nothing in that folder is ready to save yet.';
      const done = web ? 'Download started.' : 'Saved to your Downloads folder.';
      const result = await run(() => api.saveAssetKitFolder({ runId: saved.id }), done);
      return result ? done : false;
    }
    if (request.kind === 'stop-run') {
      const live = (request.runId && liveRuns.find((row) => row.id === request.runId)) || titled(liveRuns, target, runName);
      if (!live) throw new Error(`Nothing called “${target || 'that'}” is running.`);
      const ok = await confirm({ title: `Stop “${runName(live)}”?`, lines: ['Finished work is kept, and you can try the rest later.'], confirmLabel: 'Stop', tone: 'danger' });
      if (!ok) return false;
      const result = await run(() => api.cancelStudioRun({ runId: live.id }), 'Stopped. Finished work is kept.');
      return result ? 'Stopped. Finished work is kept.' : false;
    }
    if (request.kind === 'retry-run') {
      const candidates = [...list(studio.researchRuns), ...list(studio.contentRuns)].filter(mine).filter((row) => ['failed', 'partial', 'cancelled'].includes(row.status));
      const failed = (request.runId && candidates.find((row) => row.id === request.runId)) || titled(candidates, target, runName);
      if (!failed) throw new Error(`I couldn’t find a stopped or failed run called “${target || 'that'}”.`);
      const left = Math.max(0, (Number(failed.maxBudgetUsd) || 0) - (Number(failed.reservedUsd) || 0));
      const ok = await confirm({ title: `Try “${runName(failed)}” again?`, lines: [`It keeps finished work and can spend up to ${money(left)} more of its budget.`, codex ? CODEX_UNCAPPED : ''], confirmLabel: 'Try again' });
      if (!ok) return false;
      const refreshPrompts = await askNewestPrompts(failed);
      const result = await run(() => api.retryStudioRun({ runId: failed.id, maxBudgetUsd: failed.maxBudgetUsd, ...(refreshPrompts ? { refreshPrompts: true } : {}) }), 'Trying again.');
      return result ? 'Trying again. Progress shows on Home.' : false;
    }
    if (request.kind === 'open-tab') {
      const tab = String(target).toLowerCase();
      if (tab === 'settings' && !settingsAllowed) throw new Error(`Settings are for admins. Ask ${askAdmin} if something needs changing.`);
      if (![...tabs, ...(settingsAllowed ? ['settings'] : [])].includes(tab)) throw new Error(`There’s no “${target}” tab.`);
      go('openTab', tab);
      return 'Opened.';
    }
    if (request.kind === 'open-tracker') { go('openSheets', 'trend-tracker'); return 'Opened the Trend tracker.'; }
    if (request.kind === 'edit-prompt') return savePromptEdit(request);
    throw new Error('That action isn’t available.');
  }

  return { runAiAction, startResearch, quickScan, decide, writeReports, newerPrompts, askNewestPrompts, savePromptEdit, waiting, approved, reports, kitRuns, kitFolders, findReport, findFolder, board, researchRuns, programs, liveRuns, workspace, askAdmin };
}
