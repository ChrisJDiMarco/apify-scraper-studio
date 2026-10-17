import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, BookOpen, CalendarClock, Check, ChevronDown, ChevronRight, Download, FileText, Folder, FolderOpen, Image as ImageIcon, Layers3, Link2, LoaderCircle, Megaphone, PenLine, Plus, Radar, RefreshCw, Search, Settings2, Sheet, Sparkles, Square, Upload, Users, X, Zap } from 'lucide-react';
import { Button, Badge, formatDate, friendlyMessage, modelLabel, number } from './ui.jsx';
import { LIBRARY_TYPES, TYPE_LABEL, buildLibraryTree, filterLibrary, folderSummary, isQuickScan, libraryChannels, pathTo } from '../../shared/library-tree.js';
import { MarkdownContent, safeMarkdownUrl } from './markdown-content.jsx';
import { adminNames, can as canCall, hasCapability, useViewer } from './viewer.js';
import { TrendBoardView } from './trend-board-view.jsx';
import { WeeklyBriefing } from './weekly-briefing.jsx';
import { newerPromptsFor, newestPromptsLine } from './studio-actions.js';
import { AssetStatusMenu, statusLabel, statusOf } from './asset-editor.jsx';
import { HowItWasMade } from './simple-reports.jsx';
import { LINK_COPIED, linkFor } from './deep-links.js';
import { copyText } from './role-screens.jsx';
import { ResearchKnowledge } from './research-knowledge.jsx';
import { SetupShare } from './setup-share.jsx';
import { ProgramWindowFields, ProgramAiFields, ProgramAutomationFields, ProgramEstimate, ProgramCollectionFields, ThemeScore, DEFAULT_PROGRAM_AI, DEFAULT_COLLECTION } from './research-program-fields.jsx';
import './content-studio.css';
import semrushWordmark from './assets/semrush-2026-logo.svg';

