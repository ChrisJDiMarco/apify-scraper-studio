import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, CircleCheck, LayoutList, LoaderCircle, Radar, RotateCcw, SquareKanban, TrendingUp, TriangleAlert, Undo2, X } from 'lucide-react';
import { HelpAssistant } from './help-assistant.jsx';
import { SimpleAssets } from './simple-assets.jsx';
import { kitSourcesFrom } from './kit-creator.jsx';
import { SimpleReports } from './simple-reports.jsx';
import { Spotlight, spotFor } from './spotlight.jsx';
import { DecidedBy, MOMENTUM_COPY, MomentumBadge, WhyItMatters, decisionOf } from './trend-pulse.jsx';
import { TrendYesButton, channelLabel, fitsFor, routingChannels } from './trend-decision-sheet.jsx';
import { WeeklyBriefing } from './weekly-briefing.jsx';
import { MondayChip, MondayStatusLine } from './monday-ui.jsx';
import { linkFor, shareOrigin } from './deep-links.js';
import { copyText, useToast } from './role-screens.jsx';
import { useAnnouncingApi } from './help-images.js';
import { defaultProgram, lastProgramId, readChoice, rememberProgram, saveChoice } from './choices.js';
import { canWriteReports, useStudioActions } from './studio-actions.js';
import { adminNames, useCan, useViewer, writeProps } from './viewer.js';
import { number, withViewTransition } from './ui.jsx';
import { requestNoteFocus } from './report-editor/events.js';
import { PASSED_STAGE, TREND_STAGES } from '../../shared/trend-board.js';
import { buildLibraryTree } from '../../shared/library-tree.js';
import './simple-mode.css';

// Simple mode: the whole studio as a few plain pages, listed in the left sidebar (App renders it, owns which tab is open
// and the ⌘1–9 shortcuts). Home is the weekly briefing (what needs you and what changed), Trends asks yes or no, Reports
// reads (and edits) what was written, Assets holds channel assets and pictures, Inbox and Calendar follow the team's
// work, and Ask AI answers anything, does the work after you confirm, and can take you to any control and spotlight it.
// The Studio pages (Prompts, Analytics, People & access, Brand knowledge, Settings) and Inbox and Calendar render through `renderPage`.
// Everything else is in the Advanced layout.
// The Simple pages in sidebar order (nav-model.js SIMPLE_PAGES, which also holds their labels and icons), then Ask AI:
// the tabs SimpleMode allows when it's drawn without App.
export const SIMPLE_TABS = Object.freeze(['home', 'trends', 'reports', 'assets', 'inbox', 'calendar', 'ask']);
const ASK_COPY = {
  subtitle: 'Answers, the work done for you, and “show me” tours of the app.',
  title: 'What can I help with?',
  placeholder: 'Ask anything, tell me what to do, or say “show me”…',
};
// Ask AI's starters and intro follow what this role can do (useCan, so a preview shows the previewed role's), and what
// is true right now: trends waiting, approved trends, a stopped run, pictures on. Four to six, the most useful first.
export function startersFor(can, { admin = false, imagesReady = false, waiting = 0, approved = 0, reports = 0, stopped = 0, latestTrend = '' } = {}) {
  const trend = String(latestTrend || '').trim();
  const rows = [
    can('decideResearchTheme') && waiting > 0 && 'Which trends still need my OK?',
    canWriteReports(can) && approved > 0 && 'Write the reports for my approved trends',
    can('readStudioRun') && stopped > 0 && 'Why did my last run stop?',
    (can('readTrendHistory') || can('readStudioRun')) && 'What are the biggest trends right now?',
    can('readTrendHistory') && 'What changed since my last research run?',
    can('planAssetKit') && can('createAssetKit') && reports > 0 && 'Make every channel asset for my latest trend',
    can('startQuickScan') && trend && `Quick scan: what’s new on “${trend.length > 60 ? `${trend.slice(0, 59)}…` : trend}” in the last 6 hours?`,
    can('createHelpImage') && imagesReady && trend && 'Create a hero image for my latest trend',
    admin && !imagesReady && 'Show me where to turn on pictures',
    'What should I do next?',
  ].filter(Boolean);
  return [...new Set(rows)].slice(0, 6);
}
export function askIntro(can, { admin = false } = {}) {
  const sees = [(can('readTrendHistory') || can('readStudioRun')) && 'your trends and how they move across runs', can('readStudioAsset') && 'your reports and asset folders', admin && 'settings'].filter(Boolean);
  const reads = [can('readStudioAsset') && 'read any report', can('searchEvidence') && 'search the posts research collected'].filter(Boolean);
  const does = ['decideResearchTheme', 'approveResearchThemes', 'startResearchRun', 'createAssetKit', 'savePromptVersion'].some((method) => can(method));
  return [
    sees.length ? `I can see ${sees.length > 1 ? `${sees.slice(0, -1).join(', ')} and ${sees.at(-1)}` : sees[0]}${reads.length ? `, and I can ${reads.join(' and ')}` : ''}.` : 'I can answer questions about how the studio works.',
    `Ask a question${does ? ', tell me what to do (I’ll offer a button, so nothing happens until you click)' : ''}${can('startQuickScan') ? ', ask for a quick scan of the last few hours' : ''}, or say “show me” and I’ll take you to the right place and point at it.`,
    'Our conversations are saved for you, and you can see what I remember under Memory.',
  ].join(' ');
}
// Ask AI page links (main/help-assistant.js HELP_PAGES ids) that have a home in Simple mode; anything else opens in the
// Advanced layout. `reports` there is Dataset reports and `dashboard` the Collection overview, so neither maps to a tab.
const SIMPLE_PAGE = { overview: 'home', library: 'reports', board: 'trends', settings: 'settings', assets: 'assets', inbox: 'inbox', calendar: 'calendar', prompts: 'prompts', analytics: 'analytics', people: 'people', knowledge: 'knowledge' };
// Pages App draws (renderPage) inside the Simple column.
const SHELL_PAGES = new Set(['analytics', 'people', 'prompts', 'knowledge', 'inbox', 'calendar']);
const ACTIVE = new Set(['queued', 'running']);
const list = (value) => (Array.isArray(value) ? value : []);
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
const readable = (value) => String(value || '').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
const webLink = (value) => (/^https?:\/\/\S+$/i.test(String(value || '').trim()) ? String(value).trim() : '');
const nameKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
// The trend history's record for a board card (readTrendHistory().trends): any theme id the trend has used first, then
// the same name, since a recurring trend can carry a new theme id in each run.
function trendIndex(history) {
  const byTheme = new Map(); const byName = new Map();
  for (const trend of list(history?.trends)) {
    for (const id of list(trend.themeIds)) if (!byTheme.has(id)) byTheme.set(id, trend);
    const key = nameKey(trend.name); if (key && !byName.has(key)) byName.set(key, trend);
  }
  return (card) => byTheme.get(card.themeId) || byName.get(nameKey(card.name)) || null;
}

