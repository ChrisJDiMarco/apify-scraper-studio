import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, Check, ClipboardCopy, Download, FileText, FolderOpen, Home, LoaderCircle, MessageCircle, Radar, Search, Settings2, Sparkles, TrendingUp, X } from 'lucide-react';
import { MarkdownContent } from './markdown-content.jsx';
import { HelpAssistant } from './help-assistant.jsx';
import { formatDate, number, withViewTransition } from './ui.jsx';
import { buildTrendBoard, generationPlan } from '../../shared/trend-board.js';
import semrushWordmark from './assets/semrush-2026-logo.svg';
import './simple-mode.css';

// Simple mode: the whole studio as four plain tabs. Home says what needs you, Reports reads what was written,
// Trends asks yes or no, and Ask AI answers anything and can start the work for you after you confirm.
// Everything else stays one click away in the classic layout (Settings → Layout).
const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'trends', label: 'Trends', icon: TrendingUp },
  { id: 'ask', label: 'Ask AI', icon: MessageCircle },
];
const ASK_STARTERS = [
  'What are the biggest trends right now?',
  'Find new trends for me',
  'Which trends still need my OK?',
  'How much does a research run cost?',
  'Why did my last run stop?',
  'Create a hero image for my latest trend',
];
// Ask AI page links that have a home in Simple mode; anything else opens in the classic layout.
const SIMPLE_PAGE = { overview: 'home', dashboard: 'home', library: 'reports', reports: 'reports', board: 'trends', settings: 'settings' };
const ACTIVE = new Set(['queued', 'running']);
const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '');
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
const readable = (value) => String(value || '').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; };
const textOf = (value) => (typeof value === 'string' ? value : '');
function reportMarkdown(payload = {}) {
  if (typeof payload.markdown === 'string') return payload.markdown;
  const output = payload.output;
  if (!output || typeof output !== 'object') return '';
  return [`# ${textOf(output.title)}`, textOf(output.summary), ...list(output.sections).map((section) => `## ${textOf(section.heading)}\n\n${textOf(section.body)}\n\n${list(section.items).map((item) => `- ${item.label ? `**${item.label}** — ` : ''}${textOf(item.text)}`).join('\n')}`)].filter(Boolean).join('\n\n');
}
function runLine(run) {
  if (run.status === 'queued') return 'Starting soon';
  if (run.message) return run.message;
  if (run.stage) return `${readable(run.stage)}…`;
  return 'Working…';
}