const VIEWS = [['overview', 'Overview'], ['research', 'Research programs'], ['board', 'Trend board'], ['create', 'Create content'], ['library', 'Library'], ['knowledge', 'Brand knowledge']];
const STEPS = ['Source brief', 'Choose deliverables', 'Review & generate'];
const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
const text = (value) => typeof value === 'string' ? value : '';
const list = (value) => Array.isArray(value) ? value : [];
const money = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '—';
const split = (value) => [...new Set(String(value || '').split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean))];
const assetsForRun = (assets, run) => { const ids = new Set([run.id, ...list(run.reportRunIds).map((entry) => typeof entry === 'string' ? entry : entry.runId)]); return assets.filter((asset) => ids.has(asset.runId)); };
const plural = (count, word, many = `${word}s`) => `${number(count)} ${count === 1 ? word : many}`;
const readable = (value) => String(value || 'draft').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
const SOURCE_TYPES = [
  { sourceId: 'reddit', platform: 'reddit', name: 'Reddit communities', label: 'Subreddits', placeholder: 'r/marketing\nr/SaaS' },
  { sourceId: 'x', platform: 'x', name: 'X accounts', label: 'X accounts', placeholder: '@apify\nhttps://x.com/account' },
  { sourceId: 'linkedin-profile', platform: 'linkedin', name: 'LinkedIn accounts', label: 'LinkedIn profile or company URLs', placeholder: 'https://www.linkedin.com/company/company-name' },
  { sourceId: 'linkedin-search', platform: 'linkedin', name: 'LinkedIn keyword search', label: 'Search topic', placeholder: '' },
];
const KNOWLEDGE_FIELDS = [['audience', 'Audience', 'Who are you helping?'], ['positioning', 'Positioning', 'What makes your brand useful and different?'], ['icp', 'Ideal customer profile', 'Company sizes, roles, industries, and buying situations.'], ['voice', 'Brand voice', 'Tone, language, and examples writers should follow.'], ['editorialRules', 'Editorial rules', 'Sourcing, structure, style, and publishing standards.'], ['forbiddenClaims', 'Claims to avoid', 'Promises or product claims that must never be made.'], ['productContext', 'Product context', 'How products fit the audience and the problems you solve.']];
const emptyWorkspace = () => ({ name: '', editionId: 'general', knowledge: Object.fromEntries(KNOWLEDGE_FIELDS.map(([key]) => [key, ''])), products: [] });
const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const emptySchedule = () => ({ frequency: 'manual', enabled: false, time: '09:00', timeZone: localTimeZone(), weekday: 1, dayOfMonth: 1, lookbackDays: 7 });
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const timeZones = () => [...new Set([localTimeZone(), 'UTC', ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'])])];
const programWindowLabel = (program) => program.schedule?.frequency && program.schedule.frequency !== 'manual' ? `Previous ${program.schedule.lookbackDays} complete UTC days` : program.window?.startDate ? `${program.window.startDate} → ${program.window.endDate || 'Present'}` : `Last ${program.lookbackDays || 7} days`;
const scheduleSummary = (schedule) => schedule.frequency === 'manual' ? 'Only when you start it' : `${schedule.frequency === 'weekly' ? `Every ${WEEKDAYS[schedule.weekday]}` : schedule.frequency === 'monthly' ? `Monthly on day ${schedule.dayOfMonth}` : 'Every day'} at ${schedule.time} · ${schedule.timeZone}`;
function scheduledDate(value, timeZone) { if (!value) return ''; try { return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value)); } catch { return ''; } }
const emptyProgram = (workspaceId) => ({ name: '', workspaceId, schedule: emptySchedule(), query: '', sourceGroups: SOURCE_TYPES.map((source) => ({ id: `source-${source.sourceId}`, sourceId: source.sourceId, platform: source.platform, name: source.name, targets: [], enabled: false, options: {} })), window: { startDate: '', endDate: '' }, lookbackDays: 7, targetPerPlatform: 3000, maxEvidenceItems: 10000, perAuthorCap: 10, budgets: { collectionUsd: 10, aiUsd: 25 }, thresholds: { discovery: { x: 40, linkedin: 25, reddit: 15 }, tagging: { x: 20, linkedin: 1, reddit: 1 } }, discoveryBatchSize: 200, taggingBatchSize: 40, taggingBatchSizes: { x: 50, linkedin: 40, reddit: 50 }, maxThemes: 6, includeUndated: false, topicFiltersTargets: false, autoApproveThemes: false, ai: clone(DEFAULT_PROGRAM_AI), collection: { ...DEFAULT_COLLECTION }, delivery: { publishToDrive: false } });
const clone = (value) => JSON.parse(JSON.stringify(value));
const statusClass = (status) => ['succeeded', 'approved'].includes(status) ? 'success' : ['failed', 'partial', 'cancelled'].includes(status) ? 'attention' : ['queued', 'running', 'awaiting-review'].includes(status) ? 'active' : '';
function Status({ value }) { return <span className={`cs-status ${statusClass(value)}`}>{readable(value)}</span>; }
function Field({ label, id, hint, children, className = '' }) { return <div className={`cs-field ${className}`}><label htmlFor={id}>{label}</label>{children}{hint && <small>{hint}</small>}</div>; }
function EmptyState({ icon: Icon = FolderOpen, title, detail, action, onAction }) { return <div className="cs-empty"><span><Icon size={24} aria-hidden="true" /></span><h3>{title}</h3><p>{detail}</p>{action && <Button type="button" onClick={onAction}>{action}<ArrowRight size={14} aria-hidden="true" /></Button>}</div>; }
function SectionHeading({ eyebrow, title, detail, action, page = false }) { const Heading = page ? 'h1' : 'h2'; return <div className={`cs-section-heading ${page ? 'cs-page-heading' : ''}`}><div>{eyebrow && <span className="cs-eyebrow">{eyebrow}</span>}<Heading id={page ? 'content-studio-title' : undefined}>{title}</Heading>{detail && <p>{detail}</p>}</div>{action}</div>; }
function assetMarkdown(payload = {}) {
  if (typeof payload.markdown === 'string') return payload.markdown;
  const output = payload.output;
  if (!output || typeof output !== 'object') return '';
  return [`# ${text(output.title)}`, text(output.summary), ...list(output.sections).map((section) => `## ${text(section.heading)}\n\n${text(section.body)}\n\n${list(section.items).map((item) => `- ${item.label ? `**${item.label}** — ` : ''}${text(item.text)}`).join('\n')}`), list(output.caveats).length ? `## Limitations\n\n${output.caveats.map((entry) => `- ${text(entry)}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
}
function safeImage(value) { return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value) ? value : ''; }
function SourcePill({ children }) { return <span className="cs-source-pill">{children}</span>; }
// A quick scan in one line: its topic, its hour-level window and the platforms it read.
const PLATFORM_NAMES = { x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' };
function quickScanLine(run) {
  const scan = run.quickScan || {}; const hours = Number(scan.lookbackHours);
  return [text(scan.topic) || text(run.title).replace(/^Quick scan · /, ''), Number.isFinite(hours) && hours > 0 ? `last ${plural(hours, 'hour')}` : run.window?.startDate ? `${run.window.startDate} → ${run.window.endDate || 'now'}` : '', list(scan.platforms).map((platform) => PLATFORM_NAMES[platform] || platform).join(', ')].filter(Boolean).join(' · ');
}

// `onAsk(text, context)` opens Ask AI (the Advanced drawer); `linkOrigin` is the address share links use (deep-links.js
// shareOrigin), and Copy link shows only with one; `onOpenPrompt(promptId)` opens a prompt on the Prompts page.
export function ContentStudioView({ state = {}, api = {}, busy = false, onNotice, onNavigate, initialView = 'overview', initialSource, activeView, onViewChange, shellNavigation = false, workspaceControlsInShell = false, createWorkspaceKey = 0, onWorkspaceCreationHandled, knowledgeTab = 'workspace', onKnowledgeTabChange, renderResearchProfiles, renderLegacyLibrary, libraryRequest = null, programRequest = null, onAsk, linkOrigin = '', onOpenPrompt }) {
  const studio = state.contentStudio || {};
  const workspaces = list(studio.workspaces);
  const workspace = workspaces.find((item) => item.id === studio.activeWorkspaceId) || null;
  const workspaceId = workspace?.id || '';
  const semrush = workspace?.editionId === 'semrush';
  // Pages and buttons follow the person's role: an editor has no Brand knowledge, workspace switching or program setup.
  const viewer = useViewer();
  const can = (method) => canCall(viewer, method);
  const hidden = new Set(Array.isArray(viewer.hiddenPages) ? viewer.hiddenPages : []);
  const views = VIEWS.filter(([id]) => !hidden.has(id));
  const askAdmin = adminNames(state, 'an admin');
  const openSettings = can('saveSettings') && !hidden.has('settings') && onNavigate ? () => onNavigate('settings') : undefined;
  // Run controls follow the role too (in an admin's preview, the previewed role's), so no button offers a call the
  // server refuses. Write reports needs Approve trends and Start research (approve, then continue the run).
  const seeCosts = hasCapability(viewer, 'seeCosts');
  const runGates = { seeCosts, canStart: can('startResearchRun'), canApprove: can('approveResearchThemes') && can('continueResearchRun'), canCancel: can('cancelStudioRun'), canRetry: can('retryStudioRun'), canExport: can('exportStudioRun'), canPublish: can('publishStudioRun') };
  const canCreate = can('createContentRun') && !hidden.has('create');
  const [localView, setLocalView] = useState(views.some(([id]) => id === initialView) ? initialView : 'overview');
  const view = views.some(([id]) => id === activeView) ? activeView : views.some(([id]) => id === localView) ? localView : 'overview';
  function setView(next) { setLocalView(next); onViewChange?.(next); }
  const [catalog, setCatalog] = useState({ editions: [], deliverables: [] });
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  // A run that was just opened, started or picked scrolls into view once; returning to the page later doesn't jump.
  const [focusRunId, setFocusRunId] = useState('');
  function selectRun(id) { setSelectedRunId(id || ''); setFocusRunId(id || ''); }
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [sourceDraft, setSourceDraft] = useState(null);
  const [newWorkspace, setNewWorkspace] = useState(false);
  const pendingRef = useRef(false);
  const liveWorkspace = useRef(workspaceId);
  liveWorkspace.current = workspaceId;
  const runs = [...list(studio.researchRuns).map((run) => ({ ...run, runKind: 'research' })), ...list(studio.contentRuns).map((run) => ({ ...run, runKind: 'content' }))].filter((run) => run.workspaceId === workspaceId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const programs = list(studio.programs).filter((program) => program.workspaceId === workspaceId);
  const assets = list(studio.assets).filter((asset) => asset.workspaceId === workspaceId);
  // What the Library files into folders, rebuilt only when the studio state changes (not on every keystroke).
  const libraryInputs = useMemo(() => {
    const own = (row) => row && row.workspaceId === workspaceId;
    return {
      researchRuns: list(studio.researchRuns).filter(own), contentRuns: list(studio.contentRuns).filter(own), assets: list(studio.assets).filter(own), themes: list(studio.themes).filter((row) => !row?.workspaceId || row.workspaceId === workspaceId),
      programs: list(studio.programs).filter(own), adoptionsByTheme: studio.adoptionsByTheme || {},
      // The earlier content board's items (top-level state, not the studio's) stay reachable as one collapsed folder.
      legacyAssets: renderLegacyLibrary ? [...list(state.assets), ...list(state.cards).filter((card) => card?.id && !String(card.id).startsWith('dataset-'))] : [],
    };
  }, [studio.researchRuns, studio.contentRuns, studio.assets, studio.themes, studio.programs, studio.adoptionsByTheme, state.assets, state.cards, workspaceId, Boolean(renderLegacyLibrary)]); // eslint-disable-line react-hooks/exhaustive-deps
  // These inputs are scoped by the service. Never fall back to global collections/reports.
  const datasets = list(studio.availableDatasets).filter((item) => !item.workspaceId || item.workspaceId === workspaceId);
  const reports = list(studio.availableReports).filter((item) => !item.workspaceId || item.workspaceId === workspaceId);
  const selectedRun = runs.find((run) => run.id === selectedRunId);
  const disabled = Boolean(busy || pending);
  const capabilities = studio.capabilities || {};

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true); setCatalogError('');
    Promise.resolve().then(() => { if (typeof api.contentCatalog !== 'function') throw new Error('The content catalog is unavailable. Reopen the updated app.'); return api.contentCatalog(); }).then((value) => {
      if (!cancelled) { setCatalog({ editions: list(value?.editions), deliverables: list(value?.deliverables) }); setCatalogLoading(false); }
    }).catch((failure) => { if (!cancelled) { setCatalogError(failure?.message || 'Could not load available deliverables.'); setCatalogLoading(false); } });
    return () => { cancelled = true; };
  }, [api.contentCatalog]);
  useEffect(() => { setSelectedRunId(''); setSelectedAssetId(''); setSourceDraft(null); setError(''); setNewWorkspace(false); }, [workspaceId]);
  // The shell's request to show one report ({ key, assetId }) or channel-asset folder ({ key, folderKey }) in the Library
  // (Ask AI's Open buttons, the ⌘K palette). After the reset above, so it survives this view mounting.
  const [folderRequest, setFolderRequest] = useState(null);
  useEffect(() => { if (!libraryRequest?.key) return; if (libraryRequest.assetId) setSelectedAssetId(libraryRequest.assetId); if (libraryRequest.folderKey) setFolderRequest(libraryRequest); }, [libraryRequest?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (createWorkspaceKey) { setNewWorkspace(true); setView('knowledge'); onWorkspaceCreationHandled?.(); } }, [createWorkspaceKey]);
  useEffect(() => { if (initialSource?.text) { setSourceDraft({ workspaceId, value: { ...initialSource } }); setView('create'); } }, [initialSource]);
  async function action(label, fn, notice) {
    if (pendingRef.current) return null;
    pendingRef.current = true; setPending(label); setError('');
    try { const result = await fn(); if (notice) onNotice?.(notice); return result; }
    catch (failure) { setError(failure?.message || 'The action could not be completed. Please try again.'); return null; }
    finally { pendingRef.current = false; setPending(''); }
  }
  function navigate(next) { setView(next); setError(''); }
  // Where a briefing card, share link or Inbox row leads in this layout.
  function openTarget(target = {}) {
    const page = { trends: 'board', reports: 'library', assets: 'library', research: 'research', create: 'create' }[target.page] || '';
    if (target.kind === 'report' && target.id) { setSelectedAssetId(target.id); navigate('library'); }
    else if (target.kind === 'folder' && target.id) { setFolderRequest({ key: Date.now(), folderKey: target.id }); navigate('library'); }
    else if (target.kind === 'run' && target.id) { const run = runs.find((row) => row.id === target.id); selectRun(target.id); navigate(run?.runKind === 'content' ? 'create' : 'research'); }
    else if (target.kind === 'trend') navigate('board');
    else if (target.kind === 'prompt' && target.id) onOpenPrompt?.(target.id);
    else if (page) navigate(page);
    else if (target.page) onNavigate?.(target.page);
  }
  async function useReport(report) {
    const requestedWorkspace = workspaceId;
    const result = await action('Loading source', async () => {
      if (typeof report.text === 'string' && report.text.trim()) return { kind: 'report', id: report.id, title: report.title || report.name || 'Research report', text: report.text, evidence: list(report.evidence) };
      if (!report.assetId) throw new Error('This report has no readable source yet. Open a completed report or import its text.');
      const payload = await api.readStudioAsset({ assetId: report.assetId });
      const body = assetMarkdown(payload);
      if (!body.trim()) throw new Error('This report does not contain readable text.');
      return { kind: 'report', id: report.id || report.assetId, title: payload.asset?.title || report.title || 'Research report', text: body, evidence: list(payload.evidence || payload.output?.evidence) };
    });
    if (result && requestedWorkspace === liveWorkspace.current) { setSourceDraft({ workspaceId, value: result }); navigate('create'); }
  }
  async function fromAsset(asset) {
    if (asset.kind === 'image') { setSelectedAssetId(asset.id); navigate('library'); return; }
    await useReport({ ...asset, assetId: asset.id });
  }
  // What a research run will cost, from the studio's own estimate of the saved program: the estimate first, then the cap.
  async function researchCost(program, datasetIds) {
    const caps = program.budgets || {}; const reuse = list(datasetIds).length > 0;
    const codex = capabilities.aiProvider === 'codex';
    try {
      const estimate = await api.estimateResearchProgram({ ...program, sourceGroups: list(program.sourceGroups).map((group) => ({ ...group, targets: list(group.targets) })) });
      const ai = Number(estimate?.ai?.totalUsd); const apify = Number(estimate?.collection?.worstCaseUsd);
      const aiPart = codex ? 'AI on your Codex plan (Codex doesn’t report costs, so the AI cap doesn’t apply)' : Number.isFinite(ai) ? `about ${money(ai)} AI (cap ${money(caps.aiUsd)})` : `up to ${money(caps.aiUsd)} AI`;
      const apifyPart = reuse ? 'nothing on Apify (it reads the saved collections)' : Number.isFinite(apify) && estimate?.collection && !estimate.collection.error ? `up to ${money(apify)} on Apify (cap ${money(caps.collectionUsd)})` : `up to ${money(caps.collectionUsd)} on Apify`;
      return `This run costs ${aiPart}, ${apifyPart}.`;
    } catch (failure) {
      return `The estimate isn’t available right now (${friendlyMessage(failure) || 'try again'}). The run can spend up to ${money(caps.aiUsd)} on AI and ${reuse ? 'nothing' : money(caps.collectionUsd)} on Apify.`;
    }
  }
  async function startResearch(program, datasetIds) {
    // The server refuses a second search while any run of this program is still going (or waiting for review), so say
    // who started the newest one and ask before sending again: true, as Simple's Find new trends does. Quick scans
    // don't count; the server keeps them apart from the program's own runs.
    const pending = runs.find((run) => run.runKind === 'research' && !isQuickScan(run) && run.programId === program.id && ['queued', 'running', 'awaiting-review'].includes(run.status));
    const again = Boolean(pending);
    const againLine = again ? `${pending.createdBy?.name || 'Someone'} started a search with this program at ${pending.createdAt ? formatDate(pending.createdAt) : 'an earlier time'}. ${pending.status === 'awaiting-review' ? 'Its trends are waiting for review.' : 'It’s still running.'} Start another?` : '';
    // Paid work shows its estimate before it starts. A host without the estimate method keeps the earlier question.
    if (typeof api.estimateResearchProgram === 'function') {
      if (pendingRef.current) return;
      pendingRef.current = true; setPending('Checking the cost'); setError('');
      let cost = '';
      try { cost = await researchCost(program, datasetIds); } finally { pendingRef.current = false; setPending(''); }
      if (!window.confirm([againLine || `Start research with “${program.name}”?`, cost].join('\n\n'))) return;
    } else if (again && !window.confirm(againLine)) return;
    const result = await action('Starting research', () => api.startResearchRun({ programId: program.id, datasetIds, ...(again ? { again: true } : {}) }));
    const run = result?.run || result;
    if (run?.id) selectRun(run.id);
  }

  return <section className={`content-studio ${shellNavigation ? 'cs-shell-integrated' : ''}`} data-view={view} data-edition={workspace?.editionId || 'general'} aria-labelledby="content-studio-title">
    {!shellNavigation && !workspaceControlsInShell && can('selectContentWorkspace') && <div className="cs-workspace-bar"><div>{workspace?.editionId === 'semrush' ? <img src={semrushWordmark} alt="Semrush" className="cs-workspace-wordmark" /> : <><span className="cs-edition-mark"><Layers3 size={15} aria-hidden="true" /></span><span>RESEARCH & CONTENT STUDIO</span></>}</div><label className="cs-workspace-picker"><span className="sr-only">Content workspace</span><select aria-label="Content workspace" value={workspaceId} disabled={disabled || !workspaces.length} onChange={(event) => action('Switching workspace', () => api.selectContentWorkspace(event.target.value))}>{!workspaces.length && <option value="">Create a workspace</option>}{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{can('saveContentWorkspace') && !hidden.has('knowledge') && <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => { setNewWorkspace(true); navigate('knowledge'); }}><Plus size={14} aria-hidden="true" />New workspace</Button>}</div>}
    {/* Overview is the weekly briefing, the same Home as Simple's; every other page leads with its own title. */}
    {!shellNavigation && <nav className="cs-view-nav" aria-label="Content studio"><div>{views.map(([id, label]) => <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}</div></nav>}
    {error && <div className="cs-alert" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}
    {catalogError && <div className="cs-alert" role="alert">{catalogError}</div>}
    {pending && <p className="cs-action-status" role="status"><LoaderCircle className="spin" size={14} aria-hidden="true" />{pending}…</p>}
    {!semrush && shellNavigation && view === 'create' && <div className="cs-entry-grid"><button className="cs-entry-card cs-entry-research" type="button" onClick={() => navigate('research')}><span className="cs-feature-icon"><Search size={27} aria-hidden="true" /></span><div><h2>Research your market</h2><p>Follow accounts and communities, review the themes, and build an evidence-backed point of view.</p><small>{programs.length ? `${number(programs.length)} saved ${programs.length === 1 ? 'program' : 'programs'}` : 'Start with the sources you trust'}</small></div><ChevronRight size={20} aria-hidden="true" /></button><button className="cs-entry-card cs-entry-content" type="button" onClick={() => navigate('create')}><span className="cs-feature-icon"><FileText size={27} aria-hidden="true" /></span><div><h2>Create from a trend</h2><p>Bring a report or a source brief. Create the written assets and visuals your channels need.</p><small>Source → Deliverables → Review</small></div><ChevronRight size={20} aria-hidden="true" /></button></div>}
    {view === 'overview' && <WeeklyBriefing state={state} viewer={viewer} api={api} layout="classic" busy={disabled} onAsk={onAsk} onOpenTarget={openTarget} onOpenTracker={can('readWorkbook') && onNavigate ? () => onNavigate('sheets', { workbookId: 'trend-tracker' }) : undefined} onStartResearch={(program) => (program ? startResearch(program, []) : navigate('research'))} />}
    {view === 'research' && <ResearchPrograms key={workspaceId} workspace={workspace} capabilities={capabilities} gates={runGates} showCosts={runs.some((run) => Number.isFinite(Number(run.costUsd)))} canEdit={can('saveResearchProgram')} canImport={can('applySetup')} askAdmin={askAdmin} onNotice={onNotice} programs={programs} datasets={datasets} runs={runs.filter((run) => run.runKind === 'research')} selectedRun={selectedRun?.runKind === 'research' ? selectedRun : null} assets={assets} disabled={disabled} api={api} action={action} onStart={startResearch} onSelectRun={selectRun} focusRunId={focusRunId} onRunFocused={() => setFocusRunId('')} onUseAsset={canCreate ? fromAsset : undefined} onCollect={() => onNavigate?.('search')} onOpenSheets={(runId) => onNavigate?.('sheets', { workbookId: runId })} programRequest={programRequest} promptChanges={list(studio.promptChanges)} />}
    {view === 'create' && <CreateContent key={workspaceId} promptChanges={list(studio.promptChanges)} workspace={workspace} catalog={catalog} catalogLoading={catalogLoading} capabilities={capabilities} sourceDraft={sourceDraft?.workspaceId === workspaceId ? sourceDraft.value : null} reports={reports} runs={runs.filter((run) => run.runKind === 'content')} selectedRun={selectedRun?.runKind === 'content' ? selectedRun : null} assets={assets} api={api} action={action} disabled={disabled} onUseReport={useReport} onCreated={(run) => selectRun(run?.id)} onSelectRun={selectRun} focusRunId={focusRunId} onRunFocused={() => setFocusRunId('')} onViewAsset={(asset) => { setSelectedAssetId(asset.id); navigate('library'); }} onSettings={openSettings} askAdmin={askAdmin} />}
    {view === 'board' && <TrendBoardView key={workspaceId} studio={studio} monday={state.monday} api={api} action={action} disabled={disabled} pageHeading onAsk={onAsk && can('askHelp') ? (text) => onAsk(text) : undefined} onFindTrends={() => navigate('research')} onOpenRun={(runId) => { selectRun(runId); navigate('research'); }} onOpenSheets={(runId) => onNavigate?.('sheets', { workbookId: runId })} onReadReport={(report) => { setSelectedAssetId(report.id); navigate('library'); }} onCreateAssets={(report) => useReport({ ...report, assetId: report.id })} onSettings={openSettings} />}
    {view === 'library' && <StudioLibrary key={workspaceId} workspace={workspace} inputs={libraryInputs} studio={studio} selectedId={selectedAssetId} onSelect={setSelectedAssetId} api={api} action={action} disabled={disabled} onCreate={canCreate ? () => navigate('create') : undefined} onUseAsset={canCreate ? fromAsset : undefined} onNotice={onNotice} onOpenTrends={() => navigate('board')} renderLegacy={renderLegacyLibrary} folderRequest={folderRequest} linkOrigin={linkOrigin} onOpenPrompt={onOpenPrompt} />}
    {view === 'knowledge' && renderResearchProfiles && !newWorkspace && <div className="cs-subtabs" role="tablist" aria-label="Brand knowledge sections"><button type="button" role="tab" aria-selected={knowledgeTab !== 'profiles'} className={knowledgeTab !== 'profiles' ? 'active' : ''} onClick={() => onKnowledgeTabChange?.('workspace')}>Workspace knowledge</button><button type="button" role="tab" aria-selected={knowledgeTab === 'profiles'} className={knowledgeTab === 'profiles' ? 'active' : ''} onClick={() => onKnowledgeTabChange?.('profiles')}>Research brand profiles</button></div>}
    {view === 'knowledge' && (knowledgeTab !== 'profiles' || !renderResearchProfiles || newWorkspace) && <BrandKnowledge key={`${workspaceId}:${newWorkspace ? 'new' : 'edit'}`} workspace={newWorkspace ? null : workspace} pageHeading grouped={semrush} editions={catalog.editions} api={api} action={action} disabled={disabled} onSaved={() => setNewWorkspace(false)} />}
    {view === 'knowledge' && knowledgeTab === 'profiles' && renderResearchProfiles && !newWorkspace && renderResearchProfiles()}
  </section>;
}

function ProgramSourceOptions({ sourceId, options = {}, keywordSearch = false, onChange }) {
  const set = (key, value) => onChange({ ...options, [key]: value });
  const checkbox = (key, label, fallback = false) => <label className="cs-check"><input id={`cs-source-${sourceId}-${key}`} type="checkbox" checked={options[key] ?? fallback} onChange={(event) => set(key, event.target.checked)} /><span>{label}</span></label>;
  const count = (key, label) => <Field id={`cs-source-${sourceId}-${key}`} label={label}><input id={`cs-source-${sourceId}-${key}`} type="number" min="1" max="100" step="1" value={options[key] ?? 5} onChange={(event) => set(key, Number(event.target.value))} /></Field>;
  const select = (key, label, values, fallback) => <Field id={`cs-source-${sourceId}-${key}`} label={label}><select id={`cs-source-${sourceId}-${key}`} value={options[key] ?? fallback} onChange={(event) => set(key, event.target.value)}>{values.map(([value, copy]) => <option key={value} value={value}>{copy}</option>)}</select></Field>;
  return <details className="cs-details cs-program-source-options" id={`cs-source-options-${sourceId}`}><summary><Settings2 size={13} />Collection options</summary><div>
    {sourceId === 'x' ? <><div className="cs-two-fields">{select('replies', 'Replies', [['all', 'Posts and replies'], ['exclude', 'Exclude replies'], ['only', 'Replies only']], 'all')}{select('sort', 'Sort order', [['Latest', 'Latest'], ['Top', 'Top'], ['Latest + Top', 'Latest and top']], 'Latest')}</div>{select('media', 'Media filter', [['all', 'Any content'], ['media', 'Any media'], ['images', 'Images'], ['videos', 'Videos'], ['links', 'Links']], 'all')}{checkbox('includeRetweets', 'Include native reposts', true)}<p>X replies are search results; full conversation threads are not expanded automatically.</p></> : <>
      {checkbox('includeComments', 'Include thread comments')}
      {options.includeComments && count('maxComments', 'Comments per post')}
      {sourceId === 'reddit' ? <>{keywordSearch && checkbox('searchComments', 'Search matching comments')}<p>{keywordSearch ? 'Searches the research focus inside these communities, newest first, back to the program’s start date.' : 'Reads each community’s newest posts back to the program’s start date, like the n8n workflow.'} Posts and comments share Reddit’s collection limit.</p></> : <>{checkbox('includeReactions', sourceId === 'linkedin-search' ? 'Include liked-user details' : 'Include reactions')}{options.includeReactions && count('maxReactions', sourceId === 'linkedin-search' ? 'Liked users per post' : 'Reactions per post')}{sourceId === 'linkedin-profile' ? <>{checkbox('includeQuotePosts', 'Include quote posts', true)}{checkbox('includeReposts', 'Include reposts')}<p>Comments and reactions add separate provider rows and can increase collection costs. The saved spending caps still apply.</p></> : <>{checkbox('fetchDocumentDetails', 'Include document details')}<p>Additional post details can increase collection time and cost.</p></>}</>}
    </>}
  </div></details>;
}

// `showCosts`: the state carries money for this role, so each program says what its last run cost.
function ResearchPrograms({ workspace, capabilities = {}, gates = {}, canEdit = true, canImport = true, askAdmin = 'an admin', onNotice, focusRunId, onRunFocused, programs, datasets, runs, selectedRun, assets, disabled, api, action, onStart, onSelectRun, onUseAsset, onCollect, onOpenSheets, showCosts = false, programRequest = null, promptChanges = [] }) {
  // A program's newest finished search (quick scans are separate), with its recorded cost, reports included.
  const lastRunLine = (program) => {
    const last = runs.filter((run) => run.programId === program.id && !isQuickScan(run) && !['queued', 'running'].includes(run.status)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    if (!last || !showCosts || !Number.isFinite(Number(last.costUsd))) return '';
    const codex = last.ai?.route === 'codex' || capabilities.aiProvider === 'codex';
    return codex ? 'Last run on Codex: AI spend isn’t reported on Codex' : `Last run: ${money(last.costUsd)}`;
  };
  const [editing, setEditing] = useState(!programs.length && canEdit);
  const [draft, setDraft] = useState(() => emptyProgram(workspace?.id));
  const [selectedProgramId, setSelectedProgramId] = useState(programs[0]?.id || '');
  const [datasetIds, setDatasetIds] = useState([]);
  const [inputMode, setInputMode] = useState('collect');
  const [formError, setFormError] = useState('');
  // New › Research program (the sidebar, ⌥⌘N, the palette): a blank program form, once per request.
  const handledProgramRequest = useRef(null);
  useEffect(() => {
    if (programRequest?.kind !== 'new' || !programRequest.key || handledProgramRequest.current === programRequest.key) return;
    handledProgramRequest.current = programRequest.key;
    if (!canEdit) { onNotice?.(`Only an admin can set up research programs. Ask ${askAdmin}.`); return; }
    if (!workspace?.id) { onNotice?.('Create a workspace in Brand knowledge first.'); return; }
    setDraft(emptyProgram(workspace.id)); setEditing(true); setFormError('');
  }, [programRequest?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedProgram = programs.find((program) => program.id === selectedProgramId) || programs[0];
  // Quick scans from Ask AI list with the program they were sized from (or with every program when that one is gone).
  const programRuns = runs.filter((run) => !selectedProgram || run.programId === selectedProgram.id || (isQuickScan(run) && !programs.some((program) => program.id === run.programId)));
  const activeRun = selectedRun || programRuns[0];
  const { canStart = true, seeCosts = true } = gates;
  function change(key, value) { setDraft((current) => ({ ...current, [key]: value })); setFormError(''); }
  function nested(key, field, value) { setDraft((current) => ({ ...current, [key]: { ...current[key], [field]: value } })); }
  function changeSource(id, key, value) { setDraft((current) => ({ ...current, sourceGroups: current.sourceGroups.map((group) => group.sourceId === id ? { ...group, [key]: value } : group) })); }
  function edit(program) {
    setDraft({ ...emptyProgram(workspace?.id), ...clone(program), schedule: { ...emptySchedule(), ...clone(program.schedule || {}) }, sourceGroups: SOURCE_TYPES.map((source) => clone(program.sourceGroups?.find((group) => group.sourceId === source.sourceId) || { id: `source-${source.sourceId}`, sourceId: source.sourceId, platform: source.platform, name: source.name, targets: [], enabled: false, options: {} })) }); setEditing(true); setFormError('');
  }
  async function save(event) {
    event.preventDefault(); setFormError('');
    if (!workspace?.id) { setFormError('Create a workspace in Brand knowledge first.'); return; }
    if (!draft.name.trim()) { setFormError('Name this research program.'); return; }
    if (draft.window.startDate && draft.window.endDate && draft.window.startDate > draft.window.endDate) { setFormError('Choose an end date on or after the start date.'); return; }
    const payload = { ...draft, workspaceId: workspace.id, sourceGroups: draft.sourceGroups.map((group) => ({ ...group, targets: Array.isArray(group.targets) ? group.targets : split(group.targets) })) };
    const result = await action('Saving research program', () => api.saveResearchProgram(payload), 'Research program saved.');
    const program = result?.program || result;
    if (program?.id) { setSelectedProgramId(program.id); setEditing(false); }
  }
  return <div className="cs-research"><SectionHeading page title="Research programs" detail="Repeatable listening, with a human decision between discovery and reporting." action={canEdit ? <Button type="button" disabled={disabled || !workspace} onClick={() => { setDraft(emptyProgram(workspace.id)); setEditing(true); }}><Plus size={15} />New program</Button> : null} />
    {!programs.length && canImport && <SetupShare api={api} mode="import" onImported={(done) => {
      // The banner unmounts once programs exist, so confirm here and show the imported program, not the blank form.
      if (done?.programIds?.[0]) setSelectedProgramId(done.programIds[0]);
      setEditing(false); setFormError('');
      onNotice?.(`Imported ${done?.fileName || 'the setup'}${done?.apifyTokenSaved ? ' and saved the Apify token' : ''}. Next: Settings → Writing & research → Check Claude, then start with a small run.`);
    }} />}
    {editing && canEdit ? <form className="cs-panel cs-program-editor" onSubmit={save}><div className="cs-panel-title"><div><h3>{draft.id ? 'Edit research program' : 'Build your listening brief'}</h3><p>Save the sources and boundaries once. Each run keeps a separate evidence snapshot.</p></div>{programs.length > 0 && <Button type="button" className="cs-quiet" onClick={() => setEditing(false)}>Close</Button>}</div><fieldset disabled={disabled}>
      <div className="cs-two-fields"><Field id="cs-program-name" label="Program name"><input id="cs-program-name" value={draft.name} maxLength={160} onChange={(event) => change('name', event.target.value)} placeholder="e.g. AI search market pulse" required /></Field><Field id="cs-program-query" label="Research focus (optional)" hint="Guides the AI’s discovery. Accounts and communities are collected in full, like the n8n workflow; LinkedIn keyword search uses it as the search term."><input id="cs-program-query" value={draft.query} maxLength={500} onChange={(event) => change('query', event.target.value)} placeholder="e.g. AI search visibility and measurement" /></Field></div>{draft.query.trim() && <label className="cs-check cs-topic-filter"><input type="checkbox" checked={Boolean(draft.topicFiltersTargets)} onChange={(event) => change('topicFiltersTargets', event.target.checked)} /><span><strong>Also filter account and community collection by this focus</strong><small>Narrows X searches and switches Reddit from newest posts to a keyword search. Leave off for n8n parity.</small></span></label>}
      <div className="cs-field-heading"><h4>Choose your sources</h4><p>Paste whole lists. Supported targets are normalized and deduplicated when saved.</p></div><div className="cs-source-groups">{SOURCE_TYPES.map((source) => { const group = draft.sourceGroups.find((item) => item.sourceId === source.sourceId); return <div className={`cs-source-group ${group.enabled ? 'selected' : ''}`} key={source.sourceId}><label className="cs-check"><input type="checkbox" checked={group.enabled} onChange={(event) => changeSource(source.sourceId, 'enabled', event.target.checked)} /><span><strong>{source.name}</strong><small>{group.enabled && source.sourceId !== 'linkedin-search' ? `${split(Array.isArray(group.targets) ? group.targets.join('\n') : group.targets).length} targets` : source.sourceId === 'linkedin-search' ? 'Uses the research topic' : 'Add a saved source list'}</small></span></label>{group.enabled && source.sourceId !== 'linkedin-search' && <Field id={`cs-targets-${source.sourceId}`} label={source.label}><textarea id={`cs-targets-${source.sourceId}`} rows={4} value={Array.isArray(group.targets) ? group.targets.join('\n') : group.targets} onChange={(event) => changeSource(source.sourceId, 'targets', event.target.value)} placeholder={source.placeholder} maxLength={100000} /></Field>}{group.enabled && <ProgramSourceOptions sourceId={source.sourceId} options={group.options} keywordSearch={Boolean(draft.topicFiltersTargets && draft.query.trim())} onChange={(value) => changeSource(source.sourceId, 'options', value)} />}</div>; })}</div>
      <div className="cs-form-divider" />
      <div className="cs-field-heading"><h4>When to run</h4><p>Run this program yourself, or collect fresh research on a repeating schedule.</p></div>
      <div className="cs-schedule-fields">
        <Field id="cs-schedule-frequency" label="Repeat"><select id="cs-schedule-frequency" value={draft.schedule.frequency} onChange={(event) => setDraft((current) => ({ ...current, schedule: { ...current.schedule, frequency: event.target.value, enabled: false, lookbackDays: ({ daily: 1, weekly: 7, monthly: 30 })[event.target.value] || current.schedule.lookbackDays } }))}><option value="manual">Only when I start it</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></Field>
        {draft.schedule.frequency !== 'manual' && <>
          {draft.schedule.frequency === 'weekly' && <Field id="cs-schedule-weekday" label="Day of the week"><select id="cs-schedule-weekday" value={draft.schedule.weekday} onChange={(event) => nested('schedule', 'weekday', Number(event.target.value))}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></Field>}
          {draft.schedule.frequency === 'monthly' && <Field id="cs-schedule-monthday" label="Day of the month" hint="Shorter months use their last day."><select id="cs-schedule-monthday" value={draft.schedule.dayOfMonth} onChange={(event) => nested('schedule', 'dayOfMonth', Number(event.target.value))}>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></Field>}
          <Field id="cs-schedule-time" label="Run time"><input id="cs-schedule-time" type="time" required value={draft.schedule.time} onChange={(event) => nested('schedule', 'time', event.target.value)} /></Field>
          <Field id="cs-schedule-zone" label="Time zone" hint="Run time follows daylight saving changes in this zone."><select id="cs-schedule-zone" value={draft.schedule.timeZone} onChange={(event) => nested('schedule', 'timeZone', event.target.value)}>{[...new Set([draft.schedule.timeZone, ...timeZones()])].map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</select></Field>
        </>}
      </div>
      <div className="cs-field-heading"><h4>What dates to search</h4><p>{draft.schedule.frequency === 'manual' ? 'Dates filter normalized evidence across every platform. Provider coverage can be narrower.' : 'Each run searches a fresh rolling window, including runs you start yourself. Provider coverage can be narrower.'}</p></div>
      {draft.schedule.frequency === 'manual' ? <ProgramWindowFields draft={draft} setDraft={setDraft} /> : <div className="cs-lookback-field"><Field id="cs-schedule-lookback" label="Look back (days)" hint="Searches the last complete UTC days before the run. Today is excluded."><input id="cs-schedule-lookback" type="number" min="1" max="365" step="1" required value={draft.schedule.lookbackDays} onChange={(event) => nested('schedule', 'lookbackDays', Number(event.target.value))} /></Field></div>}
      <div className="cs-field-heading"><h4>Spending limits per run</h4><p>These collection and AI limits apply separately to every run.</p></div>
      <div className="cs-two-fields"><Field id="cs-collection-budget" label="Collection budget (USD)"><input id="cs-collection-budget" type="number" min="0.01" max="1000" step="0.01" value={draft.budgets.collectionUsd} onChange={(event) => nested('budgets', 'collectionUsd', Number(event.target.value))} /></Field><Field id="cs-ai-budget" label="AI budget (USD)"><input id="cs-ai-budget" type="number" min="0.01" max="1000" step="0.01" value={draft.budgets.aiUsd} onChange={(event) => nested('budgets', 'aiUsd', Number(event.target.value))} /></Field></div>
      <ProgramEstimate draft={draft} api={api} />
      <ProgramAutomationFields draft={draft} setDraft={setDraft} capabilities={capabilities} />
      <ProgramAiFields draft={draft} setDraft={setDraft} />
      {draft.schedule.frequency !== 'manual' && <div className="cs-schedule-consent"><label className="cs-check"><input type="checkbox" checked={draft.schedule.enabled} onChange={(event) => nested('schedule', 'enabled', event.target.checked)} /><span><strong>Enable scheduled runs</strong><small>{scheduleSummary(draft.schedule)}. Each run can use up to {money(draft.budgets.collectionUsd)} for collection and {money(draft.budgets.aiUsd)} for AI. Saving starts the schedule at its next run time.</small></span></label><p>Keep the app or server running. Missed times do not create a backlog. {draft.autoApproveThemes ? 'Themes are approved automatically, so each run finishes with reports.' : 'Each run pauses for your theme review before reports.'} New scheduled runs are skipped while a run is active or waiting for review.</p></div>}

      <details className="cs-details"><summary><Settings2 size={14} />Advanced research controls</summary><div className="cs-advanced-grid">{[['targetPerPlatform', 'Target items per platform', 1, 10000], ['maxEvidenceItems', 'Maximum evidence items', 1, 10000], ['perAuthorCap', 'Maximum items per author', 1, 1000], ['maxThemes', 'Maximum themes', 1, 6], ['discoveryBatchSize', 'Discovery batch size (per platform)', 40, 200]].map(([key, label, min, max]) => <Field id={`cs-program-${key}`} label={label} key={key}><input id={`cs-program-${key}`} type="number" min={min} max={max} step="1" value={draft[key]} onChange={(event) => change(key, Number(event.target.value))} /></Field>)}</div><div className="cs-thresholds">{['discovery', 'tagging'].map((stage) => <div key={stage}><h4>{stage === 'discovery' ? 'Discovery' : 'Classification'} engagement thresholds</h4><div className="cs-three-fields">{['x', 'linkedin', 'reddit'].map((platform) => <Field key={platform} id={`cs-${stage}-${platform}`} label={platform === 'x' ? 'X' : readable(platform)}><input id={`cs-${stage}-${platform}`} type="number" min="0" max="1000" value={draft.thresholds[stage][platform]} onChange={(event) => setDraft((current) => ({ ...current, thresholds: { ...current.thresholds, [stage]: { ...current.thresholds[stage], [platform]: Number(event.target.value) } } }))} /></Field>)}</div></div>)}</div><ProgramCollectionFields draft={draft} setDraft={setDraft} /><label className="cs-check"><input type="checkbox" checked={draft.includeUndated} onChange={(event) => change('includeUndated', event.target.checked)} /><span>Include undated evidence in a dated search<small>Undated items otherwise stay outside the selected time frame.</small></span></label></details>
      {formError && <div className="cs-alert" role="alert">{formError}</div>}<div className="cs-form-actions"><span>{draft.schedule.enabled && draft.schedule.frequency !== 'manual' ? 'Saving enables future runs with the limits above. No run starts immediately.' : 'Saving keeps automatic runs off. You can start research whenever you are ready.'}</span><Button type="submit">Save research program<Check size={15} /></Button></div>
    </fieldset></form> : selectedProgram ? <div className="cs-research-layout"><aside className="cs-panel cs-program-list"><div className="cs-panel-title"><h3>Saved programs</h3><Badge>{programs.length}</Badge></div>{programs.map((program) => <button type="button" key={program.id} className={`cs-program-choice ${selectedProgram.id === program.id ? 'selected' : ''}`} onClick={() => { setSelectedProgramId(program.id); onSelectRun(''); }}><strong>{program.name}</strong><small>{list(program.sourceGroups).filter((group) => group.enabled).reduce((sum, group) => sum + list(group.targets).length, 0)} targets · {program.query || 'Source-led research'}</small>{lastRunLine(program) && <small className="cs-program-cost">{lastRunLine(program)}</small>}</button>)}</aside><div className="cs-research-main"><section className="cs-panel"><div className="cs-panel-title"><div><h3>{selectedProgram.name}</h3><p>{selectedProgram.query || 'Follow the accounts and communities in this program.'}</p></div>{canEdit && <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => edit(selectedProgram)}>Edit program</Button>}</div><div className="cs-program-scope">{list(selectedProgram.sourceGroups).filter((group) => group.enabled).map((group) => <SourcePill key={group.id}>{group.name} · {list(group.targets).length || 'topic'}</SourcePill>)}<SourcePill>{programWindowLabel(selectedProgram)}</SourcePill></div><ProgramSchedule program={selectedProgram} disabled={disabled} seeCosts={seeCosts} onToggle={canEdit && (() => action(selectedProgram.schedule?.enabled ? 'Pausing schedule' : 'Enabling schedule', () => api.saveResearchProgram({ ...selectedProgram, schedule: { ...selectedProgram.schedule, enabled: !selectedProgram.schedule?.enabled } }), selectedProgram.schedule?.enabled ? 'Schedule paused. A running research task is not cancelled.' : 'Schedule enabled for its next run time.'))} />{canStart && <fieldset className="cs-run-input" disabled={disabled}><legend>Evidence for this run</legend><div className="cs-choice-row"><label><input type="radio" name="cs-evidence-mode" value="collect" checked={inputMode === 'collect'} onChange={() => setInputMode('collect')} />Collect configured sources</label><label><input type="radio" name="cs-evidence-mode" value="reuse" checked={inputMode === 'reuse'} onChange={() => setInputMode('reuse')} />Use saved collections</label></div>{inputMode === 'reuse' && <div className="cs-dataset-picker">{datasets.length ? datasets.map((dataset) => <label className="cs-check" key={dataset.id}><input type="checkbox" checked={datasetIds.includes(dataset.id)} onChange={(event) => setDatasetIds((ids) => event.target.checked ? [...ids, dataset.id] : ids.filter((id) => id !== dataset.id))} /><span><strong>{dataset.name || dataset.title || 'Saved collection'}</strong><small>{number(dataset.itemCount)} items · {dataset.platform || 'import'}</small></span></label>) : <p>No collections are available in this workspace. <button className="cs-text-button" type="button" onClick={onCollect}>Collect evidence</button></p>}</div>}{inputMode === 'collect' && <ProgramEstimate draft={selectedProgram} api={api} />}<div className="cs-run-cost"><div>{seeCosts && <span>{inputMode === 'collect' ? `Collection cap ${money(selectedProgram.budgets?.collectionUsd)} · ` : 'Existing evidence · '}AI budget {money(selectedProgram.budgets?.aiUsd)}</span>}<small>{selectedProgram.autoApproveThemes ? 'Themes are approved automatically, so the run goes straight from discovery to tagging and reports.' : 'Discovery pauses for you to review themes before classification and reports.'}</small></div><Button type="button" disabled={!workspace || (inputMode === 'reuse' ? !datasetIds.length : !list(selectedProgram.sourceGroups).some((group) => group.enabled))} onClick={() => onStart(selectedProgram, inputMode === 'reuse' ? datasetIds : [])}>Start research<Search size={15} /></Button></div></fieldset>}</section>
      {activeRun && <RunDetail promptChanges={promptChanges} run={activeRun} focus={focusRunId === activeRun.id} onFocused={onRunFocused} assets={assetsForRun(assets, activeRun)} capabilities={capabilities} gates={gates} api={api} action={action} disabled={disabled} onUseAsset={onUseAsset} onOpenSheets={onOpenSheets} />}
      {programRuns.length > 1 && <div className="cs-history"><h4>Run history</h4>{programRuns.map((run) => <button type="button" className={`${activeRun?.id === run.id ? 'selected' : ''}${isQuickScan(run) ? ' is-quick' : ''}`} key={run.id} onClick={() => onSelectRun(run.id)}>{isQuickScan(run) ? <span className="cs-history-quick"><strong><Zap size={12} aria-hidden="true" />Quick scan</strong><span>{quickScanLine(run)}</span><small>{formatDate(run.createdAt)}</small></span> : <span>{formatDate(run.createdAt)}</span>}<Status value={run.status} /></button>)}</div>}
    </div></div> : (canEdit ? <EmptyState icon={Search} title="Build your first listening program" detail="Save a source list and research question to begin." action="Create program" onAction={() => setEditing(true)} /> : <EmptyState icon={Search} title="No research programs yet" detail={`Ask ${askAdmin} to set up a research program. You can start runs and review trends once it’s saved.`} />)}
  </div>;
}


function ProgramSchedule({ program, disabled, seeCosts = true, onToggle }) {
  const schedule = { ...emptySchedule(), ...program.schedule };
  const recurring = schedule.frequency !== 'manual';
  const nextRun = schedule.enabled ? scheduledDate(schedule.nextRunAt, schedule.timeZone) : '';
  return <section className={`cs-program-schedule ${schedule.enabled ? 'enabled' : ''}`} aria-label="Program schedule">
    <div className="cs-schedule-summary"><CalendarClock size={19} aria-hidden="true" /><div><strong>{recurring ? schedule.enabled ? 'Schedule is on' : 'Schedule is paused' : 'Run on demand'}</strong><p>{scheduleSummary(schedule)}</p>{recurring && <small>Search the previous {schedule.lookbackDays} complete UTC {schedule.lookbackDays === 1 ? 'day' : 'days'}{seeCosts ? ` · Collection ${money(program.budgets?.collectionUsd)} + AI ${money(program.budgets?.aiUsd)} per run` : ''}</small>}</div>{recurring && onToggle && <Button type="button" className="cs-quiet" disabled={disabled} onClick={onToggle}>{schedule.enabled ? 'Pause schedule' : 'Resume schedule'}</Button>}</div>
    {recurring && <div className="cs-schedule-status">{nextRun && <p><strong>Next run:</strong> {nextRun}</p>}{schedule.lastError && <p className="cs-schedule-error" role="alert">Schedule paused: {schedule.lastError}</p>}{schedule.skippedReason && <p>{schedule.skippedReason}</p>}<p>Keep the app or server running. Themes still need your review before reports are created.</p></div>}
  </section>;
}

function RunDetail({ run, focus = false, onFocused, assets, capabilities = {}, gates = {}, api, action, disabled, onUseAsset, onViewAsset, onOpenSheets, promptChanges = [] }) {
  const panelRef = useRef(null);
  useEffect(() => { if (!focus) return; panelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); onFocused?.(); }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const [themes, setThemes] = useState([]);
  const [themeError, setThemeError] = useState('');
  const [retryBudget, setRetryBudget] = useState(String(run.maxBudgetUsd ?? run.budgets?.aiUsd ?? ''));
  const [retryError, setRetryError] = useState('');
  const [published, setPublished] = useState(null);
  useEffect(() => { setPublished(null); }, [run.id]);
  const delivery = run.googleDelivery || published;
  const folderUrl = safeMarkdownUrl(delivery?.folderUrl);
  useEffect(() => { setRetryBudget(String(run.maxBudgetUsd ?? run.budgets?.aiUsd ?? '')); setRetryError(''); }, [run.id, run.maxBudgetUsd, run.budgets?.aiUsd]);
  const incomingThemes = list(run.themes);
  const themeVersion = JSON.stringify(incomingThemes);
  useEffect(() => { setThemes(incomingThemes.map((theme) => ({ ...theme, selected: theme.approved !== false }))); setThemeError(''); }, [run.id, themeVersion]);
  const jobs = list(run.jobs).length ? run.jobs : list(run.deliverables);
  const complete = jobs.filter((job) => ['succeeded', 'completed'].includes(job.status)).length;
  const { seeCosts = true, canApprove = true, canCancel = true, canRetry = true, canExport = true, canPublish = true } = gates;
  async function approve() {
    if (!canApprove) return;
    const selected = themes.filter((theme) => theme.selected);
    if (!selected.length) { setThemeError('Choose at least one supported theme to continue.'); return; }
    if (selected.some((theme) => !text(theme.name).trim())) { setThemeError('Give each selected theme a clear name.'); return; }
    await action('Approving themes and continuing research', async () => {
      await api.approveResearchThemes({ runId: run.id, themes: selected.map(({ selected: _, ...theme }) => theme) });
      return api.continueResearchRun({ runId: run.id });
    });
  }
  return <section ref={panelRef} className="cs-panel cs-run-detail" aria-label="Run progress"><div className="cs-panel-title"><div><span className="cs-eyebrow">{isQuickScan(run) ? 'QUICK SCAN' : run.runKind === 'research' || run.programId ? 'RESEARCH RUN' : 'CONTENT RUN'}</span><h3>{run.title || run.name || run.source?.title || 'Current run'}</h3><p>{friendlyMessage(run.message) || readable(run.stage || run.status)}</p></div><Status value={run.status} /></div>
    <div className="cs-run-meta">{isQuickScan(run) && <span>Quick scan · {quickScanLine(run)}</span>}<span>Started {formatDate(run.createdAt)}</span>{run.model && <span>{run.model}</span>}{Number.isFinite(run.costUsd) && <span>Recorded cost {money(run.costUsd)}</span>}{Number.isFinite(run.reservedUsd) && <span>Reserved budget {money(run.reservedUsd)}</span>}</div>
    {(run.counts || run.discoveryProgress || run.assignmentProgress) && <div className="cs-research-progress">{Number.isFinite(run.counts?.retained) && <div><strong>{number(run.counts.retained)}</strong><span>Retained evidence items</span></div>}{[['discoveryProgress', 'Discovery batches'], ['assignmentProgress', 'Classification batches']].map(([key, label]) => run[key] && <div key={key}><strong>{number(run[key].completed)} / {number(run[key].total)}</strong><span>{label}</span></div>)}{onOpenSheets && run.counts?.retained > 0 && <Button type="button" className="cs-quiet cs-open-sheets" onClick={() => onOpenSheets(run.id)}><Sheet size={14} aria-hidden="true" />Open in Sheets</Button>}</div>}{list(run.warnings).length > 0 && <div className="cs-run-warnings">{run.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
    {run.error && <div className="cs-alert" role="alert">{friendlyMessage(run.error) || 'This run needs attention.'}</div>}
    {jobs.length > 0 && <><div className="cs-progress-label"><span>{complete} of {jobs.length} outputs complete</span><small>Actual output status</small></div><progress value={complete} max={jobs.length} aria-label="Completed outputs" /><div className="cs-job-list">{jobs.map((job, index) => <div key={job.id || index}><span className="cs-job-state">{['succeeded', 'completed'].includes(job.status) ? <Check size={14} /> : job.status === 'running' ? <LoaderCircle size={14} className="spin" /> : <span />}</span><div><strong>{job.label || job.title || job.deliverableId || `Output ${index + 1}`}</strong>{job.error && <p>{typeof job.error === 'string' ? job.error : job.error.message}</p>}</div><Status value={job.status} /></div>)}</div></>}
    {run.status === 'awaiting-review' && <div className="cs-theme-review"><div className="cs-field-heading"><h4>Choose the themes worth taking forward.</h4><p>Review the evidence support and edit the wording. Only selected themes move into classification.</p></div>{themes.length ? themes.map((theme, index) => <article key={theme.id} className={`cs-theme-card ${theme.selected ? 'selected' : ''}`}><label className="cs-check"><input type="checkbox" checked={theme.selected} disabled={disabled} onChange={(event) => setThemes((current) => current.map((item, i) => i === index ? { ...item, selected: event.target.checked } : item))} /><span>Select theme {index + 1}</span><Badge>{number(theme.evidenceCount ?? list(theme.evidenceIds).length)} sources</Badge></label><ThemeScore theme={theme} /><Field id={`cs-theme-name-${index}`} label="Theme name"><input id={`cs-theme-name-${index}`} value={theme.name || ''} maxLength={160} disabled={disabled} onChange={(event) => setThemes((current) => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></Field><Field id={`cs-theme-description-${index}`} label="Theme description"><textarea id={`cs-theme-description-${index}`} rows={2} value={theme.description || ''} maxLength={5000} disabled={disabled} onChange={(event) => setThemes((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} /></Field>{list(theme.evidenceIds).length > 0 && <details className="cs-theme-evidence"><summary>Source references ({theme.evidenceIds.length})</summary><div>{theme.evidenceIds.map((id) => <code key={id}>{id}</code>)}</div></details>}</article>) : <p>No supported themes were returned. Adjust the program or add stronger evidence before another run.</p>}{themeError && <p className="cs-alert" role="alert">{themeError}</p>}{canApprove && <Button type="button" disabled={disabled || !themes.length} onClick={approve}>Approve themes & build reports<ArrowRight size={15} /></Button>}</div>}
    {assets.length > 0 && <div className="cs-run-assets"><h4>Saved outputs</h4>{assets.map((asset) => <article key={asset.id}><span className="cs-mini-icon">{asset.kind === 'image' ? <ImageIcon size={17} /> : <FileText size={17} />}</span><div><strong>{asset.title || 'Generated asset'}</strong><small>{asset.channel || asset.format || asset.kind}</small></div>{onViewAsset && <Button type="button" className="cs-quiet" onClick={() => onViewAsset(asset)}>Review</Button>}{onUseAsset && asset.kind !== 'image' && <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => onUseAsset(asset)}>Create content<ArrowRight size={13} /></Button>}</article>)}</div>}
    <div className="cs-run-actions">{!TERMINAL.has(run.status) && canCancel && <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => window.confirm('Cancel this run? Finished outputs are kept, and you can retry the rest later.') && action('Cancelling run', () => api.cancelStudioRun({ runId: run.id }))}><Square size={12} />Cancel run</Button>}{['failed', 'partial', 'cancelled'].includes(run.status) && canRetry && <div className="cs-retry-control">{seeCosts && <Field id={`cs-retry-budget-${run.id}`} label="Total retry budget (USD)" hint="Includes earlier usage and reserved costs. Increase deliberately if more budget is needed."><input id={`cs-retry-budget-${run.id}`} type="number" min="0.01" max="1000" step="0.01" value={retryBudget} disabled={disabled} onChange={(event) => { setRetryBudget(event.target.value); setRetryError(''); }} /></Field>}<Button type="button" disabled={disabled} onClick={() => { if (seeCosts && (!Number.isFinite(Number(retryBudget)) || Number(retryBudget) <= 0)) { setRetryError('Enter the total budget to authorize for this retry.'); return; } const newer = newerPromptsFor(run, promptChanges); const refreshPrompts = newer.length > 0 && window.confirm(`Use the newest prompts?\n\n${newestPromptsLine(newer)}\n\nOK uses the newest prompts. Cancel keeps the run’s prompts.`); action('Retrying unfinished work', () => api.retryStudioRun({ runId: run.id, ...(seeCosts ? { maxBudgetUsd: Number(retryBudget) } : {}), ...(refreshPrompts ? { refreshPrompts: true } : {}) })); }}><RefreshCw size={14} />Retry unfinished outputs</Button>{retryError && <p role="alert">{retryError}</p>}</div>}{assets.length > 0 && canExport && <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => action('Exporting run', () => api.exportStudioRun({ runId: run.id }), 'Run exported with its source metadata and manifest.')}><Download size={14} />Export run</Button>}{assets.length > 0 && canPublish && capabilities.googlePublishConfigured && <Button type="button" className="cs-quiet" disabled={disabled} onClick={async () => { const result = await action('Publishing to Google Drive', () => api.publishStudioRun({ runId: run.id })); if (result) setPublished(result); }}><Upload size={14} />Publish to Google Drive</Button>}<small>Generated drafts stay here for review.</small></div>{(delivery || run.deliveryMessage) && <div className="cs-delivery-receipt"><strong>{run.deliveryMessage || `Google Drive delivery: ${readable(delivery.status)}`}</strong>{folderUrl && <MarkdownContent>{`[Open Google Drive folder](${folderUrl})`}</MarkdownContent>}</div>}
  </section>;
}

function CreateContent({ workspace, catalog, catalogLoading, capabilities, sourceDraft, reports, runs, selectedRun, focusRunId, onRunFocused, assets, api, action, disabled, onUseReport, onCreated, onSelectRun, onViewAsset, onSettings, askAdmin = 'an admin', promptChanges = [] }) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState({ kind: 'text', title: '', text: '', evidence: [] });
  const [deliverableIds, setDeliverableIds] = useState([]);
  const [imageVariants, setImageVariants] = useState(3);
  const [budget, setBudget] = useState('5.00');
  const [formError, setFormError] = useState('');
  const [channel, setChannel] = useState('all');
  const [showAllFormats, setShowAllFormats] = useState(false);
  const [mode, setMode] = useState('paste');
  const [googleUrl, setGoogleUrl] = useState('');
  const stepRefs = useRef([]);
  const editionId = workspace?.editionId || 'general';
  const available = list(catalog.deliverables).filter((item) => !item.editions || item.editions.includes(editionId));
  const selected = available.filter((item) => deliverableIds.includes(item.id));
  const images = selected.filter((item) => item.kind === 'image');
  const channels = [...new Set(available.map((item) => item.channel).filter(Boolean))];
  const displayLabel = (item) => editionId === 'semrush' ? ({ 'evidence-report': 'Trends report', 'editorial-toolkit': 'Editorial toolkit' }[item.id] || item.semrushLabel || item.label) : item.label;
  const featuredIds = ['evidence-report', 'editorial-toolkit', 'bloglong', 'social', 'enterprise', 'brand-image'];
  const filteredFormats = available.filter((item) => channel === 'all' || (channel === 'images' ? item.kind === 'image' : item.channel === channel));
  const featuredFormats = featuredIds.map(id => filteredFormats.find(item => item.id === id)).filter(Boolean);
  const compactFormats = editionId === 'semrush' && channel === 'all' && featuredFormats.length > 0;
  const visible = compactFormats && !showAllFormats ? featuredFormats : compactFormats ? [...featuredFormats, ...filteredFormats.filter(item => !featuredIds.includes(item.id))] : filteredFormats;
  const formatDescription = (item) => ({ 'evidence-report': 'A source-backed report with findings, evidence, and opportunities.', 'editorial-toolkit': 'Key messages, angles, headlines, and talking points.', bloglong: 'A complete article with source context and editorial structure.', social: 'LinkedIn posts and an X thread shaped for your audience.', enterprise: 'A practical trend brief for your sales team.', 'brand-image': 'Original campaign visuals guided by your source and brand.' }[item.id] || item.description || (item.kind === 'image' ? 'Original PNG visuals generated from your source and brand context.' : `${item.channel} · ${list(item.sections).slice(0, 2).map((section) => section.heading).join(' and ') || 'A structured, source-linked draft.'}`));
  useEffect(() => { if (sourceDraft?.text) { setSource({ ...sourceDraft, evidence: list(sourceDraft.evidence) }); setStep(0); setMode('paste'); setFormError(''); } }, [sourceDraft]);
  function updateSource(key, value) { setSource((current) => ({ ...current, [key]: value })); setFormError(''); }
  function choose(id) { setDeliverableIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]); setFormError(''); }
  function validateSource() {
    if (!source.title.trim()) { setFormError('Give the source brief a title.'); setStep(0); return false; }
    if (!source.text.trim()) { setFormError('Paste a source brief, import a document, or select a completed report.'); setStep(0); return false; }
    if (source.text.length > 250000) { setFormError('Keep the source document to 250,000 characters or fewer.'); setStep(0); return false; }
    return true;
  }
  function next() { if (!validateSource()) return; if (step === 1 && !selected.length) { setFormError('Choose at least one deliverable.'); return; } setFormError(''); setStep(Math.min(2, step + 1)); }
  async function importSource() {
    const result = await action('Importing source document', () => api.importStudioSource());
    if (result?.text) { setSource({ kind: 'text', title: result.title || 'Imported source', text: result.text, evidence: list(result.evidence) }); setMode('paste'); setFormError(''); }
  }
  async function importGoogleDoc() {
    if (!/^https:\/\/docs\.google\.com\/document\/d\/[^/]+/.test(googleUrl.trim())) { setFormError('Enter a Google Docs document URL.'); return; }
    const result = await action('Reading Google document', () => api.importStudioSource({ url: googleUrl.trim() }));
    if (result?.text) { setSource({ kind: 'text', title: result.title || 'Google document', text: result.text, evidence: list(result.evidence) }); setMode('paste'); setFormError(''); }
  }
  async function generate() {
    if (!workspace?.id) { setFormError('Create a workspace in Brand knowledge first.'); return; }
    if (!validateSource()) return;
    if (!selected.length) { setFormError('Choose at least one deliverable.'); setStep(1); return; }
    if (images.length && !capabilities.imagesConfigured) { setFormError('Configure the image provider or remove image outputs before generating.'); setStep(1); return; }
    if (!Number.isFinite(Number(budget)) || Number(budget) <= 0) { setFormError('Set a positive generation budget.'); return; }
    const result = await action('Starting content generation', () => api.createContentRun({ workspaceId: workspace.id, source, deliverableIds: selected.map((item) => item.id), imageVariants: Number(imageVariants), maxBudgetUsd: Number(budget) }));
    if (result) onCreated(result.run || result);
  }
  function keyStep(event, index) { const nextStep = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null; if (nextStep !== null) { event.preventDefault(); setStep(nextStep); stepRefs.current[nextStep]?.focus(); } }
  return <div className="cs-create"><SectionHeading page title="Create content" detail="Bring the insight. Choose the outputs. Keep the source attached all the way through." />
    <div className="cs-create-layout"><section className="cs-panel cs-create-main"><div className="cs-create-steps" role="tablist" aria-label="Content creation steps">{STEPS.map((label, index) => <button type="button" role="tab" aria-label={label} key={label} id={`cs-create-tab-${index}`} aria-controls={`cs-create-panel-${index}`} aria-selected={step === index} tabIndex={step === index ? 0 : -1} ref={(node) => { stepRefs.current[index] = node; }} onClick={() => { setStep(index); setFormError(''); }} onKeyDown={(event) => keyStep(event, index)}><span aria-hidden="true">{index + 1}</span><div><strong>{label}</strong><small>{index === 0 ? 'Tell us what to explore' : index === 1 ? 'Select what to create' : 'Check details and run'}</small></div>{index < 2 && <ChevronRight size={16} aria-hidden="true" />}</button>)}</div>
      <section role="tabpanel" id="cs-create-panel-0" aria-labelledby="cs-create-tab-0" hidden={step !== 0}><div className="cs-field-heading"><h3>What is the story?</h3><p>A useful source is a report, an article, or a brief with the facts and links you want to build on.</p></div><div className="cs-source-modes"><button type="button" aria-pressed={mode === 'paste'} onClick={() => setMode('paste')}><FileText size={15} />Paste a brief</button><button type="button" disabled={disabled} onClick={importSource}><Upload size={15} />Import document</button><button type="button" aria-pressed={mode === 'report'} onClick={() => setMode('report')}><BookOpen size={15} />Use a report</button><button type="button" aria-pressed={mode === 'google'} disabled={disabled || !capabilities.googleConfigured} onClick={() => setMode('google')} title={capabilities.googleConfigured ? 'Import a connected Google document' : 'Configure a Google connection in Settings'}><BookOpen size={15} />Google Doc</button></div>
        {mode === 'google' ? <div className="cs-google-import"><Field id="cs-google-document-url" label="Google document URL" hint="Uses your configured Google connection to read this document."><input id="cs-google-document-url" type="url" value={googleUrl} disabled={disabled} onChange={(event) => setGoogleUrl(event.target.value)} placeholder="https://docs.google.com/document/d/…" /></Field><Button type="button" disabled={disabled || !googleUrl.trim()} onClick={importGoogleDoc}>Read document<ArrowRight size={14} /></Button></div> : mode === 'report' ? <div className="cs-report-picker">{reports.length ? reports.map((report) => <button type="button" key={report.id} disabled={disabled} onClick={() => onUseReport(report)}><FileText size={18} /><span><strong>{report.title || report.name || 'Research report'}</strong><small>{number(list(report.evidence).length)} source records</small></span><ArrowRight size={15} /></button>) : <EmptyState icon={BookOpen} title="No completed reports in this workspace" detail="Run a research program, or paste/import a report you already have." />}</div> : <><Field id="cs-source-title" label="Source title"><input id="cs-source-title" value={source.title} maxLength={240} disabled={disabled} onChange={(event) => updateSource('title', event.target.value)} placeholder="e.g. What marketers need to know about AI search" /></Field><Field id="cs-source-text" label="Source brief" hint="Use only material you are authorized to work with. Source text and links guide the drafts; pasted claims still need verification."><textarea id="cs-source-text" value={source.text} maxLength={250000} rows={12} disabled={disabled} onChange={(event) => updateSource('text', event.target.value)} placeholder="Paste your report, article, research notes, or a detailed trend brief…" /></Field><div className="cs-source-meta"><span>{number(source.text.length)} characters</span><span>{source.evidence.length ? `${number(source.evidence.length)} evidence records attached` : 'No structured evidence records attached'}</span></div></>}
      </section>
      <section role="tabpanel" id="cs-create-panel-1" aria-labelledby="cs-create-tab-1" hidden={step !== 1}><div className="cs-field-heading"><h3>What would you like to create?</h3><p>Choose only the formats you need. Every selected output gets its own generation status.</p></div><div className="cs-deliverable-filters"><label><span className="sr-only">Filter deliverables</span><select aria-label="Filter deliverables" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">All channels</option><option value="images">Images</option>{channels.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><span>{selected.length} selected</span><button type="button" className="cs-text-button" disabled={disabled || !selected.length} onClick={() => setDeliverableIds([])}>Clear selection</button></div>{catalogLoading ? <p className="cs-action-status"><LoaderCircle className="spin" size={15} />Loading deliverables…</p> : <div className="cs-deliverable-grid">{visible.map((item) => { const selectedItem = deliverableIds.includes(item.id); const needsConfig = item.kind === 'image' && !capabilities.imagesConfigured; return <label className={`cs-deliverable ${selectedItem ? 'selected' : ''} ${needsConfig ? 'needs-config' : ''}`} key={item.id}><input type="checkbox" checked={selectedItem} disabled={disabled || needsConfig} onChange={() => choose(item.id)} aria-label={displayLabel(item)} /><span className="cs-deliverable-icon">{item.kind === 'image' ? <ImageIcon size={23} /> : item.id === 'social' || item.id === 'ads' ? <Megaphone size={23} /> : item.id === 'enterprise' ? <Users size={23} /> : item.id === 'bloglong' || item.id === 'blogshort' ? <PenLine size={23} /> : <FileText size={23} />}</span><strong>{displayLabel(item)}</strong><p>{formatDescription(item)}</p>{needsConfig && <small>Image provider setup needed</small>}</label>; })}</div>}{compactFormats && filteredFormats.length > featuredFormats.length && <button type="button" className="cs-more-formats cs-text-button" aria-expanded={showAllFormats} onClick={() => setShowAllFormats(value => !value)}>{showAllFormats ? 'Show core formats' : `Explore ${filteredFormats.length - featuredFormats.length} more ${filteredFormats.length - featuredFormats.length === 1 ? 'format' : 'formats'}`}<ChevronRight size={14} /></button>}
        {!capabilities.imagesConfigured && <div className="cs-capability-note"><ImageIcon size={16} />{onSettings ? <><p>Configure an image provider to create actual visuals. Written deliverables are available separately.</p><Button type="button" className="cs-quiet" onClick={onSettings}>Configure images</Button></> : <p>Pictures are off for your team. {askAdmin} can turn them on. Written deliverables are available separately.</p>}</div>}{images.length > 0 && <Field id="cs-image-variants" label="Image directions per selected image output" hint="Each direction creates a separate generated image."><select id="cs-image-variants" value={imageVariants} disabled={disabled} onChange={(event) => setImageVariants(Number(event.target.value))}>{[1, 2, 3].map((value) => <option key={value} value={value}>{value} {value === 1 ? 'direction' : 'directions'}</option>)}</select></Field>}
      </section>
      <section role="tabpanel" id="cs-create-panel-2" aria-labelledby="cs-create-tab-2" hidden={step !== 2}><div className="cs-field-heading"><h3>Ready for a first draft?</h3><p>Review the source, outputs, and budget before starting generation.</p></div><div className="cs-review-brief"><span className="cs-mini-icon"><FileText size={20} /></span><div><h4>{source.title || 'Add a source title'}</h4><p>{source.text.trim() ? `${source.text.slice(0, 350)}${source.text.length > 350 ? '…' : ''}` : 'Add the source material in Source brief.'}</p><small>{number(source.text.length)} characters · {number(source.evidence.length)} evidence records</small></div><Button type="button" className="cs-quiet" onClick={() => setStep(0)}>Edit</Button></div><div className="cs-review-outputs">{selected.map((item) => <div key={item.id}>{item.kind === 'image' ? <ImageIcon size={16} /> : <FileText size={16} />}<strong>{displayLabel(item)}</strong><span>{item.kind === 'image' ? `${imageVariants} image directions` : item.channel}</span></div>)}</div><div className="cs-review-context"><BookOpen size={17} /><p>Uses the saved brand knowledge and approved product registry for <strong>{workspace?.name || 'your workspace'}</strong>. Every run preserves its own context.</p></div></section>
      {formError && <div className="cs-alert" role="alert">{formError}</div>}<div className="cs-wizard-footer">{step > 0 ? <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => { setStep(step - 1); setFormError(''); }}><ArrowLeft size={14} />Back</Button> : <span />}{step < 2 && <Button type="button" disabled={disabled} onClick={next}>{step === 0 ? 'Choose deliverables' : 'Review generation'}<ArrowRight size={14} /></Button>}</div>
    </section><aside className="cs-panel cs-campaign-summary"><h3>Campaign summary</h3><div className="cs-draft-note"><span><Sparkles size={18} /></span><div><strong>Drafts need review</strong><p>Check facts, source context, and brand fit before sharing.</p></div></div><h4>Selected outputs</h4>{selected.length ? <div className="cs-summary-outputs">{selected.map((item) => <div key={item.id}><span>{item.kind === 'image' ? <ImageIcon size={15} /> : <FileText size={15} />}</span><p>{displayLabel(item)}</p><button type="button" disabled={disabled} aria-label={`Remove ${displayLabel(item)}`} onClick={() => choose(item.id)}><X size={13} /></button></div>)}</div> : <p className="cs-summary-empty">Your chosen formats will appear here.</p>}<div className="cs-summary-divider" /><div className="cs-summary-config"><span>Workspace</span><strong>{workspace?.name || 'Not configured'}</strong><span>Text analysis</span><strong>{capabilities.textModel ? modelLabel(capabilities.textModel) : 'Default Claude model'}</strong><span>Image generation</span><strong>{capabilities.imagesConfigured ? [capabilities.imageProvider || 'Provider configured', capabilities.imageModel].filter(Boolean).join(' · ') : 'Setup needed'}</strong></div><Field id="cs-content-budget" label="Spending allowance (USD)" hint="Authorizes requests; it is not a hard cap on provider charges."><input id="cs-content-budget" type="number" min="0.01" max="1000" step="0.01" value={budget} disabled={disabled} onChange={(event) => setBudget(event.target.value)} /></Field><Button className="cs-generate" type="button" disabled={disabled || !workspace || !selected.length || step !== 2} onClick={generate}>Generate drafts<ArrowRight size={16} /></Button><small>Starts the selected AI jobs. Nothing is published automatically.</small></aside></div>
    {selectedRun && <RunDetail promptChanges={promptChanges} run={selectedRun} focus={focusRunId === selectedRun.id} onFocused={onRunFocused} assets={assetsForRun(assets, selectedRun)} capabilities={capabilities} api={api} action={action} disabled={disabled} onViewAsset={onViewAsset} />}{runs.length > 0 && <div className="cs-history"><h4>Recent content runs</h4>{runs.slice(0, 8).map((run) => <button type="button" key={run.id} className={selectedRun?.id === run.id ? 'selected' : ''} onClick={() => onSelectRun(run.id)}><span>{run.title || run.source?.title || formatDate(run.createdAt)}</span><Status value={run.status} /></button>)}</div>}
  </div>;
}

const TREE_ROOT = '#library';
const NODE_ICONS = { 'research-run': Radar, trend: Sparkles, kits: Layers3, 'kit-run': FolderOpen, channel: Folder, drafts: PenLine, 'draft-run': PenLine, pictures: ImageIcon, askai: Sparkles, source: FileText, orphans: FolderOpen, earlier: CalendarClock, legacy: BookOpen };
const nodeIcon = (node) => (node?.meta?.origin === 'quick-scan' ? Zap : NODE_ICONS[node?.type] || Folder);
const newestItem = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

// The library as folders, filed by src/shared/library-tree.js: research run → trend → its report and toolkit, channel
// assets by set and channel team, drafts and pictures. The tree (left) and the open folder (right) move together;
// searching or filtering lists matching files flat, each with the folders it sits in. The preview reads the file that
// was picked, or else the newest file in the open folder.
function StudioLibrary({ workspace, inputs, studio = {}, selectedId, onSelect, api, action, disabled, onCreate, onUseAsset, onNotice, onOpenTrends, renderLegacy, folderRequest = null, linkOrigin = '', onOpenPrompt }) {
  const viewer = useViewer();
  const can = (method) => canCall(viewer, method);
  const editionId = workspace?.editionId || 'general';
  const [helpImages, setHelpImages] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (typeof api.listHelpImages !== 'function') return undefined;
    Promise.resolve().then(() => api.listHelpImages()).then((rows) => { if (!cancelled) setHelpImages(list(rows)); }).catch(() => { if (!cancelled) setHelpImages([]); });
    return () => { cancelled = true; };
  }, [api.listHelpImages]);
  const tree = useMemo(() => buildLibraryTree({ ...inputs, editionId, helpImages }), [inputs, editionId, helpImages]);
  const studioItem = (id) => (id ? tree.itemsByKey[`studio:${id}`] || null : null);
  const [cwd, setCwd] = useState(() => studioItem(selectedId)?.location || '');
  const [expanded, setExpanded] = useState(() => new Set([...(tree.roots[0] ? [tree.roots[0]] : []), ...pathTo(tree, studioItem(selectedId)?.location).map((node) => node.id)]));
  const [focusId, setFocusId] = useState(TREE_ROOT);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState('any'); // Draft · In review · Approved · Scheduled · Published
  const [helpKey, setHelpKey] = useState(''); // an Ask AI picture open in the preview (studio files use selectedId)
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [thumbs, setThumbs] = useState({});
  const itemRefs = useRef(new Map());
  const previewRef = useRef(null);
  const folderId = tree.nodes[cwd] ? cwd : ''; // a folder that emptied out falls back to the top
  const folder = tree.nodes[folderId] || null;
  const assetOf = (item) => (item?.source === 'studio' ? list(inputs.assets).find((asset) => asset.id === item.id) || item.asset : null);
  const filter = useMemo(() => {
    const found = filterLibrary(tree, { query, types: type === 'all' ? [] : [type], channels: channel === 'all' ? [] : [channel] });
    if (status === 'any') return found;
    // The status filter lists matching files flat, like a search, with the folders each sits in.
    const items = (found.active ? found.items : tree.items).filter((item) => item.source === 'studio' && statusOf(assetOf(item)) === status);
    const counts = {}; for (const item of items) for (const node of pathTo(tree, item.location)) counts[node.id] = (counts[node.id] || 0) + 1;
    return { ...found, active: true, items, counts };
  }, [tree, query, type, channel, status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Files in the open folder and every folder inside it, newest first (the whole library at the top).
  const inFolder = useMemo(() => {
    if (!folderId) return tree.items.filter((item) => item.source !== 'legacy');
    const keys = new Set(); const walk = (id) => { const node = tree.nodes[id]; node.itemKeys.forEach((key) => keys.add(key)); node.children.forEach(walk); };
    walk(folderId);
    return [...keys].map((key) => tree.itemsByKey[key]).filter((item) => item && item.source !== 'legacy').sort(newestItem);
  }, [tree, folderId]);
  const picked = tree.itemsByKey[helpKey] || studioItem(selectedId);
  const selected = picked || (filter.active ? filter.items.find((item) => item.source !== 'legacy') : folder?.type === 'legacy' ? null : inFolder[0]) || null;
  function reveal(id) { setExpanded((current) => { const next = new Set(current); for (const node of pathTo(tree, id)) next.add(node.id); return next; }); }
  // A file opened from elsewhere (the Trend board, a run, Create content) opens in its folder.
  useEffect(() => {
    const item = studioItem(selectedId);
    if (!item || tree.nodes[folderId]?.itemKeys.includes(item.key)) return;
    setCwd(item.location); reveal(item.location);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false; setPayload(null); setReadError('');
    if (!selected || selected.source === 'legacy') { setLoading(false); return undefined; }
    setLoading(true);
    Promise.resolve().then(() => (selected.source === 'help' ? api.readHelpImage({ id: selected.id }) : api.readStudioAsset({ assetId: selected.id }))).then((result) => { if (!cancelled) { setPayload(result); setLoading(false); } }).catch((failure) => { if (!cancelled) { setReadError(failure?.message || 'Could not read this asset.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [selected?.key, selected?.edited?.at, api.readStudioAsset, api.readHelpImage]);
  function openFolder(id) {
    const next = id === TREE_ROOT ? '' : id;
    setCwd(next); if (next) reveal(next); setFocusId(id);
    setHelpKey(''); if (selectedId) onSelect('');
  }
  // A channel-asset folder asked for from outside (Ask AI's Open folder): a node id, or a kit's sourceKey, which opens
  // the newest trend or source made from it, at its Channel assets when it has them.
  useEffect(() => {
    if (!folderRequest?.key) return;
    const key = folderRequest.folderKey; const id = tree.nodes[key] ? key : list(tree.bySourceKey?.[key])[0];
    if (id) openFolder(tree.nodes[`kits:${id}`] ? `kits:${id}` : id);
  }, [folderRequest?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  function toggle(id, open) { setExpanded((current) => { const next = new Set(current); if (open ?? !next.has(id)) next.add(id); else next.delete(id); return next; }); }
  function pick(item, { place = false } = {}) {
    if (item.source === 'legacy') { openFolder('legacy'); return; }
    if (place) { setCwd(item.location); reveal(item.location); }
    if (item.source === 'help') { setHelpKey(item.key); if (selectedId) onSelect(''); } else { setHelpKey(''); onSelect(item.id); }
    // The preview sits under the folder; bring it up when it's out of sight.
    const box = previewRef.current?.getBoundingClientRect?.();
    if (box && box.top > window.innerHeight - 120) previewRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  async function saveFolder(runId) {
    const result = await action('Saving the folder', () => api.saveAssetKitFolder({ runId }));
    if (result) onNotice?.(result.savedTo === 'downloads' ? 'Saved to your Downloads folder.' : 'Download started.');
  }
  async function savePicture(item) {
    const result = await action('Saving the picture', () => api.saveHelpImage({ id: item.id }));
    if (result && !result.cancelled) onNotice?.('Picture saved.');
  }

  // Thumbnails for the folder covers and picture rows on screen, a few at a time, kept for the visit.
  const cards = folder ? folder.children : tree.roots;
  const rows = folder ? folder.itemKeys.map((key) => tree.itemsByKey[key]).filter(Boolean) : [];
  const thumbKeys = [...new Set([...cards.flatMap((id) => tree.nodes[id].cover.map((assetId) => `studio:${assetId}`)), ...(filter.active ? filter.items : rows).filter((item) => item.kind === 'image').slice(0, 30).map((item) => item.key)])];
  useEffect(() => {
    let cancelled = false; const queue = thumbKeys.filter((key) => !(key in thumbs));
    async function worker() {
      while (!cancelled && queue.length) {
        const key = queue.shift(); const id = key.slice(key.indexOf(':') + 1); let url = '';
        try { url = key.startsWith('help:') ? (await api.readHelpImage({ id }))?.dataUrl : (await api.readStudioAsset({ assetId: id }))?.imageDataUrl; } catch { /* the card keeps its placeholder */ }
        if (!cancelled) setThumbs((current) => ({ ...current, [key]: safeImage(url) }));
      }
    }
    Promise.all([worker(), worker(), worker()]);
    return () => { cancelled = true; };
  }, [thumbKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // The folder tree: arrow keys move, Right opens a level, Left closes it or goes up, Enter opens the folder.
  const visible = useMemo(() => { const ids = [TREE_ROOT]; const walk = (id) => { ids.push(id); if (expanded.has(id)) tree.nodes[id].children.forEach(walk); }; tree.roots.forEach(walk); return ids; }, [tree, expanded]);
  const tabStop = visible.includes(focusId) ? focusId : folderId && visible.includes(folderId) ? folderId : TREE_ROOT;
  const treeRef = (id) => (element) => { if (element) itemRefs.current.set(id, element); else itemRefs.current.delete(id); };
  function onTreeKey(event) {
    const id = event.target.closest?.('[role="treeitem"]')?.dataset.node; if (!id) return;
    const index = visible.indexOf(id); const node = tree.nodes[id]; const kids = node?.children || []; const open = expanded.has(id);
    const go = (next) => { if (!next) return; event.preventDefault(); setFocusId(next); itemRefs.current.get(next)?.focus(); };
    if (event.key === 'ArrowDown') go(visible[index + 1]);
    else if (event.key === 'ArrowUp') go(visible[index - 1]);
    else if (event.key === 'Home') go(visible[0]);
    else if (event.key === 'End') go(visible[visible.length - 1]);
    else if (event.key === 'ArrowRight') { if (kids.length && !open) { event.preventDefault(); toggle(id, true); } else if (kids.length) go(kids[0]); }
    else if (event.key === 'ArrowLeft') { if (kids.length && open) { event.preventDefault(); toggle(id, false); } else if (node?.parentId) go(node.parentId); else if (id !== TREE_ROOT) go(TREE_ROOT); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFolder(id); }
  }
  const focusHere = (id) => (event) => { if (event.target === event.currentTarget) setFocusId(id); };
  function treeItem(id, level) {
    const node = tree.nodes[id]; const kids = node.children; const open = expanded.has(id); const Icon = nodeIcon(node);
    const matches = filter.active ? filter.counts[id] || 0 : null;
    return <li key={id} role="treeitem" data-node={id} ref={treeRef(id)} aria-level={level} aria-expanded={kids.length ? open : undefined} aria-selected={folderId === id} tabIndex={tabStop === id ? 0 : -1} className={matches === 0 ? 'is-dim' : undefined} onFocus={focusHere(id)} onClick={(event) => { event.stopPropagation(); openFolder(id); }}>
      <span className="cs-tree-row" style={{ '--depth': level - 1 }}><span className="cs-tree-toggle" aria-hidden="true" onClick={(event) => { if (!kids.length) return; event.stopPropagation(); toggle(id); }}>{kids.length > 0 && <ChevronRight size={13} />}</span><Icon size={14} aria-hidden="true" /><span className="cs-tree-title">{node.title}</span>{node.live ? <><LoaderCircle className="spin" size={12} aria-hidden="true" /><span className="sr-only">, working</span></> : <small><span className="sr-only">, </span>{number(matches ?? node.counts.files)}<span className="sr-only">{matches === null ? ' files' : ' matches'}</span></small>}</span>
      {kids.length > 0 && open && <ul role="group">{kids.map((child) => treeItem(child, level + 1))}</ul>}
    </li>;
  }
  const usedByLine = (node) => (list(node?.meta?.usedBy).length ? <small className="cs-used-by"><Megaphone size={11} aria-hidden="true" />Used by {node.meta.usedBy.map((row) => row.name).join(', ')}</small> : null);
  const card = (id) => {
    const node = tree.nodes[id]; const Icon = nodeIcon(node);
    return <button type="button" key={id} className={`cs-folder-card${node.live ? ' is-live' : ''}`} onClick={() => openFolder(id)}>
      <span className="cs-folder-cover" aria-hidden="true">{node.cover.length ? node.cover.map((assetId) => (thumbs[`studio:${assetId}`] ? <img key={assetId} src={thumbs[`studio:${assetId}`]} alt="" /> : <span key={assetId} className="cs-thumb-wait" />)) : <span className="cs-folder-glyph"><Icon size={22} /></span>}</span>
      <span className="cs-folder-copy"><strong>{node.title}</strong><small>{node.live ? <><LoaderCircle className="spin" size={12} aria-hidden="true" />{node.liveText || 'Working…'}</> : folderSummary(node)}</small>{usedByLine(node)}</span>
    </button>;
  };
  const row = (item, { place = false } = {}) => {
    const on = selected?.key === item.key; const where = place ? pathTo(tree, item.location).map((node) => node.title).join(' › ') : '';
    // The status chip sits beside the row (a menu can't live inside the row's button).
    return <div className="cs-file-row-wrap" key={item.key}><button type="button" className={`cs-file-row${on ? ' selected' : ''}`} aria-pressed={on} onClick={() => pick(item, { place })}>
      <span className="cs-mini-icon">{item.kind === 'image' ? (thumbs[item.key] ? <img src={thumbs[item.key]} alt="" /> : <ImageIcon size={17} aria-hidden="true" />) : <FileText size={17} aria-hidden="true" />}</span>
      <span><strong>{item.title}</strong><small>{[item.label || TYPE_LABEL[item.type], item.edited ? 'Edited' : '', item.createdAt ? formatDate(item.createdAt) : ''].filter(Boolean).join(' · ')}</small>{where && <small className="cs-file-path">{where}</small>}</span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>{item.source === 'studio' && <AssetStatusMenu api={api} asset={assetOf(item) || item} align="end" onNotice={onNotice} />}</div>;
  };

  const typeOptions = LIBRARY_TYPES.filter((option) => tree.items.some((item) => item.types.includes(option.id)));
  const channelOptions = [...libraryChannels(editionId), { id: 'other', name: 'Other' }].filter((option) => tree.items.some((item) => item.channelId === option.id));
  const running = tree.pending.some((run) => ['queued', 'running'].includes(run.status));
  const pendingLine = tree.pending.length > 0 && <p className="cs-library-pending">{running ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Radar size={14} aria-hidden="true" />}<span>{plural(tree.pending.length, 'research run')} in progress or waiting for review. Their folders appear once reports are written.</span>{onOpenTrends && <button type="button" className="cs-text-button" onClick={onOpenTrends}>Open the Trend board<ArrowRight size={13} aria-hidden="true" /></button>}</p>;
  const path = pathTo(tree, folderId);
  const files = tree.items.filter((item) => item.source !== 'legacy').length;
  const folderView = <>
    {folderId && <nav className="cs-crumbs" aria-label="Folder path"><ol><li><button type="button" onClick={() => openFolder(TREE_ROOT)}>Library</button></li>{path.map((node, index) => <li key={node.id}>{index === path.length - 1 ? <span aria-current="page">{node.title}</span> : <button type="button" onClick={() => openFolder(node.id)}>{node.title}</button>}</li>)}</ol></nav>}
    {folder?.type !== 'legacy' && <div className="cs-folder-head"><div><h2>{folder ? folder.title : 'All folders'}</h2><p>{folder ? [folder.subtitle, folderSummary(folder)].filter(Boolean).join(' · ') : `${plural(files, 'file')} in ${plural(tree.roots.length, 'folder')}, newest research first`}</p>{usedByLine(folder)}</div>
      {folder?.type === 'kit-run' && can('saveAssetKitFolder') && <Button type="button" className="cs-quiet" disabled={disabled || !folder.counts.files} onClick={() => saveFolder(folder.meta.kitRunId)}><Download size={14} aria-hidden="true" />Save folder</Button>}</div>}
    {folder?.live && <p className="cs-folder-live" role="status"><LoaderCircle className="spin" size={13} aria-hidden="true" />{folder.liveText || 'Working…'}</p>}
    {!folderId && pendingLine}
    {cards.length > 0 && <div className="cs-folder-grid">{cards.map(card)}</div>}
    {folder?.type === 'legacy' ? renderLegacy?.() : rows.length > 0 ? <div className="cs-file-list">{rows.map((item) => row(item))}</div> : folderId && !cards.length && <p className="cs-inline-empty">{folder.live ? 'Files appear here as they’re made.' : 'Nothing in this folder yet.'}</p>}
  </>;
  const results = <>
    <div className="cs-folder-head"><div><h2>{filter.items.length ? plural(filter.items.length, 'match', 'matches') : 'No matches'}</h2><p>{[query.trim() && `“${query.trim()}”`, type !== 'all' && LIBRARY_TYPES.find((option) => option.id === type)?.label, channel !== 'all' && channelOptions.find((option) => option.id === channel)?.name, status !== 'any' && statusLabel(status), 'newest first'].filter(Boolean).join(' · ')}</p></div><Button type="button" className="cs-quiet" onClick={() => { setQuery(''); setType('all'); setChannel('all'); setStatus('any'); }}><X size={13} aria-hidden="true" />Clear filters</Button></div>
    {filter.items.length ? <div className="cs-file-list">{filter.items.map((item) => row(item, { place: true }))}</div> : <p className="cs-inline-empty">No assets match these filters.</p>}
  </>;
  const imageUrl = safeImage(selected?.source === 'help' ? payload?.dataUrl : payload?.imageDataUrl);
  const markdown = assetMarkdown(payload || {});
  const generationReceipt = payload?.asset?.provenance || payload?.asset?.receipt;
  // Copy link: a report or draft opens in the reader; a channel asset opens its folder in Assets.
  const kitSource = selected?.kitRunId ? list(inputs.contentRuns).find((run) => run.id === selected.kitRunId)?.kit?.sourceKey || '' : '';
  const shareLink = linkOrigin && selected?.source === 'studio' ? (kitSource ? linkFor('assets', kitSource, { origin: linkOrigin }) : selected.kind !== 'image' ? linkFor('report', selected.id, { origin: linkOrigin }) : '') : '';
  async function copyLink() { onNotice?.((await copyText(shareLink)) ? LINK_COPIED : 'The link couldn’t be copied. Try again.'); }
  const where = selected ? pathTo(tree, selected.location).map((node) => node.title).join(' › ') : '';
  return <div className="cs-library"><SectionHeading page title="Your asset library" detail={`Research runs, trends, channel assets, drafts and pictures for ${workspace?.name || 'this workspace'}.`} action={onCreate ? <Button type="button" onClick={onCreate}><Plus size={15} />Create content</Button> : null} />
    {!tree.roots.length ? <>{pendingLine}<EmptyState icon={FolderOpen} title="Make something worth sharing" detail="Run a research program or turn a source brief into your first content pack. Real outputs will appear here." action={onCreate ? 'Create content' : undefined} onAction={onCreate} /></> : <div className="cs-library-layout">
      <section className="cs-panel cs-library-list" aria-label="Find files">
        <div className="cs-library-filters" data-spot="library.search">
          <label className="cs-search-input"><Search size={15} aria-hidden="true" /><input aria-label="Search content assets" placeholder="Search files, trends and runs" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" className="cs-search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></button>}</label>
          <div className="cs-library-selects"><select aria-label="Asset type" value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option>{typeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><select aria-label="Channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">All channels</option>{channelOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="any">Any status</option>{[['draft', 'Draft'], ['in-review', 'In review'], ['approved', 'Approved'], ['scheduled', 'Scheduled'], ['published', 'Published']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        </div>
        <ul className="cs-tree" role="tree" aria-label="Library folders" data-spot="library.tree" onKeyDown={onTreeKey}>
          <li role="treeitem" data-node={TREE_ROOT} ref={treeRef(TREE_ROOT)} aria-level={1} aria-selected={!folderId} tabIndex={tabStop === TREE_ROOT ? 0 : -1} onFocus={focusHere(TREE_ROOT)} onClick={() => openFolder(TREE_ROOT)}><span className="cs-tree-row" style={{ '--depth': 0 }}><span className="cs-tree-toggle" aria-hidden="true" /><Layers3 size={14} aria-hidden="true" /><span className="cs-tree-title">Library</span><small><span className="sr-only">, </span>{number(filter.active ? filter.items.length : files)}<span className="sr-only">{filter.active ? ' matches' : ' files'}</span></small></span></li>
          {tree.roots.map((id) => treeItem(id, 1))}
        </ul>
      </section>
      <div className="cs-library-main">
        <section className="cs-panel cs-library-folder" aria-label={filter.active ? 'Search results' : 'Folder'}>{filter.active ? results : folderView}</section>
        {selected && <section ref={previewRef} className="cs-panel cs-asset-preview" aria-label="Asset preview"><div className="cs-asset-head"><div className="cs-panel-title"><div><span className="cs-eyebrow">{selected.label || TYPE_LABEL[selected.type]}</span><h3>{selected.title}</h3>{where && <small className="cs-asset-where">{where}</small>}</div>{selected.source === 'studio' && <AssetStatusMenu api={api} asset={assetOf(selected) || selected} align="end" onNotice={onNotice} />}</div>
          <div className="cs-asset-tools">{selected.source === 'help' ? (typeof api.saveHelpImage === 'function' && can('saveHelpImage') && <Button type="button" className="cs-quiet" disabled={disabled || loading} onClick={() => savePicture(selected)}><Download size={14} />Save picture</Button>) : <>{shareLink && <Button type="button" className="cs-quiet" onClick={copyLink}><Link2 size={14} aria-hidden="true" />Copy link</Button>}<Button type="button" className="cs-quiet" disabled={disabled || loading} onClick={() => action('Opening asset', () => api.openStudioAsset({ assetId: selected.id }))}><FolderOpen size={14} />Open file</Button>{can('exportStudioRun') && <Button type="button" className="cs-quiet" disabled={disabled || !selected.runId} onClick={() => action('Exporting asset pack', () => api.exportStudioRun({ runId: selected.runId }), 'Run exported with source metadata and a manifest.')}><Download size={14} />Export pack</Button>}{selected.kitRunId && can('saveAssetKitFolder') && <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => saveFolder(selected.kitRunId)}><FolderOpen size={14} />Save folder</Button>}{selected.kind !== 'image' && onUseAsset && <Button type="button" className="cs-quiet" disabled={disabled || loading} onClick={() => onUseAsset(selected.asset)}>Create from this<ArrowRight size={14} /></Button>}</>}</div></div>
          {loading ? <div className="cs-preview-loading" role="status"><LoaderCircle className="spin" size={22} />Loading saved output…</div> : readError ? <div className="cs-alert" role="alert">{readError}</div> : selected.kind === 'image' ? imageUrl ? <figure className="cs-generated-image"><img src={imageUrl} alt={payload?.asset?.altText || selected.title || 'Generated campaign visual'} /><figcaption>{selected.source === 'help' ? `Made in Ask AI${selected.prompt ? ` · ${selected.prompt}` : ''}` : `Generated image · Review visual claims and brand fit before use.${generationReceipt?.model ? ` Model: ${generationReceipt.model}.` : ''}`}</figcaption></figure> : <EmptyState icon={ImageIcon} title="Image preview is unavailable" detail="The saved file may still be available through Open file. No placeholder image is substituted." /> : markdown ? <><MarkdownContent>{markdown}</MarkdownContent>{selected.source === 'studio' && <HowItWasMade asset={assetOf(selected) || selected} studio={studio} api={api} onOpenPrompt={onOpenPrompt} />}</> : <EmptyState icon={FileText} title="No readable content was returned" detail="Open the saved file or review the run’s output status." />}{generationReceipt && <details className="cs-details"><summary>Generation receipt</summary><dl className="cs-receipt">{Object.entries(generationReceipt).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => <React.Fragment key={key}><dt>{readable(key)}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl></details>}</section>}
      </div>
    </div>}
  </div>;
}

function BrandKnowledge({ workspace, pageHeading = false, grouped = pageHeading, editions, api, action, disabled, onSaved }) {
  const [draft, setDraft] = useState(() => workspace ? { ...clone(workspace), knowledge: { ...emptyWorkspace().knowledge, ...workspace.knowledge }, products: clone(list(workspace.products)) } : emptyWorkspace());
  const [error, setError] = useState('');
  // A registry import replaces the products; keep the form in step so saving never restores a stale list.
  const productsVersion = JSON.stringify(list(workspace?.products));
  useEffect(() => { if (workspace) setDraft((current) => ({ ...current, products: clone(list(workspace.products)) })); }, [productsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  function knowledge(key, value) { setDraft((current) => ({ ...current, knowledge: { ...current.knowledge, [key]: value } })); }
  function product(index, key, value) { setDraft((current) => ({ ...current, products: current.products.map((item, i) => i === index ? { ...item, [key]: value } : item) })); }
  // Products collapse to one summary row each; new or incomplete ones open so they can be finished.
  const [openProducts, setOpenProducts] = useState(() => new Set());
  const productKey = (item, index) => item.id || `product-index-${index}`;
  const setProductOpen = (key, open) => setOpenProducts((current) => { if (current.has(key) === open) return current; const next = new Set(current); if (open) next.add(key); else next.delete(key); return next; });
  async function save(event) {
    event.preventDefault(); setError('');
    if (!draft.name.trim()) { setError('Name this workspace.'); return; }
    if (draft.products.some((item) => !text(item.name).trim())) { draft.products.forEach((item, index) => { if (!text(item.name).trim()) setProductOpen(productKey(item, index), true); }); setError('Name every product, or remove unfinished records.'); return; }
    const result = await action('Saving brand knowledge', () => api.saveContentWorkspace({ id: draft.id, name: draft.name.trim(), editionId: draft.editionId, knowledge: { ...draft.knowledge, name: draft.name.trim(), editionId: draft.editionId }, products: draft.products.map((item) => ({ ...item, capabilities: Array.isArray(item.capabilities) ? item.capabilities : split(item.capabilities), tools: Array.isArray(item.tools) ? item.tools : split(item.tools) })) }), 'Brand knowledge and product registry saved.');
    if (result) onSaved();
  }
  return <div className="cs-knowledge"><SectionHeading page={pageHeading} title="Brand knowledge" detail="Give every research brief and draft the same clear, approved context." /><form className="cs-knowledge-form" onSubmit={save} onInvalidCapture={(event) => { const row = event.target.closest?.('details.cs-product-record'); if (row && !row.open) row.open = true; }}><fieldset disabled={disabled}><section className="cs-panel"><div className="cs-panel-title"><div><h3>{workspace ? 'Workspace identity' : 'Create a workspace'}</h3><p>Knowledge and assets stay scoped to this workspace.</p></div><span className="cs-mini-icon"><BookOpen size={21} /></span></div><div className="cs-two-fields"><Field id="cs-workspace-name" label="Workspace name"><input id="cs-workspace-name" value={draft.name} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Your team or client" required /></Field><Field id="cs-workspace-edition" label="Edition" hint={workspace ? "Edition is fixed for an existing workspace. Create another workspace for a different edition." : "Controls the available channel families and editorial policies."}><select id="cs-workspace-edition" disabled={Boolean(workspace)} value={draft.editionId} onChange={(event) => setDraft((current) => ({ ...current, editionId: event.target.value }))}>{(editions.length ? editions : [{ id: 'general', label: 'General studio' }, { id: 'semrush', label: 'Semrush workspace' }]).map((edition) => <option key={edition.id} value={edition.id}>{edition.label}</option>)}</select></Field></div></section>
    <section className="cs-panel"><div className="cs-panel-title"><div><h3>The context behind good content</h3><p>Plain language works best. Be specific about the people, value, and claims that matter.</p></div></div>{(grouped ? [{ title: 'Audience & positioning', detail: 'Who you help, and why your brand matters.', keys: ['audience', 'positioning', 'icp'] }, { title: 'Voice & editorial guardrails', detail: 'Keep the writing consistent and the claims grounded.', keys: ['voice', 'editorialRules', 'forbiddenClaims'] }, { title: 'Product context', detail: 'Connect approved products to real customer needs.', keys: ['productContext'] }] : [{ keys: KNOWLEDGE_FIELDS.map(([key]) => key) }]).map((group, index) => <div className={grouped ? 'cs-knowledge-group' : ''} key={index}>{group.title && <div className="cs-knowledge-group-heading"><span aria-hidden="true">0{index + 1}</span><div><h4>{group.title}</h4><p>{group.detail}</p></div></div>}<div className="cs-knowledge-grid">{KNOWLEDGE_FIELDS.filter(([key]) => group.keys.includes(key)).map(([key, label, placeholder]) => <Field key={key} id={`cs-knowledge-${key}`} label={label}><textarea id={`cs-knowledge-${key}`} rows={key === 'voice' || key === 'editorialRules' ? 4 : 3} maxLength={20000} value={draft.knowledge[key] || ''} onChange={(event) => knowledge(key, event.target.value)} placeholder={placeholder} /></Field>)}</div></div>)}</section>
    <section className="cs-panel"><div className="cs-panel-title"><div><h3>Approved product registry</h3><p>Writers can only use the capabilities and product fits you actually provide.</p></div><Button type="button" className="cs-quiet" onClick={() => { const id = `product-${Date.now()}-${draft.products.length}`; setProductOpen(id, true); setDraft((current) => ({ ...current, products: [...current.products, { id, name: '', url: '', segment: 'general', affiliateEligible: false, description: '', capabilities: [], tools: [] }] })); }}><Plus size={14} />Add product</Button></div>{draft.products.length ? <div className="cs-product-list">{draft.products.map((item, index) => { const key = productKey(item, index); const lines = (value) => (Array.isArray(value) ? value : String(value || '').split('\n')).filter((entry) => (typeof entry === 'string' ? entry.trim() : entry)).length; const host = (() => { try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })(); return <details className="cs-product-record" key={key} open={openProducts.has(key)} onToggle={(event) => setProductOpen(key, event.currentTarget.open)}><summary className="cs-product-summary"><span className="cs-product-summary-main"><strong>{text(item.name).trim() || 'New product'}</strong><small>{[{ enterprise: 'Enterprise', 'self-serve': 'Self-serve / PLG' }[item.segment] || 'General', host, lines(item.capabilities) ? plural(lines(item.capabilities), 'capability', 'capabilities') : '', lines(item.tools) ? plural(lines(item.tools), 'tool') : ''].filter(Boolean).join(' · ')}</small></span>{item.affiliateEligible && <span className="cs-product-flag">Affiliate</span>}<ChevronDown size={15} className="cs-product-chevron" aria-hidden="true" /></summary><div className="cs-product-body"><div className="cs-three-fields"><Field id={`cs-product-name-${index}`} label="Product name"><input id={`cs-product-name-${index}`} value={item.name || ''} onChange={(event) => product(index, 'name', event.target.value)} /></Field><Field id={`cs-product-url-${index}`} label="Approved product URL"><input id={`cs-product-url-${index}`} type="url" value={item.url || ''} onChange={(event) => product(index, 'url', event.target.value)} placeholder="https://…" /></Field><Field id={`cs-product-segment-${index}`} label="Product segment"><select id={`cs-product-segment-${index}`} value={item.segment || 'general'} onChange={(event) => product(index, 'segment', event.target.value)}><option value="general">General</option><option value="enterprise">Enterprise</option><option value="self-serve">Self-serve / PLG</option></select></Field></div><Field id={`cs-product-description-${index}`} label="What it does"><textarea id={`cs-product-description-${index}`} rows={2} value={item.description || ''} onChange={(event) => product(index, 'description', event.target.value)} /></Field><div className="cs-two-fields"><Field id={`cs-product-capabilities-${index}`} label="Supported capabilities" hint="One verified capability per line."><textarea id={`cs-product-capabilities-${index}`} rows={3} value={Array.isArray(item.capabilities) ? item.capabilities.join('\n') : item.capabilities || ''} onChange={(event) => product(index, 'capabilities', event.target.value)} /></Field><Field id={`cs-product-tools-${index}`} label="Approved tools" hint="One tool name per line."><textarea id={`cs-product-tools-${index}`} rows={3} value={Array.isArray(item.tools) ? item.tools.map((tool) => typeof tool === 'string' ? tool : tool.name).join('\n') : item.tools || ''} onChange={(event) => product(index, 'tools', event.target.value)} /></Field></div><label className="cs-check"><input type="checkbox" checked={Boolean(item.affiliateEligible)} onChange={(event) => product(index, 'affiliateEligible', event.target.checked)} /><span>Approved for affiliate use<small>Only self-serve products should be eligible for affiliate content.</small></span></label><div className="cs-product-record-foot"><Button type="button" className="cs-quiet" aria-label={`Remove product ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, products: current.products.filter((_, i) => i !== index) }))}><X size={13} />Remove product</Button></div></div></details>; })}</div> : <div className="cs-inline-empty">No products yet. Without approved facts, product claims and recommendations must remain a stated gap.</div>}</section>
    {error && <div className="cs-alert" role="alert">{error}</div>}<div className="cs-knowledge-save"><p>Saved changes apply to new runs. Earlier runs retain their context.</p><Button type="submit"><Check size={15} />Save brand knowledge</Button></div></fieldset></form>{workspace && <ResearchKnowledge workspace={workspace} api={api} action={action} disabled={disabled} />}</div>;
}