// Controlled by App: `tab` and `onTab` (App asks about unsaved edits before switching, and keeps the tab across a
// trip to the Advanced layout). `tabs` are the tabs this role has, in nav order. Settings, the Studio pages, Inbox and
// Calendar render through `renderPage` when App opens them from the sidebar. `shellRequest` ({ key, kind: 'report' |
// 'ask' | 'assets', … }) is the shell asking for something once (the ⌘K palette, the New menu, a share link, or the
// Advanced layout handing over to Assets); `onOpenSheets(workbookId)` opens one Sheets workbook as an Advanced page (the
// Trend tracker). `onOpenTarget(target)` is App's router for the briefing's links ({ kind, id, page }, as the Inbox
// uses), `onOpenPrompt(promptId)` opens Prompts, and `linkOrigin` is the address share links are built on. `shellNav`
// carries the shell's own ways (App): copyLink(kind, id), openInvite(preset), viewAs(payload), openProgramDraft(draft),
// create(kind) (the New menu) and makeAssets(request) (the asset dialog over the current page), which Ask AI's nav, the
// report reader and Home's Next up use.
export function SimpleMode({ api: apiIn, state, meta, busy, loading, notice, error, onDismiss, action, background = [], renderPage, renderSettings, onOpenClassic, onOpenSheets, onOpenTarget, onOpenPrompt, linkOrigin: linkOriginIn, tab: shownTab, onTab, tabs = SIMPLE_TABS, settingsAllowed = true, onNotice, onNavSpot, spotRoot, shellRequest = null, shellNav = {} }) {
  // Ask AI announces each picture it makes, so Assets lists it even when it was drawn behind another tab.
  const api = useAnnouncingApi(apiIn);
  const viewer = useViewer();
  const can = useCan(); // what this role has (in a preview, the previewed role's controls, shown disabled)
  const [ownTab, setOwnTab] = useState('home');
  const tab = shownTab ?? ownTab;
  const [seed, setSeed] = useState(null);
  const [reportId, setReportId] = useState('');
  const [tour, setTour] = useState(null); // an Ask AI "Show me" in progress
  const [lastTab, setLastTab] = useState('home'); // where the person was before Ask AI, for its context
  const [assetFolder, setAssetFolder] = useState(''); // the Assets folder open, for Ask AI's context
  const [programId, setProgramIdState] = useState(''); // the research program Trends starts (Home's briefing keeps its own pick)
  const setProgramId = (id) => { setProgramIdState(id); rememberProgram(viewer, id); };
  const [history, setHistory] = useState(undefined); // readTrendHistory(): undefined while it loads, null when unavailable
  const web = meta?.runtime === 'web';
  const studio = state.contentStudio || {};
  const workspaces = list(studio.workspaces);
  const workspace = workspaces.find((item) => item.id === studio.activeWorkspaceId) || null;
  const semrush = workspace?.editionId === 'semrush';
  const askAdmin = adminNames(state, 'an admin');
  const mine = (row) => !workspace || !row.workspaceId || row.workspaceId === workspace.id;
  const needsSetup = !state.keys?.APIFY_API_TOKEN;
  const page = renderPage || ((id) => (id === 'settings' ? renderSettings?.() : null));

  const go = (next) => (onTab ? onTab(next) : withViewTransition(() => setOwnTab(next)));
  const linkOrigin = linkOriginIn ?? shareOrigin({ web, settings: state.settings });
  const channels = useMemo(() => routingChannels(workspace?.editionId || 'general'), [workspace?.editionId]);

  useEffect(() => { if (tab !== 'ask') setLastTab(tab); }, [tab]);
  // Leaving Reports (other than for Ask AI, which keeps the report as its context) closes the reader, so every way back
  // (the sidebar, Home's All reports, an Inbox or Next up page link) opens the list. Opening one report sets it again.
  useEffect(() => { if (tab !== 'reports' && tab !== 'ask') setReportId(''); }, [tab]);
  function ask(text, context = '', extra = {}) { setSeed({ text, context, ...(Array.isArray(extra?.attachments) ? { attachments: extra.attachments } : {}), key: Date.now() }); go('ask'); }
  function draftAsk(text) { setSeed({ draft: text, key: Date.now() }); go('ask'); }
  // Images load once and stay cached for the session, so returning to Assets is instant.
  const [imageCache, setImageCache] = useState({});
  const [assetRequest, setAssetRequest] = useState(null); // open the asset dialog, a folder, or Assets itself
  // Make channel assets ({ kind: 'report', assetId, channels? }) inside Assets: the dialog on that report, its `channels`
  // pre-ticked (else the person's own); without a source it opens on its source step. After Make, Assets opens the folder.
  function makeAssetsInAssets(request) { const { channels, ...source } = request || {}; setAssetRequest({ key: Date.now(), open: 'creator', ...(source.kind ? { source } : {}), ...(list(channels).length ? { channels: list(channels).map(String) } : {}) }); go('assets'); }
  // From anywhere else (a report, Home, Ask AI) the dialog opens over the page you're on (App's KitCreatorHost), so
  // Cancel leaves you there; after Make, a note offers Open folder.
  function makeAssets(request) { if (shellNav.makeAssets && tab !== 'assets') shellNav.makeAssets(request); else makeAssetsInAssets(request); }
  // A folder in Assets by its kit sourceKey or Library node id (SimpleAssets resolves either); `runId` opens that set.
  function openFolderKey(folderKey, runId = '') { setAssetRequest({ key: Date.now(), open: 'folder', folderKey, ...(runId ? { runId } : {}) }); go('assets'); }
  function openFolder(folder) { openFolderKey(folder.key); }
  function openReport(id) { setReportId(id); go('reports'); }
  function openPage(target) {
    const home = SIMPLE_PAGE[target];
    if (home === 'settings' && !settingsAllowed) { onNotice?.(`Settings are for admins. Ask ${askAdmin} if something needs changing.`); return; }
    if (home && (tabs.includes(home) || home === 'settings' || SHELL_PAGES.has(home))) go(home);
    else onOpenClassic?.(target);
  }
  const openSettings = settingsAllowed ? () => go('settings') : undefined;
  // Save to Drive before Drive is connected: Settings → Google Drive, through App's router (which opens that section).
  const openDriveSettings = settingsAllowed ? () => (onOpenTarget ? onOpenTarget({ kind: 'page', page: 'settings', section: 'google-drive' }) : go('settings')) : undefined;
  // The briefing's links ({ kind, id, page }): reports and Assets folders open here; everything else (a trend's card,
  // a run, a prompt, a page) goes through App's router, which the Inbox and share links use too.
  function openTarget(target = {}) {
    if (target.noteId) requestNoteFocus(target.id, target.noteId); // a note's Inbox row opens the report at that note
    if (target.kind === 'report' && target.id && reports.some((row) => row.id === target.id)) openReport(target.id);
    else if (target.kind === 'folder' && target.id) openFolderKey(target.id, target.runId || '');
    else if (onOpenTarget) onOpenTarget(target);
    else if (target.page && tabs.includes(target.page)) go(target.page);
  }
  // How Simple takes someone somewhere, for Ask AI's buttons and cards (studio-actions.js StudioNav). Sheets is an
  // Advanced page: it opens as a peek, with the Back to Simple bar.
  const nav = { openReport, openFolder: openFolderKey, makeAssets, openTab: (next) => go(next), openPage, openSheets: (workbookId) => (onOpenSheets ? onOpenSheets(workbookId) : onOpenClassic?.('sheets')), openPrompt: onOpenPrompt,
    openTarget, copyLink: shellNav.copyLink || ((kind, id) => { const link = linkFor(kind === 'folder' ? 'assets' : kind, id, { origin: linkOrigin }); if (link) copyText(link); return link; }),
    ...(shellNav.openInvite ? { openInvite: shellNav.openInvite } : {}), ...(shellNav.viewAs ? { viewAs: shellNav.viewAs } : {}), ...(shellNav.openProgramDraft ? { openProgramDraft: shellNav.openProgramDraft } : {}) };
  // Ask AI's buttons and the studio work behind them, shared with the Advanced drawer (studio-actions.js): every paid
  // step shows its estimate in the in-app confirmation before it runs.
  const { runAiAction, startResearch, decide, writeReports, waiting, approved, reports, kitRuns, kitFolders, findReport, findFolder, board, liveRuns, programs } = useStudioActions({ api, state, action, nav, settingsAllowed, tabs, web, onNotice });
  // One rule for every Find new trends: the program picked here, else the one this person chose last, else the newest.
  const program = defaultProgram(programs, { id: programId, lastId: lastProgramId(viewer) });
  // A start that went through is the person's choice too, so the next Find new trends (here or on Home) starts it again.
  const startAndRemember = async (chosen) => { const started = await startResearch(chosen); if (typeof started === 'string' && chosen?.id) rememberProgram(viewer, chosen.id); return started; };
  // A Yes or Skip from Home or Trends can be taken back for a few seconds (decision 'pending' undoes it while the run
  // still waits for review; the server refuses once reports have started, and decide() says so).
  const [undoToast, showUndo] = useToast(8000);
  const decideUndoable = (card, decision, extra) => {
    const sent = decide(card, decision, extra);
    if (decision !== 'pending') Promise.resolve(sent).then((ok) => { if (ok) showUndo(decision === 'passed' ? `Skipped “${card.name}”.` : `Approved “${card.name}”.`, { actionLabel: 'Undo', onAction: () => decide(card, 'pending') }); }, () => {});
    return sent;
  };
  const stopped = board.scouting.filter((scout) => scout.status === 'failed');
  const retryRun = can('retryStudioRun') ? (runId) => Promise.resolve().then(() => runAiAction({ kind: 'retry-run', runId })).then((result) => { if (typeof result === 'string') onNotice?.(result); }, (failure) => onNotice?.(failure?.message || 'That run couldn’t be tried again.')) : undefined;
  // "Yes, with a note…": the sheet waits for the save and shows a refusal itself.
  const decideWithNote = (card, choice) => decideUndoable(card, 'approved', choice);

  // The Library's folders (shared/library-tree.js): Reports shows a trend's report and toolkit as one row, and Assets
  // files each set under the research run and trend it came from. Rebuilt only when the studio records change.
  const libraryTree = useMemo(() => buildLibraryTree({
    researchRuns: list(studio.researchRuns).filter(mine), contentRuns: list(studio.contentRuns).filter(mine), assets: list(studio.assets).filter(mine),
    themes: list(studio.themes).filter(mine), programs: list(studio.programs).filter(mine), editionId: workspace?.editionId || 'general', adoptionsByTheme: studio.adoptionsByTheme || {},
  }), [studio.researchRuns, studio.contentRuns, studio.assets, studio.themes, studio.programs, studio.adoptionsByTheme, workspace?.id, workspace?.editionId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Momentum across research runs (readTrendHistory, from shared/trend-history.js) for the badges and "Why it matters" on
  // Trends; the Home briefing reads its own What changed. Read once Trends has been opened, then again whenever one of
  // this workspace's research runs moves on; the last answer stays on screen meanwhile. Editors see it too.
  const historyOn = typeof api.readTrendHistory === 'function' && can('readTrendHistory');
  const [historyWanted, setHistoryWanted] = useState(tab === 'trends');
  useEffect(() => { if (tab === 'trends') setHistoryWanted(true); }, [tab]);
  // Keyed on what changes trends (a stage or status, a decision, a report run), not on every progress push.
  const runsKey = list(studio.researchRuns).filter(mine).map((run) => `${run.id}:${run.status || ''}:${run.stage || ''}:${Object.keys(run.decisions || {}).length}:${list(run.reportRunIds).length}`).join('|');
  useEffect(() => { setHistory(undefined); }, [workspace?.id]);
  useEffect(() => {
    if (!historyOn) { setHistory(null); return undefined; }
    if (!historyWanted) return undefined;
    let cancelled = false;
    Promise.resolve().then(() => api.readTrendHistory({})).then((result) => { if (!cancelled) setHistory(result || null); })
      .catch(() => { if (!cancelled) setHistory(null); }); // the badges are a nicety: Trends works without them
    return () => { cancelled = true; };
  }, [historyOn, historyWanted, runsKey, workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const trendOf = useMemo(() => trendIndex(history), [history]);

  // Ask AI "Show me": each step first moves to the place its control lives (a tab, a report, a folder, the dialog).
  // Sidebar controls (nav.*) sit in a drawer below 860px, so App opens it for those steps and closes it after.
  async function prepareSpot(step) {
    const spot = spotFor(step.target); if (!spot) return;
    const inSidebar = spot.id.startsWith('nav.') || String(spot.selector || '').includes('"nav.');
    onNavSpot?.(inSidebar);
    if (inSidebar) return;
    if (spot.item === 'report') { const report = findReport(step.item) || reports.find((row) => row.id === reportId) || reports[0]; if (report) setReportId(report.id); go('reports'); }
    else if (spot.tab === 'reports') { setReportId(''); go('reports'); }
    else if (spot.item === 'folder') { const folder = findFolder(step.item) || kitFolders[0]; if (folder) openFolder(folder); else go('assets'); }
    else if (spot.item === 'kit-source') { setAssetRequest({ key: Date.now(), open: 'creator', mode: { 'kit-dialog.link': 'link', 'kit-dialog.paste': 'paste' }[spot.id] || 'report' }); go('assets'); }
    else if (spot.item === 'kit-review') { const report = findReport(step.item) || reports[0]; if (report) makeAssetsInAssets({ kind: 'report', assetId: report.id }); else go('assets'); }
    // A trend's folder sits inside its research run, so Assets opens that run for the step's trend.
    else if (spot.tab === 'assets') { setAssetRequest({ key: Date.now(), open: 'home', ...(spot.id === 'assets.folder' && step.item ? { item: step.item } : {}) }); go('assets'); }
    else if (spot.tab === 'settings' && !settingsAllowed) return;
    else if (spot.tab) go(spot.tab);
  }
  // Show me here covers Simple's tabs, the sidebar, Settings and Ask AI; steps on Advanced pages are left out.
  function showTour(steps) {
    const shown = list(steps).filter((step) => { const spot = spotFor(step?.target); return spot && spot.layout !== 'classic'; });
    if (shown.length) setTour({ steps: shown, key: Date.now() });
    else onNotice?.('That’s on an Advanced page. Use the page button under the answer to open it.');
  }
  // A request from the shell, acted on once: open a report, ask Ask AI (a question with its background, or words left in
  // the box to finish: New › Quick scan, New › Picture), or open Assets (a folder, or the asset dialog: New › Channel
  // assets sends `creator` with no source, so the dialog opens on its source step).
  const handledRequest = useRef(null);
  useEffect(() => {
    if (!shellRequest?.key || handledRequest.current === shellRequest.key) return;
    handledRequest.current = shellRequest.key;
    if (shellRequest.kind === 'report' && shellRequest.assetId) openReport(shellRequest.assetId);
    else if (shellRequest.kind === 'ask' && shellRequest.text) ask(shellRequest.text, shellRequest.context || '', { attachments: shellRequest.attachments });
    else if (shellRequest.kind === 'ask' && shellRequest.draft) draftAsk(shellRequest.draft);
    else if (shellRequest.kind === 'assets') { if (shellRequest.source || shellRequest.creator) makeAssetsInAssets(shellRequest.source); else if (shellRequest.folderKey) openFolderKey(shellRequest.folderKey, shellRequest.runId || ''); else go('assets'); }
  }, [shellRequest?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const studioImages = list(studio.assets).filter(mine).filter((asset) => asset.kind === 'image' || asset.kind === 'video');

  // Who used a report's trend, from the channel owners' answers (Used by, and Where it's used in the reader).
  const runTheme = useMemo(() => new Map(list(studio.contentRuns).map((run) => [run.id, run.themeId || ''])), [studio.contentRuns]);
  const channelName = (id, row) => row?.channelName || list(viewer.channels).find((channel) => channel.id === id)?.name || readable(id);
  function usesOf(report) {
    const themeId = report?.themeId || runTheme.get(report?.runId) || '';
    const byChannel = (themeId && studio.adoptionsByTheme?.[themeId]) || {};
    return Object.entries(byChannel).filter(([, row]) => row?.status === 'using').map(([channelId, row]) => ({ channelId, name: channelName(channelId, row), link: webLink(row.link), byName: row.byName || '', at: row.at || '' })).sort((a, b) => a.name.localeCompare(b.name));
  }

  const admin = settingsAllowed;
  const imagesReady = Boolean(state.keys?.OPENAI_API_KEY);
  const latestTrend = (board.cards.find((card) => list(card.reportAssets).length) || waiting[0] || null)?.name || '';
  const starters = startersFor(can, { admin, imagesReady, waiting: waiting.length, approved: approved.length, reports: reports.length, stopped: stopped.length + list(studio.contentRuns).filter(mine).filter((run) => ['failed', 'partial'].includes(run.status)).length, latestTrend });
  const askCopy = { ...ASK_COPY, intro: askIntro(can, { admin }), ...(admin ? {} : { noPictures: `Pictures are off for your team. ${askAdmin} can turn them on.` }) };
  // Real posts on a trend card are free (readTrendPosts reads saved research), for roles that read research.
  const postsApi = typeof api.readTrendPosts === 'function' && can('readTrendPosts') ? api : null;
  const onAsk = can('askHelp') && api.askHelp ? ask : null;
  const spotlight = tour && !loading ? <Spotlight key={tour.key} steps={tour.steps} onPrepare={prepareSpot} onClose={() => { setTour(null); onNavSpot?.(false); }} onBackToChat={() => { setTour(null); onNavSpot?.(false); go('ask'); }} /> : null;
  // The spotlight sits on the frame, not in this column, so it stays usable while the sidebar drawer is open.
  const spotHost = spotlight && typeof spotRoot === 'function' ? spotRoot() : null;
  return <div className="simple-shell" data-edition={semrush ? 'semrush' : 'general'}>
    {(error || notice) && <div className={`simple-toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button type="button" aria-label="Dismiss" onClick={onDismiss}><X size={15} /></button></div>}
    <main className="simple-main" data-tab={tab}>
      {loading ? <div className="simple-loading" role="status"><LoaderCircle className="spin" size={26} aria-hidden="true" /><p>Opening your studio…</p></div>
        : tab === 'home' ? <WeeklyBriefing state={state} viewer={viewer} api={api} layout="simple" busy={busy} board={board} onNotice={onNotice} onOpenProgramPage={onOpenClassic ? (programId) => onOpenClassic('research', { programId }) : undefined} onOpenTarget={openTarget} onDecide={decideUndoable} onDecideWithNote={decideWithNote} onAsk={onAsk || undefined} onOpenTracker={can('readWorkbook') ? () => nav.openSheets('trend-tracker') : undefined} onStartResearch={startAndRemember} linkOrigin={linkOrigin} postsApi={postsApi} onWriteReports={canWriteReports(can) ? writeReports : undefined} onRetryRun={retryRun} onMakeAssets={can('planAssetKit') && can('createAssetKit') ? makeAssets : undefined} onCreate={shellNav.create} web={web} />
        : tab === 'reports' ? <SimpleReports api={api} web={web} reports={reports} selectedId={reportId} onSelect={setReportId} action={action} busy={busy} onAsk={onAsk} onFindTrends={() => go('trends')} onMakeAssets={(report) => makeAssets({ kind: 'report', assetId: report.id })} usesOf={usesOf} tree={libraryTree} onOpenAssets={openFolderKey} studio={studio} linkOrigin={linkOrigin} onOpenPrompt={onOpenPrompt} drive={state.driveSync} onOpenDriveSettings={openDriveSettings} />
        : tab === 'trends' ? <SimpleTrends board={board} waiting={waiting} approved={approved} programs={programs} program={program} onProgram={setProgramId} trendOf={trendOf} researchRuns={list(studio.researchRuns).filter(mine)} channels={channels} focusChannels={list(viewer.prefs?.focusChannels)} busy={busy} needsSetup={needsSetup} askAdmin={askAdmin} onDecide={decideUndoable} onDecideWithNote={typeof api.decideResearchTheme === 'function' ? decideWithNote : undefined} onAsk={onAsk || undefined} onWriteReports={writeReports} onStartResearch={startAndRemember} onOpenReport={openReport} onOpenClassic={onOpenClassic} onSettings={openSettings} stopped={stopped} onRetry={retryRun} postsApi={postsApi} monday={state.monday} mondayApi={api} />
        : tab === 'assets' ? <SimpleAssets api={api} web={web} tree={libraryTree} editionId={workspace?.editionId || 'general'} contentRuns={list(studio.contentRuns).filter(mine)} kitRuns={kitRuns} assets={list(studio.assets).filter(mine)} studioImages={studioImages} sources={kitSourcesFrom(reports, list(studio.contentRuns).filter(mine))} request={assetRequest} onRequestDone={() => setAssetRequest(null)} cache={imageCache} onCache={(id, url) => setImageCache((current) => ({ ...current, [id]: url }))} action={action} busy={busy} imagesReady={imagesReady} googleReady={Boolean(studio.capabilities?.googlePublishConfigured)} askAdmin={askAdmin} onDraft={draftAsk} onAsk={ask} onSettings={openSettings} onOpenReport={openReport} onOpenTrends={() => go('trends')} onViewChange={setAssetFolder} workspace={workspace} promptChanges={list(studio.promptChanges)} />
        : tab === 'settings' ? <div className="simple-page simple-settings"><div className="simple-page-head"><div><h1>Settings</h1><p>{settingsAllowed ? 'Connections, AI, pictures and brand knowledge for the whole studio.' : 'Brand knowledge for the whole studio.'}</p></div></div>{page('settings')}</div>
        : SHELL_PAGES.has(tab) ? page(tab)
        : null}
      <div className="simple-ask-wrap" hidden={tab !== 'ask' || loading}>
        <HelpAssistant api={api} variant="page" open={tab === 'ask'} seed={seed} starters={starters} copy={askCopy} imagesReady={imagesReady} page={{ id: 'simple-mode', label: 'Simple mode', layout: 'simple', tab: lastTab, ...(lastTab === 'reports' && reportId ? { report: reports.find((row) => row.id === reportId)?.title || '' } : {}), ...(lastTab === 'assets' && assetFolder ? { folder: assetFolder } : {}) }} onOpenPage={openPage} onOpenSettings={openSettings} onAction={runAiAction} onShow={showTour} state={state} nav={nav} onOpenAssets={() => go('assets')} onClose={() => go('home')} />
      </div>
    </main>
    {spotHost ? createPortal(spotlight, spotHost) : spotlight}
    {undoToast}
  </div>;
}

// `program` and `onProgram` are the research program Find new trends starts; `trendOf(card)` is the trend history's
// record for a card (momentum across runs), or null. `researchRuns` say who decided each trend (run.decisionsBy), with
// their note and the channels they routed it to; `channels` are this edition's channels (routing and "Fits Social"
// against the person's `focusChannels`). `onDecideWithNote(card, { note, channels })` is Yes, with a note… (its sheet
// waits for the save); `onAsk(text)` adds "What people are saying" to a card that needs an OK, and `postsApi` (an api with
// readTrendPosts) shows two real posts in place. `stopped` are research runs that failed before finding trends, each
// with Try again (`onRetry(runId)`, behind its cost confirmation) and See why.
function SimpleTrends({ board, waiting, approved, programs, program, onProgram, trendOf = () => null, researchRuns = [], channels = [], focusChannels = [], busy, needsSetup, askAdmin, onDecide, onDecideWithNote, onAsk, onWriteReports, onStartResearch, onOpenReport, onOpenClassic, onSettings, stopped = [], onRetry, postsApi = null, monday = null, mondayApi = null }) {
  const can = useCan();
  const viewer = useViewer();
  const production = board.columns.production || [];
  const ready = board.columns.ready || [];
  const empty = !board.cards.length && !board.scouting.length;
  const canDecide = can('decideResearchTheme');
  const canWrite = canWriteReports(can);
  const canResearch = can('startResearchRun');
  const canSetUp = can('saveResearchProgram');
  // List or Board, remembered for this person on this device (the older shared key still counts until they choose).
  const [layout, setLayout] = useState(() => { const saved = readChoice(viewer, 'trends.layout', ''); if (saved) return saved === 'board' ? 'board' : 'list'; try { return localStorage.getItem('simple.trends.layout') === 'board' ? 'board' : 'list'; } catch { return 'list'; } });
  const chooseLayout = (next) => { setLayout(next); saveChoice(viewer, 'trends.layout', next); };
  const skipped = (board.columns.passed || []).filter((card) => card.canDecide);
  // Why research can't start yet, in words (the same reasons as Home's Find new trends).
  const blocked = Boolean(program) && needsSetup;
  const setupHint = onSettings ? 'Connect Apify in Settings first' : `Ask ${askAdmin} to connect Apify first`;
  // The empty page's next step: start research, set a program up, or the person to ask.
  const emptyAction = !canResearch ? <p className="simple-empty-note">Ask {askAdmin} to start a research run.</p>
    : !program ? (canSetUp ? <button type="button" className="simple-primary" {...writeProps(viewer, busy)} onClick={() => onStartResearch(null)}>Set up research<ArrowRight size={15} aria-hidden="true" /></button> : <p className="simple-empty-note">Ask {askAdmin} to set up a research program.</p>)
    : blocked ? (onSettings ? <button type="button" className="simple-primary" onClick={onSettings}>Connect Apify in Settings<ArrowRight size={15} aria-hidden="true" /></button> : <p className="simple-empty-note">{setupHint}.</p>)
    : <button type="button" className="simple-primary" {...writeProps(viewer, busy)} onClick={() => onStartResearch(program)}><Radar size={15} aria-hidden="true" />Start research with “{program.name}”</button>;
  // A card waiting for an OK says why it matters (novelty, momentum, runs seen, and which of the person's channels it
  // fits), so its momentum badge lives there; every other card keeps the badge here and says who decided it.
  const meta = (card) => { const trend = trendOf(card); return <div className="simple-trend-meta">{card.priorityTier && <span className={`simple-tier tier-${card.priorityTier.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{readable(card.priorityTier.toLowerCase())}</span>}{trend?.momentum && card.stage !== 'potential' && <MomentumBadge momentum={trend.momentum} />}<span>{plural(card.evidenceCount, 'source')}</span>{card.platforms.length > 0 && <span>{card.platforms.map((platform) => ({ x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' }[platform] || platform)).join(' · ')}</span>}{mondayChip(card)}</div>; };
  // Monday.com (monday-ui.jsx): where the trend is on the team's board, compact. interactive false inside a button.
  function mondayChip(card, interactive = true) { return monday?.items?.[card.key] ? <MondayChip monday={monday} card={card} compact api={mondayApi} disabled={busy} interactive={interactive} /> : null; }
  const byOf = (card) => decisionOf(researchRuns, card);
  // "Fits Social": only for a trend routed to some channels (open to all, it fits everyone, so it says nothing).
  const fitsOf = (by) => (list(by?.channels).length ? fitsFor(by, focusChannels, channels) : []);
  const why = (card) => <WhyItMatters card={card} trend={trendOf(card)} fits={fitsOf(byOf(card))} api={postsApi} onAsk={onAsk} className="simple-why" />;
  const decided = (card) => <DecidedBy by={byOf(card)} decision={card.decision} channelName={(id) => channelLabel(channels, id)} className="simple-decided" />;
  const yes = (card, size) => <TrendYesButton card={card} channels={channels} className="simple-yes" size={size} spot="trends.yes" disabled={busy} onDecide={onDecide} onDecideWithNote={onDecideWithNote} />;
  return <div className={`simple-page${layout === 'board' ? ' simple-page-wide' : ''}`}>
    <div className="simple-page-head"><div><h1>Trends</h1><p>Research finds them. {canDecide ? 'You decide which ones become reports.' : 'Editors decide which ones become reports.'}</p></div>
      <div className="simple-head-actions"><div className="simple-segment simple-layout-switch" role="tablist" aria-label="Show trends as">{[['list', 'List', LayoutList], ['board', 'Board', SquareKanban]].map(([id, label, Icon]) => <button type="button" role="tab" key={id} data-spot={`trends.layout-${id}`} aria-selected={layout === id} onClick={() => chooseLayout(id)}><Icon size={15} aria-hidden="true" />{label}</button>)}</div>
        {canResearch && programs.length > 1 && <select className="simple-program-pick" aria-label="Research program" value={program?.id || ''} onChange={(event) => onProgram(event.target.value)}>{programs.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        <MondayStatusLine monday={monday} api={mondayApi} compact canSetup={Boolean(onSettings)} disabled={busy} />
        {canResearch && <button type="button" data-spot="trends.find" className="simple-primary" title={blocked ? setupHint : undefined} {...writeProps(viewer, busy || blocked)} onClick={() => onStartResearch(program)}><Radar size={15} aria-hidden="true" />Find new trends</button>}</div></div>

    {board.scouting.filter((scout) => ACTIVE.has(scout.status)).map((scout) => <div className="simple-scouting" key={scout.runId} role="status"><LoaderCircle className="spin" size={16} aria-hidden="true" /><span><strong>Looking for trends · {scout.title}</strong><small>{scout.stage === 'discovery' && scout.progress ? `Batch ${number(scout.progress.completed)} of ${number(scout.progress.total)}` : 'Collecting posts and conversations'}</small></span></div>)}
    {/* A run that stopped before finding trends says so here, in both layouts, instead of "all caught up". It stays until a
        newer run finds trends, so it's a status, not an alert read out on every visit. */}
    {stopped.map((scout) => <div className="simple-scouting attention" key={scout.runId} role="status"><TriangleAlert size={16} aria-hidden="true" /><span><strong>Research stopped · {scout.title}</strong><small>{scout.message || scout.error || 'It stopped before any trends were found.'}</small></span>{onRetry ? <button type="button" className="simple-skip" {...writeProps(viewer, busy)} onClick={() => onRetry(scout.runId)}>Try again</button> : <small className="simple-scouting-ask">Ask {askAdmin} to try it again.</small>}{onOpenClassic && <button type="button" className="simple-link" onClick={() => onOpenClassic('research', scout.runId ? { runId: scout.runId } : {})}>See why<ArrowRight size={14} aria-hidden="true" /></button>}</div>)}

    {layout === 'board' && !empty && <SimpleKanban board={board} approved={approved} busy={busy} canDecide={canDecide} canWrite={canWrite} viewer={viewer} meta={meta} why={why} decided={decided} yes={yes} onDecide={onDecide} onWriteReports={onWriteReports} onOpenReport={onOpenReport} onOpenClassic={onOpenClassic} />}
    {layout === 'list' && !empty && !waiting.length && !approved.length && !stopped.length && !board.scouting.some((scout) => ACTIVE.has(scout.status)) && <div className="simple-caught-up"><CircleCheck size={20} aria-hidden="true" /><span><strong>You’re all caught up</strong><small>Every trend has been decided. Find new ones whenever you like.</small></span></div>}
    {empty && <div className="simple-empty big"><TrendingUp size={30} aria-hidden="true" /><h2>No trends yet</h2><p>A research run reads the posts your program follows and brings every trend it finds here for a simple yes or skip. Nothing is written or spent on reports until you say yes.</p>{emptyAction}</div>}

    {layout === 'list' && waiting.length > 0 && <section className="simple-section" aria-labelledby="simple-waiting" data-spot="trends.waiting">
      <h2 id="simple-waiting">Needs your OK <span className="simple-pill">{waiting.length}</span></h2>
      <div className="simple-trend-grid">{waiting.map((card) => <article className="simple-trend" key={card.key} data-spot="trends.card" data-spot-item={card.name} style={{ viewTransitionName: `simple-${card.key.replace(/[^a-zA-Z0-9_-]/g, '-')}` }}>
        {meta(card)}
        <h3>{card.name}</h3>
        {card.description && <p>{card.description}</p>}
        {why(card)}
        {canDecide && <div className="simple-trend-actions">{yes(card, 16)}<button type="button" data-spot="trends.skip" data-spot-item={card.name} className="simple-skip" aria-label={`Skip ${card.name}`} {...writeProps(viewer, busy)} onClick={() => onDecide(card, 'passed')}>Skip</button></div>}
      </article>)}</div>
    </section>}

    {layout === 'list' && canDecide && approved.length > 0 && <ul className="simple-decided-list" aria-label="Approved trends" data-spot="trends.approved">{approved.map((card) => <li key={card.key} data-spot="trends.ready-card" data-spot-item={card.name}><span>{card.name}</span>{mondayChip(card)}<button type="button" className="simple-link" aria-label={`Undo the yes for ${card.name}`} {...writeProps(viewer, busy)} onClick={() => onDecide(card, 'pending')}><Undo2 size={14} aria-hidden="true" />Undo</button></li>)}</ul>}
    {layout === 'list' && approved.length > 0 && <div className="simple-ready-bar"><span><strong>{plural(approved.length, 'trend')} approved</strong>{!canDecide && <small>{approved.map((card) => card.name).slice(0, 3).join(' · ')}{approved.length > 3 ? ' …' : ''}</small>}{canDecide && <small>Take one back with Undo until the reports are written.</small>}</span>{canWrite && <button type="button" data-spot="trends.write" className="simple-primary" {...writeProps(viewer, busy)} onClick={onWriteReports}>Write reports<ArrowRight size={15} aria-hidden="true" /></button>}</div>}

    {/* Skipped trends stay reachable while their run still takes decisions, "in case you change your mind". */}
    {layout === 'list' && canDecide && skipped.length > 0 && <details className="simple-skipped" data-spot="trends.skipped"><summary>Skipped <span className="simple-pill">{skipped.length}</span></summary>
      <ul className="simple-decided-list">{skipped.map((card) => <li key={card.key} data-spot="trends.ready-card" data-spot-item={card.name}><span>{card.name}</span>{decided(card)}{mondayChip(card)}<button type="button" className="simple-link" aria-label={`Reconsider ${card.name}`} {...writeProps(viewer, busy)} onClick={() => onDecide(card, 'pending')}><RotateCcw size={14} aria-hidden="true" />Reconsider</button></li>)}</ul>
    </details>}

    {layout === 'list' && production.length > 0 && <section className="simple-section" aria-labelledby="simple-writing" data-spot="trends.writing">
      <h2 id="simple-writing">Being written</h2>
      <ul className="simple-live">{production.map((card) => <li key={card.key} className={card.needsAttention ? 'attention' : ''} data-spot="trends.ready-card" data-spot-item={card.name}>{card.needsAttention ? <X size={16} aria-hidden="true" /> : <LoaderCircle className="spin" size={16} aria-hidden="true" />}<span><strong>{card.name}</strong><small>{card.activity || 'Writing'}</small></span>{card.needsAttention && onOpenClassic && <button type="button" className="simple-link" onClick={() => onOpenClassic('research', card.runId ? { runId: card.runId } : {})}>See why<ArrowRight size={14} aria-hidden="true" /></button>}</li>)}</ul>
    </section>}

    {layout === 'list' && ready.length > 0 && <section className="simple-section" aria-labelledby="simple-done" data-spot="trends.ready">
      <h2 id="simple-done">Ready</h2>
      <div className="simple-report-cards">{ready.map((card) => { const report = card.reportAssets?.find((asset) => asset.deliverableId === 'evidence-report') || card.reportAssets?.[0]; const trend = trendOf(card); return <button type="button" key={card.key} data-spot="trends.ready-card" data-spot-item={card.name} disabled={!report} onClick={() => report && onOpenReport(report.id)}><span className="simple-doc-icon done"><Check size={18} aria-hidden="true" /></span><strong>{card.name}</strong><small>{[MOMENTUM_COPY[trend?.momentum]?.label, card.reportAssets?.length === 2 ? 'Trends report + editorial toolkit' : plural(card.reportAssets?.length || 0, 'report')].filter(Boolean).join(' · ')}</small>{mondayChip(card, false)}<span className="simple-read">Read<ArrowRight size={14} aria-hidden="true" /></span></button>; })}</div>
    </section>}
  </div>;
}

// The same trends as a board: one column per stage, left to right, with each stage's next step on its cards. An
// empty column says what comes next.
function SimpleKanban({ board, approved, busy, canDecide, canWrite, viewer, meta, why, decided, yes, onDecide, onWriteReports, onOpenReport, onOpenClassic }) {
  const columns = [...TREND_STAGES, PASSED_STAGE];
  const reportOf = (card) => card.reportAssets?.find((asset) => asset.deliverableId === 'evidence-report') || card.reportAssets?.[0];
  return <div className="simple-kanban" data-spot="trends.kanban" role="list" aria-label="Trend board">
    {columns.map((stage) => { const cards = board.columns[stage.id] || []; return <section key={stage.id} role="listitem" className={`simple-kanban-col stage-${stage.id}`} aria-labelledby={`kanban-${stage.id}`}>
      <header><h2 id={`kanban-${stage.id}`}>{stage.label}<span className="simple-kanban-count">{cards.length}</span></h2><p>{stage.hint}</p>
        {stage.id === 'approved' && canWrite && approved.length > 0 && <button type="button" data-spot="trends.write" className="simple-primary simple-kanban-action" {...writeProps(viewer, busy)} onClick={onWriteReports}>Write reports<ArrowRight size={14} aria-hidden="true" /></button>}</header>
      <div className="simple-kanban-cards">
        {!cards.length && <p className="simple-kanban-empty">{stage.empty || 'Nothing here yet.'}</p>}
        {cards.map((card) => { const report = stage.id === 'ready' ? reportOf(card) : null; return <article key={card.key} className={`simple-kanban-card${card.needsAttention ? ' attention' : ''}`} data-spot="trends.card" data-spot-item={card.name} style={{ viewTransitionName: `kanban-${card.key.replace(/[^a-zA-Z0-9_-]/g, '-')}` }}>
          {meta(card)}
          <h3>{card.name}</h3>
          {card.description && stage.id !== 'passed' && <p>{card.description}</p>}
          {stage.id === 'potential' ? why(card) : decided(card)}
          {stage.id === 'potential' && canDecide && card.canDecide && <div className="simple-kanban-buttons">{yes(card, 14)}<button type="button" data-spot="trends.skip" data-spot-item={card.name} className="simple-skip" aria-label={`Skip ${card.name}`} {...writeProps(viewer, busy)} onClick={() => onDecide(card, 'passed')}>Skip</button></div>}
          {(stage.id === 'approved' || stage.id === 'passed') && canDecide && card.canDecide && <div className="simple-kanban-buttons"><button type="button" className="simple-skip" aria-label={`${stage.id === 'passed' ? 'Reconsider' : 'Undo the yes for'} ${card.name}`} {...writeProps(viewer, busy)} onClick={() => onDecide(card, 'pending')}>{stage.id === 'passed' ? <RotateCcw size={13} aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}{stage.id === 'passed' ? 'Reconsider' : 'Undo'}</button></div>}
          {stage.id === 'production' && <div className="simple-kanban-status">{card.needsAttention ? <X size={14} aria-hidden="true" /> : <LoaderCircle className="spin" size={14} aria-hidden="true" />}<span>{card.activity || 'Writing'}</span>{card.needsAttention && onOpenClassic && <button type="button" className="simple-link" onClick={() => onOpenClassic('research', card.runId ? { runId: card.runId } : {})}>See why</button>}</div>}
          {stage.id === 'ready' && <button type="button" className="simple-kanban-read" disabled={!report} onClick={() => report && onOpenReport(report.id)}>{plural(card.reportAssets?.length || 0, 'report')}<span>Read<ArrowRight size={13} aria-hidden="true" /></span></button>}
        </article>; })}
      </div>
    </section>; })}
  </div>;
}