export function SimpleMode({ api, state, meta, busy, loading, notice, error, onDismiss, action, background = [], renderSettings, onOpenClassic }) {
  const [tab, setTab] = useState('home');
  const [seed, setSeed] = useState(null);
  const [reportId, setReportId] = useState('');
  const [pending, setPending] = useState({}); // trend decisions shown the instant they are made
  const web = meta?.runtime === 'web';
  const studio = state.contentStudio || {};
  const workspaces = list(studio.workspaces);
  const workspace = workspaces.find((item) => item.id === studio.activeWorkspaceId) || null;
  const semrush = workspace?.editionId === 'semrush';
  const mine = (row) => !workspace || !row.workspaceId || row.workspaceId === workspace.id;
  const programs = list(studio.programs).filter(mine);
  const reports = list(studio.assets).filter(mine).filter((asset) => asset.kind !== 'image').sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const researchRuns = useMemo(() => list(studio.researchRuns).filter(mine).map((run) => {
    const own = Object.entries(pending).filter(([key]) => key.startsWith(`${run.id}:`));
    if (!own.length || run.status !== 'awaiting-review') return run;
    const decisions = { ...(run.decisions || {}) };
    for (const [key, decision] of own) decisions[key.slice(run.id.length + 1)] = decision;
    return { ...run, decisions };
  }), [studio.researchRuns, pending, workspace?.id]);
  const board = useMemo(() => buildTrendBoard({ researchRuns, contentRuns: list(studio.contentRuns).filter(mine), assets: list(studio.assets).filter(mine), programs }), [researchRuns, studio.contentRuns, studio.assets, studio.programs]);
  const waiting = board.cards.filter((card) => card.stage === 'potential');
  const approved = board.cards.filter((card) => card.stage === 'approved' && card.canDecide);
  const liveRuns = [...list(studio.researchRuns), ...list(studio.contentRuns)].filter(mine).filter((run) => ACTIVE.has(run.status)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const needsSetup = !state.keys?.APIFY_API_TOKEN;
  const working = busy || background.length > 0 || liveRuns.length > 0;

  // Forget an optimistic decision once the saved state agrees with it.
  useEffect(() => {
    setPending((current) => Object.fromEntries(Object.entries(current).filter(([key, decision]) => {
      const run = list(studio.researchRuns).find((row) => key.startsWith(`${row.id}:`));
      return run && run.status === 'awaiting-review' && (run.decisions?.[key.slice(run.id.length + 1)] || 'pending') !== decision;
    })));
  }, [studio.researchRuns]);

  function go(next) { withViewTransition(() => setTab(next)); }
  function ask(text) { setSeed({ text, key: Date.now() }); go('ask'); }
  function openReport(id) { setReportId(id); go('reports'); }
  function openPage(page) { if (SIMPLE_PAGE[page]) go(SIMPLE_PAGE[page]); else onOpenClassic(page); }

  async function startResearch(program) {
    if (!program) { onOpenClassic('research'); return false; }
    const budgets = program.budgets || {};
    const cost = [budgets.collectionUsd != null && `collecting up to ${money(budgets.collectionUsd)}`, budgets.aiUsd != null && `AI up to ${money(budgets.aiUsd)}`].filter(Boolean).join(' and ');
    if (!window.confirm(`Look for new trends with “${program.name}”?${cost ? `\n\nThis spends ${cost}.` : ''} New trends will show up under Trends for your OK.`)) return false;
    const result = await action(() => api.startResearchRun({ programId: program.id, datasetIds: [] }), 'Research started. New trends will appear under Trends.');
    return result ? 'Research started. New trends will appear under Trends.' : false;
  }
  function decide(card, decision) {
    if (!card?.canDecide) return;
    const key = `${card.runId}:${card.themeId}`;
    withViewTransition(() => setPending((current) => ({ ...current, [key]: decision })));
    Promise.resolve(api.decideResearchTheme({ runId: card.runId, themeId: card.themeId, decision })).catch((failure) => {
      setPending((current) => { const next = { ...current }; delete next[key]; return next; });
      window.alert(failure?.message || 'That choice could not be saved. Try again.');
    });
  }
  async function writeReports() {
    const runIds = [...new Set(approved.map((card) => card.runId))];
    if (!runIds.length) return 'There are no approved trends waiting for reports.';
    const program = programs.find((row) => row.id === researchRuns.find((run) => run.id === runIds[0])?.programId);
    const ai = program?.budgets?.aiUsd;
    const undecided = runIds.reduce((sum, runId) => sum + generationPlan(board.cards, runId).undecided.length, 0);
    if (!window.confirm(`Write reports for ${plural(approved.length, 'approved trend')}?${ai != null ? `\n\nAI writing is capped at ${money(ai)} per research run.` : ''}${undecided ? `\n\n${plural(undecided, 'trend')} you haven’t decided on from the same run will be skipped.` : ''}`)) return false;
    for (const runId of runIds) {
      const plan = generationPlan(board.cards, runId);
      await action(async () => {
        await api.approveResearchThemes({ runId, themes: plan.approved.map((card) => card.themeId) });
        return api.continueResearchRun({ runId });
      }, `Writing reports for ${plural(approved.length, 'trend')}. They’ll appear under Reports when done.`);
    }
    return `Writing ${plural(approved.length, 'report')}. They’ll appear under Reports.`;
  }

  // Buttons Ask AI offers. Every one is confirmed here before anything runs.
  async function runAiAction(request) {
    const trend = (name) => waiting.find((card) => same(card.name, name));
    if (request.kind === 'start-research') {
      const program = programs.find((row) => same(row.name, request.target)) || (programs.length === 1 ? programs[0] : null);
      if (!program) throw new Error(`I couldn’t find a research program called “${request.target}”.`);
      return startResearch(program);
    }
    if (request.kind === 'approve-trend' || request.kind === 'pass-trend') {
      const card = trend(request.target);
      if (!card) throw new Error(`“${request.target}” isn’t waiting for your OK anymore.`);
      decide(card, request.kind === 'approve-trend' ? 'approved' : 'passed');
      return request.kind === 'approve-trend' ? `Approved “${card.name}”.` : `Skipped “${card.name}”.`;
    }
    if (request.kind === 'write-reports') return writeReports();
    if (request.kind === 'open-report') {
      const report = reports.find((row) => same(row.title, request.target));
      if (!report) throw new Error(`I couldn’t find a report called “${request.target}”.`);
      openReport(report.id);
      return 'Opened.';
    }
    throw new Error('That action isn’t available.');
  }

  const counts = { trends: waiting.length }; // only what needs the person, never totals
  return <div className={`simple-shell${web ? '' : ' is-desktop'}`} data-edition={semrush ? 'semrush' : 'general'}>
    <header className="simple-top">
      <div className="simple-brand">{semrush ? <img src={semrushWordmark} alt="Semrush" /> : <strong>scraper<span>studio</span></strong>}{workspace?.name && <span className="simple-workspace">{workspace.name}</span>}</div>
      <nav className="simple-tabs" aria-label="Main">{TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}><Icon size={17} aria-hidden="true" /><span>{label}</span>{counts[id] > 0 && <span className="simple-count" aria-label={`${counts[id]} new`}>{counts[id]}</span>}</button>)}</nav>
      <div className="simple-top-right">
        {working && <span className="simple-working" role="status"><LoaderCircle className="spin" size={14} aria-hidden="true" />{liveRuns.length ? `${plural(liveRuns.length, 'job')} running` : 'Working…'}</span>}
        <button type="button" className={`simple-icon${tab === 'settings' ? ' active' : ''}`} aria-label="Settings" title="Settings" onClick={() => go('settings')}><Settings2 size={18} /></button>
      </div>
    </header>
    {(error || notice) && <div className={`simple-toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button type="button" aria-label="Dismiss" onClick={onDismiss}><X size={15} /></button></div>}
    <main className={`simple-main simple-${tab}`}>
      {loading ? <div className="simple-loading" role="status"><LoaderCircle className="spin" size={26} aria-hidden="true" /><p>Opening your studio…</p></div>
        : tab === 'home' ? <SimpleHome workspace={workspace} needsSetup={needsSetup} waiting={waiting} approved={approved} reports={reports} liveRuns={liveRuns} programs={programs} busy={busy} onAsk={ask} onGo={go} onOpenReport={openReport} onStartResearch={startResearch} onWriteReports={writeReports} />
        : tab === 'reports' ? <SimpleReports api={api} web={web} reports={reports} selectedId={reportId} onSelect={setReportId} action={action} busy={busy} onAsk={ask} onFindTrends={() => go('trends')} />
        : tab === 'trends' ? <SimpleTrends board={board} waiting={waiting} approved={approved} programs={programs} busy={busy} onDecide={decide} onWriteReports={writeReports} onStartResearch={startResearch} onOpenReport={openReport} onOpenClassic={onOpenClassic} />
        : tab === 'settings' ? <div className="simple-settings"><button type="button" className="simple-back" onClick={() => go('home')}><ArrowLeft size={15} aria-hidden="true" />Back to Home</button>{renderSettings()}</div>
        : null}
      <div className="simple-ask-wrap" hidden={tab !== 'ask' || loading}>
        <HelpAssistant api={api} variant="page" open={tab === 'ask'} seed={seed} starters={ASK_STARTERS} imagesReady={Boolean(state.keys?.OPENAI_API_KEY)} page={{ id: 'simple-mode', label: 'Simple mode' }} onOpenPage={openPage} onOpenSettings={() => go('settings')} onAction={runAiAction} onClose={() => go('home')} />
      </div>
    </main>
  </div>;
}

function SimpleHome({ workspace, needsSetup, waiting, approved, reports, liveRuns, programs, busy, onAsk, onGo, onOpenReport, onStartResearch, onWriteReports }) {
  const [draft, setDraft] = useState('');
  const [programId, setProgramId] = useState('');
  const program = programs.find((row) => row.id === programId) || programs[0];
  const submit = (event) => { event.preventDefault(); if (draft.trim()) { onAsk(draft.trim()); setDraft(''); } };
  return <div className="simple-page">
    <section className="simple-hero">
      <h1>{greeting()}.</h1>
      <p>{workspace?.name ? `Here’s what’s happening in ${workspace.name}.` : 'Here’s what’s happening in your studio.'} Ask for anything below.</p>
      <form className="simple-ask" onSubmit={submit}>
        <Sparkles size={20} aria-hidden="true" />
        <input aria-label="Ask AI" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask anything, or tell me what to do…" />
        <button type="submit" disabled={!draft.trim()} aria-label="Ask"><ArrowUp size={18} /></button>
      </form>
      <div className="simple-chips">{['Summarize this week’s trends', 'Find new trends for me', 'What should I do next?'].map((text) => <button type="button" key={text} onClick={() => onAsk(text)}>{text}</button>)}</div>
    </section>

    {needsSetup && <button type="button" className="simple-setup" onClick={() => onGo('settings')}><span className="simple-setup-dot" aria-hidden="true" /><span><strong>Finish setup to start collecting</strong><small>Connect your Apify account in Settings. It takes about a minute.</small></span><ArrowRight size={16} aria-hidden="true" /></button>}

    <section className="simple-tiles" aria-label="What needs you">
      <button type="button" className={`simple-tile tone-purple${waiting.length ? ' has-news' : ''}`} onClick={() => onGo('trends')}>
        <span className="simple-tile-icon"><TrendingUp size={22} aria-hidden="true" /></span>
        <strong>{number(waiting.length || approved.length)}</strong>
        <span className="simple-tile-label">{waiting.length ? `${waiting.length === 1 ? 'trend needs' : 'trends need'} your OK` : approved.length ? `approved, ready for reports` : 'No trends waiting'}</span>
        <small>{waiting.length ? 'Say yes or skip, one tap each' : approved.length ? 'Write the reports when you’re ready' : 'New ones arrive after each research run'}<ArrowRight size={14} aria-hidden="true" /></small>
      </button>
      <button type="button" className="simple-tile tone-mint" onClick={() => onGo('reports')}>
        <span className="simple-tile-icon"><FileText size={22} aria-hidden="true" /></span>
        <strong>{number(reports.length)}</strong>
        <span className="simple-tile-label">{reports.length === 1 ? 'report to read' : 'reports to read'}</span>
        <small>{reports[0] ? `Latest: ${formatDate(reports[0].createdAt)}` : 'Reports appear here once written'}<ArrowRight size={14} aria-hidden="true" /></small>
      </button>
      <div className="simple-tile tone-ink">
        <span className="simple-tile-icon"><Radar size={22} aria-hidden="true" /></span>
        <span className="simple-tile-label big">Find new trends</span>
        {programs.length > 1 && <select aria-label="Research program" value={program?.id || ''} onChange={(event) => setProgramId(event.target.value)}>{programs.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        <small>{program ? (programs.length > 1 ? 'Pick what to research, then start' : `Runs “${program.name}”`) : 'Set up what to research first'}</small>
        {approved.length > 0 && !waiting.length
          ? <button type="button" className="simple-tile-action" disabled={busy} onClick={onWriteReports}>Write {plural(approved.length, 'report')}<ArrowRight size={15} aria-hidden="true" /></button>
          : <button type="button" className="simple-tile-action" disabled={busy || needsSetup} onClick={() => onStartResearch(program)}>{program ? 'Start research' : 'Set up research'}<ArrowRight size={15} aria-hidden="true" /></button>}
      </div>
    </section>

    {liveRuns.length > 0 && <section className="simple-section" aria-labelledby="simple-now">
      <h2 id="simple-now">Working right now</h2>
      <ul className="simple-live">{liveRuns.slice(0, 4).map((run) => <li key={run.id}><LoaderCircle className="spin" size={16} aria-hidden="true" /><span><strong>{run.title || 'Research run'}</strong><small>{runLine(run)}</small></span>{run.progress?.total > 0 && <span className="simple-progress" aria-label={`${run.progress.completed} of ${run.progress.total}`}><span style={{ width: `${Math.min(100, Math.round((run.progress.completed / run.progress.total) * 100))}%` }} /></span>}</li>)}</ul>
    </section>}

    <section className="simple-section" aria-labelledby="simple-latest">
      <div className="simple-section-head"><h2 id="simple-latest">Latest reports</h2>{reports.length > 3 && <button type="button" className="simple-link" onClick={() => onGo('reports')}>See all {number(reports.length)}<ArrowRight size={14} aria-hidden="true" /></button>}</div>
      {reports.length ? <div className="simple-report-cards">{reports.slice(0, 3).map((report) => <button type="button" key={report.id} onClick={() => onOpenReport(report.id)}><span className="simple-doc-icon"><FileText size={18} aria-hidden="true" /></span><strong>{report.title || 'Report'}</strong><small>{[report.channel || readable(report.deliverableId), formatDate(report.createdAt)].filter(Boolean).join(' · ')}</small><span className="simple-read">Read<ArrowRight size={14} aria-hidden="true" /></span></button>)}</div>
        : <div className="simple-empty"><FileText size={22} aria-hidden="true" /><p>No reports yet. Start research, approve the trends you like, and the reports land here.</p></div>}
    </section>
  </div>;
}

function SimpleReports({ api, web, reports, selectedId, onSelect, action, busy, onAsk, onFindTrends }) {
  const [query, setQuery] = useState('');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [copied, setCopied] = useState(false);
  const filtered = reports.filter((report) => !query.trim() || String(report.title || '').toLowerCase().includes(query.trim().toLowerCase()));
  const selected = reports.find((report) => report.id === selectedId) || null;
  useEffect(() => {
    if (!selected) { setPayload(null); return undefined; }
    let cancelled = false;
    setLoading(true); setReadError(''); setCopied(false);
    Promise.resolve().then(() => api.readStudioAsset({ assetId: selected.id })).then((result) => { if (!cancelled) { setPayload(result); setLoading(false); } }).catch((failure) => { if (!cancelled) { setReadError(failure?.message || 'This report could not be opened.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [selected?.id]);
  const markdown = payload ? reportMarkdown(payload) : '';
  async function copy() { try { await navigator.clipboard.writeText(markdown); setCopied(true); } catch { setCopied(false); } }

  if (!reports.length) return <div className="simple-page"><div className="simple-empty big"><FileText size={30} aria-hidden="true" /><h2>No reports yet</h2><p>Reports are written from the trends you approve. Head to Trends to say yes to a few.</p><button type="button" className="simple-primary" onClick={onFindTrends}>Go to Trends<ArrowRight size={15} aria-hidden="true" /></button></div></div>;
  if (selected) return <div className="simple-page simple-reader">
    <div className="simple-reader-bar">
      <button type="button" className="simple-back" onClick={() => onSelect('')}><ArrowLeft size={15} aria-hidden="true" />All reports</button>
      <div className="simple-reader-tools">
        <button type="button" disabled={!markdown} onClick={copy}>{copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy text'}</button>
        <button type="button" disabled={busy} onClick={() => action(() => api.openStudioAsset({ assetId: selected.id }), web ? 'Download started.' : '')}>{web ? <Download size={15} aria-hidden="true" /> : <FolderOpen size={15} aria-hidden="true" />}{web ? 'Download' : 'Open file'}</button>
        <button type="button" className="simple-primary" onClick={() => onAsk(`Help me turn the report “${selected.title}” into next steps for my team.`)}><Sparkles size={15} aria-hidden="true" />Ask AI</button>
      </div>
    </div>
    <article className="simple-doc">
      <small className="simple-doc-meta">{[selected.channel || readable(selected.deliverableId), formatDate(selected.createdAt)].filter(Boolean).join(' · ')}</small>
      {loading ? <div className="simple-loading" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" /><p>Opening the report…</p></div>
        : readError ? <p className="simple-error" role="alert">{readError}</p>
        : markdown ? <MarkdownContent>{markdown}</MarkdownContent>
        : <p className="simple-error">This report has no readable text. Try Open file.</p>}
    </article>
  </div>;
  return <div className="simple-page">
    <div className="simple-page-head"><div><h1>Reports</h1><p>{plural(reports.length, 'report')}, newest first. Tap one to read it.</p></div>
      <label className="simple-search"><Search size={16} aria-hidden="true" /><input aria-label="Search reports" placeholder="Search reports" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    {filtered.length ? <div className="simple-report-list">{filtered.map((report) => <button type="button" key={report.id} onClick={() => onSelect(report.id)}><span className="simple-doc-icon"><FileText size={18} aria-hidden="true" /></span><span><strong>{report.title || 'Report'}</strong><small>{[report.channel || readable(report.deliverableId), formatDate(report.createdAt)].filter(Boolean).join(' · ')}</small></span><ArrowRight size={16} aria-hidden="true" /></button>)}</div>
      : <div className="simple-empty"><p>No reports match “{query}”.</p></div>}
  </div>;
}

function SimpleTrends({ board, waiting, approved, programs, busy, onDecide, onWriteReports, onStartResearch, onOpenReport, onOpenClassic }) {
  const production = board.columns.production || [];
  const ready = board.columns.ready || [];
  const empty = !board.cards.length && !board.scouting.length;
  return <div className="simple-page">
    <div className="simple-page-head"><div><h1>Trends</h1><p>Research finds them. You decide which ones become reports.</p></div>
      <div className="simple-head-actions"><button type="button" className="simple-quiet" onClick={() => onOpenClassic('board')}>Full board</button><button type="button" className="simple-primary" disabled={busy} onClick={() => onStartResearch(programs[0])}><Radar size={15} aria-hidden="true" />Find new trends</button></div></div>

    {board.scouting.filter((scout) => ACTIVE.has(scout.status)).map((scout) => <div className="simple-scouting" key={scout.runId} role="status"><LoaderCircle className="spin" size={16} aria-hidden="true" /><span><strong>Looking for trends · {scout.title}</strong><small>{scout.stage === 'discovery' && scout.progress ? `Batch ${number(scout.progress.completed)} of ${number(scout.progress.total)}` : 'Collecting posts and conversations'}</small></span></div>)}

    {empty && <div className="simple-empty big"><TrendingUp size={30} aria-hidden="true" /><h2>No trends yet</h2><p>Start a research run. Every trend it finds shows up here for a simple yes or skip. Nothing is written or spent until you say yes.</p></div>}

    {waiting.length > 0 && <section className="simple-section" aria-labelledby="simple-waiting">
      <h2 id="simple-waiting">Needs your OK <span className="simple-pill">{waiting.length}</span></h2>
      <div className="simple-trend-grid">{waiting.map((card) => <article className="simple-trend" key={card.key} style={{ viewTransitionName: `simple-${card.key.replace(/[^a-zA-Z0-9_-]/g, '-')}` }}>
        <div className="simple-trend-meta">{card.priorityTier && <span className={`simple-tier tier-${card.priorityTier.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{readable(card.priorityTier.toLowerCase())}</span>}<span>{plural(card.evidenceCount, 'source')}</span>{card.platforms.length > 0 && <span>{card.platforms.map((platform) => ({ x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' }[platform] || platform)).join(' · ')}</span>}</div>
        <h3>{card.name}</h3>
        {card.description && <p>{card.description}</p>}
        <div className="simple-trend-actions"><button type="button" className="simple-yes" disabled={busy} onClick={() => onDecide(card, 'approved')}><Check size={16} aria-hidden="true" />Yes, use it</button><button type="button" className="simple-skip" disabled={busy} onClick={() => onDecide(card, 'passed')}>Skip</button></div>
      </article>)}</div>
    </section>}

    {approved.length > 0 && <div className="simple-ready-bar"><span><strong>{plural(approved.length, 'trend')} approved</strong><small>{approved.map((card) => card.name).slice(0, 3).join(' · ')}{approved.length > 3 ? ' …' : ''}</small></span><button type="button" className="simple-primary" disabled={busy} onClick={onWriteReports}>Write the reports<ArrowRight size={15} aria-hidden="true" /></button></div>}

    {production.length > 0 && <section className="simple-section" aria-labelledby="simple-writing">
      <h2 id="simple-writing">Being written</h2>
      <ul className="simple-live">{production.map((card) => <li key={card.key} className={card.needsAttention ? 'attention' : ''}>{card.needsAttention ? <X size={16} aria-hidden="true" /> : <LoaderCircle className="spin" size={16} aria-hidden="true" />}<span><strong>{card.name}</strong><small>{card.activity || 'Writing'}</small></span>{card.needsAttention && <button type="button" className="simple-link" onClick={() => onOpenClassic('research')}>See why<ArrowRight size={14} aria-hidden="true" /></button>}</li>)}</ul>
    </section>}

    {ready.length > 0 && <section className="simple-section" aria-labelledby="simple-done">
      <h2 id="simple-done">Ready to read</h2>
      <div className="simple-report-cards">{ready.map((card) => { const report = card.reportAssets?.find((asset) => asset.deliverableId === 'evidence-report') || card.reportAssets?.[0]; return <button type="button" key={card.key} disabled={!report} onClick={() => report && onOpenReport(report.id)}><span className="simple-doc-icon done"><Check size={18} aria-hidden="true" /></span><strong>{card.name}</strong><small>{plural(card.reportAssets?.length || 0, 'report')}</small><span className="simple-read">Read<ArrowRight size={14} aria-hidden="true" /></span></button>; })}</div>
    </section>}
  </div>;
}
