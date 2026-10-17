import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowUp, Check, CircleCheck, ClipboardCopy, ExternalLink, FileText, LoaderCircle, Megaphone, Radar, Rocket, Sparkles, TrendingUp, X } from 'lucide-react';
import { WhatChanged, DecidedBy, WhyItMatters, decisionOf, decidedLine } from './trend-pulse.jsx';
import { TrendYesButton, channelLabel, routingChannels } from './trend-decision-sheet.jsx';
import { copyText } from './role-screens.jsx';
import { adminNames, can as canCall, canRun as canRunCall, useViewer, writeProps } from './viewer.js';
import { number } from './ui.jsx';
import { buildTrendBoard } from '../../shared/trend-board.js';
import './weekly-briefing.css';

// Home in both layouts: what this week brought and what needs this person. Five cards, each from state the studio
// already pushes (plus readTrendHistory for What changed): Needs your OK, What changed, Ready for channels (with each
// channel's answer), Shipped (channels that used a trend, with links) and Working now. Copy briefing for Slack puts the
// same in Markdown on the clipboard. Nothing here spends: Yes and Skip only record a decision.
//
// onOpenTarget({ kind: 'trend'|'report'|'run'|'folder'|'page', id, page }) takes the person there; onDecide(card,
// decision) is the layout's Yes/Skip (optimistic in Simple); onAsk(text, context) opens Ask AI; onStartResearch(program)
// starts a research run behind the layout's cost confirmation.
const DAY = 86400000;
const ACTIVE = new Set(['queued', 'running']);
const list = (value) => (Array.isArray(value) ? value : []);
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : NaN; };
const plural = (count, word, many = `${word}s`) => `${number(count)} ${count === 1 ? word : many}`;
const quote = (value) => `“${String(value || '').trim()}”`;
const readable = (value) => String(value || '').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
const dayLabel = (date) => date.toLocaleDateString([], { month: 'short', day: 'numeric' });
const weekday = (value) => { const ms = time(value); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString([], { weekday: 'short' }) : ''; };
const webLink = (value) => (/^https?:\/\/\S+$/i.test(String(value || '').trim()) ? String(value).trim() : '');
const linkText = (link) => { try { const url = new URL(link); const text = `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`; return text.length > 40 ? `${text.slice(0, 39)}…` : text; } catch { return link; } };

// The week the briefing covers: since Monday. On a Monday it covers the week just gone, so a Monday meeting has
// something to talk about.
export function briefingWeek(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const lastWeek = monday.getTime() === today.getTime();
  const start = lastWeek ? new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7) : monday;
  return { start, startMs: start.getTime(), label: dayLabel(start), lastWeek };
}

// Everything the cards show, from the pushed state. Exported for the Slack copy and tests.
// `board` (optional) is the layout's own buildTrendBoard result, so a Yes it shows at once (optimistic) moves here too.
export function briefingData({ state = {}, viewer = {}, now = new Date(), board: given = null } = {}) {
  const studio = state.contentStudio || {};
  const workspace = list(studio.workspaces).find((row) => row.id === studio.activeWorkspaceId) || null;
  const mine = (row) => !workspace || !row?.workspaceId || row.workspaceId === workspace.id;
  const editionId = workspace?.editionId || 'general';
  const researchRuns = list(studio.researchRuns).filter(mine); const contentRuns = list(studio.contentRuns).filter(mine);
  const assets = list(studio.assets).filter(mine); const programs = list(studio.programs).filter(mine);
  const board = given || buildTrendBoard({ researchRuns, contentRuns, assets, programs });
  const week = briefingWeek(now); const inWeek = (value) => time(value) >= week.startMs && time(value) <= now.getTime() + 60000;
  const channels = routingChannels(editionId);
  const focus = list(viewer?.prefs?.focusChannels).filter((id) => channels.some((channel) => channel.id === id));
  const adoptions = studio.adoptionsByTheme || {};
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const waiting = board.cards.filter((card) => card.stage === 'potential' && card.canDecide);
  // Briefs that became ready this week: one per trend, the newest.
  const readyByTheme = new Map();
  for (const card of board.cards) {
    if (!list(card.reportAssets).length) continue;
    const readyAt = list(card.reportAssets).map((row) => assetById.get(row.id)?.createdAt).filter(Boolean).sort().at(-1) || card.discoveredAt;
    const previous = readyByTheme.get(card.themeId);
    if (!previous || time(readyAt) > time(previous.readyAt)) readyByTheme.set(card.themeId, { card, readyAt, by: decisionOf(researchRuns, card), report: list(card.reportAssets).find((row) => row.deliverableId === 'evidence-report') || card.reportAssets[0] });
  }
  const allReady = [...readyByTheme.values()].sort((a, b) => time(b.readyAt) - time(a.readyAt));
  const ready = allReady.filter((row) => inWeek(row.readyAt)).map((row) => {
    const routed = list(row.by?.channels); const answers = adoptions[row.card.themeId] || {};
    const offered = channels.filter((channel) => !routed.length || routed.includes(channel.id));
    const rows = channels.map((channel) => ({ ...channel, answer: answers[channel.id]?.status || '', link: webLink(answers[channel.id]?.link), offered: offered.includes(channel) }));
    return { ...row, routed, channels: rows, using: rows.filter((channel) => channel.answer === 'using'), quiet: rows.filter((channel) => channel.offered && !channel.answer) };
  });
  // "Ready for your channels": briefs open to the person's own channels, with those channels' answers.
  const forYou = focus.length ? allReady.filter((row) => { const routed = list(row.by?.channels); return focus.some((id) => !routed.length || routed.includes(id)); }).slice(0, 5).map((row) => ({ ...row, focus: focus.map((id) => ({ id, name: channelLabel(channels, id), answer: adoptions[row.card.themeId]?.[id]?.status || '' })) })) : [];
  // Shipped: channels that said they used a trend this week (with the link), and assets marked Published.
  const nameOf = (themeId) => readyByTheme.get(themeId)?.card.name || list(studio.themes).find((row) => row.id === themeId)?.name || 'a trend';
  const shipped = [];
  for (const [themeId, byChannel] of Object.entries(adoptions)) for (const [channelId, row] of Object.entries(byChannel || {})) if (row?.status === 'using' && inWeek(row.at)) shipped.push({ key: `${themeId}:${channelId}`, at: row.at, channel: row.channelName || channelLabel(channels, channelId), title: nameOf(themeId), link: webLink(row.link), themeId });
  for (const asset of assets) if (asset.review?.status === 'published' && inWeek(asset.review.at) && !shipped.some((row) => row.link && row.link === asset.review.link)) shipped.push({ key: `asset:${asset.id}`, at: asset.review.at, channel: asset.review.by?.name || 'Someone', verb: 'published', title: asset.title, link: webLink(asset.review.link), assetId: asset.id });
  shipped.sort((a, b) => time(b.at) - time(a.at));
  const live = [...researchRuns.map((run) => ({ ...run, runKind: 'research' })), ...contentRuns.map((run) => ({ ...run, runKind: 'content' }))].filter((run) => ACTIVE.has(run.status)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const latestRun = researchRuns.filter((run) => run.origin !== 'quick-scan' && list(run.discoveredThemes).length && inWeek(run.createdAt)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  return { workspace, editionId, board, week, channels, focus, waiting, ready, allReady, forYou, shipped, live, latestRun, programs, reportsEver: allReady.length };
}

// The briefing as Slack-flavored Markdown (*bold*, • bullets), for "Copy briefing for Slack".
export function briefingMarkdown(data, { changes = null } = {}) {
  const title = `*This week in ${data.workspace?.name || 'the studio'}* · week of ${data.week.label}`;
  const section = (heading, rows) => (rows.length ? [`*${heading}*`, ...rows.map((row) => `• ${row}`)].join('\n') : '');
  const changeRows = changes?.comparable ? [['New', changes.newTrends], ['Rising', changes.rising], ['Fading', changes.fading]].filter(([, rows]) => list(rows).length).map(([label, rows]) => `${label}: ${list(rows).slice(0, 5).map((row) => row.name).join(', ')}`) : [];
  const parts = [
    title,
    section(`Needs your OK (${data.waiting.length})`, data.waiting.slice(0, 8).map((card) => card.name)),
    section('What changed since the last research run', changeRows),
    section('Ready for channels', data.ready.map((row) => `${row.card.name}${row.using.length ? ` · Using: ${row.using.map((channel) => channel.short).join(', ')}` : ''}${row.quiet.length ? ` · No answer: ${row.quiet.length > 3 ? plural(row.quiet.length, 'channel') : row.quiet.map((channel) => channel.short).join(', ')}` : ''}${row.by?.note ? ` · Note: “${row.by.note}”` : ''}`)),
    section('Shipped', data.shipped.map((row) => `${row.channel} ${row.verb || 'used'} ${quote(row.title)}${row.link ? ` ${row.link}` : ''}`)),
    section('Working now', data.live.slice(0, 5).map((run) => `${run.kit ? 'Channel assets' : run.runKind === 'research' ? (run.origin === 'quick-scan' ? 'Quick scan' : 'Research run') : 'Writing'}: ${run.kit?.sourceTitle || run.title || 'Untitled'}`)),
  ].filter(Boolean);
  return parts.length > 1 ? parts.join('\n\n') : `${title}\n\nQuiet week so far. New trends show up here after the next research run.`;
}

export function WeeklyBriefing({ state = {}, viewer: viewerIn, api = {}, layout = 'simple', busy = false, board = null, now = null, onOpenTarget, onDecide, onDecideWithNote, onAsk, onOpenTracker, onStartResearch }) {
  const contextViewer = useViewer(); const viewer = viewerIn || contextViewer;
  const can = (method) => canCall(viewer, method); const canRun = (method) => canRunCall(viewer, method);
  const data = useMemo(() => briefingData({ state, viewer, now: now || new Date(), board }), [state.contentStudio, viewer, board, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const { workspace, week, channels, waiting, ready, forYou, shipped, live, latestRun, programs } = data;
  const askAdmin = adminNames(state, 'an admin');
  const needsSetup = state.keys && !state.keys.APIFY_API_TOKEN;
  const open = (target) => onOpenTarget?.(target);
  const [programId, setProgramId] = useState('');
  const program = programs.find((row) => row.id === programId) || [...programs].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0] || null;
  const [copied, setCopied] = useState('');
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');

  // What changed across research runs: read again when one of this workspace's research runs moves on.
  const historyOn = typeof api.readTrendHistory === 'function' && can('readTrendHistory');
  const [history, setHistory] = useState(undefined); const [historyError, setHistoryError] = useState('');
  const runsKey = list(state.contentStudio?.researchRuns).filter((run) => !workspace || run.workspaceId === workspace.id).map((run) => `${run.id}:${run.status || ''}:${run.stage || ''}:${list(run.reportRunIds).length}`).join('|');
  useEffect(() => {
    if (!historyOn) { setHistory(null); return undefined; }
    let cancelled = false;
    Promise.resolve().then(() => api.readTrendHistory({})).then((result) => { if (!cancelled) { setHistory(result || null); setHistoryError(''); } }, (failure) => { if (!cancelled) { setHistory(null); setHistoryError(failure?.message || 'Trend history couldn’t be read. It comes back after the next refresh.'); } });
    return () => { cancelled = true; };
  }, [historyOn, runsKey, workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const changes = history?.changes || null;
  const trendOf = useMemo(() => { const byTheme = new Map(); for (const trend of list(history?.trends)) for (const id of list(trend.themeIds)) if (!byTheme.has(id)) byTheme.set(id, trend); return (card) => byTheme.get(card.themeId) || null; }, [history]);

  const canDecide = can('decideResearchTheme');
  const decide = (card, decision) => {
    setProblem('');
    if (onDecide) { onDecide(card, decision); return; }
    if (!canRun('decideResearchTheme') || !api.decideResearchTheme) return;
    Promise.resolve(api.decideResearchTheme({ runId: card.runId, themeId: card.themeId, decision })).catch((failure) => setProblem(failure?.message || 'That choice could not be saved. Try again.'));
  };
  const decideWithNote = onDecideWithNote || (api.decideResearchTheme && canRun('decideResearchTheme') ? (card, choice) => api.decideResearchTheme({ runId: card.runId, themeId: card.themeId, decision: 'approved', note: choice.note, channels: choice.channels }) : undefined);
  const startResearch = can('startResearchRun') && onStartResearch && !needsSetup ? () => onStartResearch(program) : undefined;
  const quiet = !waiting.length && !ready.length && !shipped.length && !live.length && !forYou.length && !(changes?.comparable && (changes.counts?.new || changes.counts?.rising || changes.counts?.fading));
  async function copyBriefing() { const done = await copyText(briefingMarkdown(data, { changes })); setCopied(done ? 'Copied. Paste it into Slack.' : 'The briefing couldn’t be copied. Try again.'); setTimeout(() => setCopied(''), 2400); }
  function submit(event) { event.preventDefault(); const text = draft.trim(); if (!text || !onAsk || viewer.preview) return; onAsk(text, ''); setDraft(''); }
  const openTrend = (entry) => (entry?.reportAssetId ? open({ kind: 'report', id: entry.reportAssetId, page: 'reports' }) : open({ kind: 'trend', id: list(entry?.themeIds)[0] || entry?.trendId || '', page: 'trends' }));
  const linkButton = (link) => (api.openSourceUrl ? <button type="button" className="wb-link-chip" title={link} onClick={() => api.openSourceUrl(link)}><ExternalLink size={13} aria-hidden="true" /><span>{linkText(link)}</span></button> : <a className="wb-link-chip" href={link} target="_blank" rel="noreferrer" title={link}><ExternalLink size={13} aria-hidden="true" /><span>{linkText(link)}</span></a>);
  const subtitle = [`Week of ${week.label}${week.lastWeek ? ' (last week)' : ''}`, latestRun ? `since ${weekday(latestRun.createdAt)}’s research run` : ''].filter(Boolean).join(' · ');

  return <div className={`wb-page ${layout === 'simple' ? 'simple-page' : ''}`} data-layout={layout}>
    <header className="wb-head">
      <div><h1 id={layout === 'classic' ? 'content-studio-title' : undefined}>This week in {workspace?.name || 'your studio'}</h1><p>{subtitle}</p></div>
      <div className="wb-head-actions">
        <button type="button" className="wb-quiet" onClick={copyBriefing}>{copied && copied.startsWith('Copied') ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}Copy briefing for Slack</button>
        {can('startResearchRun') && onStartResearch && <span className="wb-research" data-spot="home.research">
          {programs.length > 1 && <select aria-label="Research program" value={program?.id || ''} onChange={(event) => setProgramId(event.target.value)}>{programs.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
          <button type="button" data-spot="home.start-research" className="wb-primary" title={needsSetup ? 'Connect Apify first' : undefined} {...writeProps(viewer, busy || needsSetup)} onClick={() => onStartResearch(program)}><Radar size={15} aria-hidden="true" />{program || !can('saveResearchProgram') ? 'Find new trends' : 'Set up research'}</button>
        </span>}
      </div>
    </header>
    <p className="wb-live-note" role="status" aria-live="polite">{copied}</p>
    {problem && <p className="wb-problem" role="alert">{problem}</p>}

    {needsSetup && (can('saveSettings')
      ? <button type="button" className="wb-setup" onClick={() => open({ kind: 'page', id: 'settings', page: 'settings' })}><span className="wb-setup-dot" aria-hidden="true" /><span><strong>Finish setup to start collecting</strong><small>Connect your Apify account in Settings. It takes about a minute.</small></span><ArrowRight size={16} aria-hidden="true" /></button>
      : <div className="wb-setup is-note" role="note"><span className="wb-setup-dot" aria-hidden="true" /><span><strong>Setup isn’t finished</strong><small>Ask {askAdmin} to connect Apify. Then research can start collecting.</small></span></div>)}

    {onAsk && layout === 'simple' && <form className="wb-ask" data-spot="home.ask" onSubmit={submit}>
      <Sparkles size={18} aria-hidden="true" />
      <input aria-label="Ask AI" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about this week, or tell me what to do…" />
      <button type="submit" aria-label="Ask" {...writeProps(viewer, !draft.trim())}><ArrowUp size={17} aria-hidden="true" /></button>
    </form>}

    {quiet && <section className="wb-quiet-week" aria-labelledby="wb-quiet-title">
      <CircleCheck size={26} aria-hidden="true" />
      <div><h2 id="wb-quiet-title">Quiet week so far.</h2><p>New trends show up here after the next research run. {can('decideResearchTheme') ? 'Say yes to the ones worth a report, then press Write reports: the trends report and editorial toolkit land in Reports.' : 'Editors approve them, and their reports land in Reports.'}</p></div>
      {startResearch && <button type="button" className="wb-primary" {...writeProps(viewer, busy)} onClick={startResearch}><Radar size={15} aria-hidden="true" />Start research</button>}
    </section>}

    <div className="wb-grid">
      {canDecide && <section className="wb-card wb-needs" aria-labelledby="wb-needs-title" data-spot="home.trends">
        <header className="wb-card-head"><span className="wb-icon tone-purple" aria-hidden="true"><TrendingUp size={17} /></span><h2 id="wb-needs-title">Needs your OK <span className="wb-count">{number(waiting.length)}</span></h2>{waiting.length > 3 && <button type="button" className="wb-link" onClick={() => open({ kind: 'page', id: 'trends', page: 'trends' })}>See all<ArrowRight size={14} aria-hidden="true" /></button>}</header>
        {waiting.length ? <ul className="wb-list">{waiting.slice(0, 3).map((card) => <li key={card.key} className="wb-trend">
          <div className="wb-trend-copy"><button type="button" className="wb-title-link" onClick={() => open({ kind: 'trend', id: card.themeId, page: 'trends' })}>{card.name}</button><WhyItMatters card={card} trend={trendOf(card)} onAsk={onAsk && can('askHelp') ? (text) => onAsk(text, '') : undefined} /></div>
          <div className="wb-trend-actions"><TrendYesButton card={card} channels={channels} className="wb-yes" size={14} disabled={busy} onDecide={decide} onDecideWithNote={decideWithNote} /><button type="button" className="wb-skip" aria-label={`Skip ${card.name}`} {...writeProps(viewer, busy)} onClick={() => decide(card, 'passed')}>Skip</button></div>
        </li>)}</ul> : <p className="wb-empty">Nothing needs your OK. New trends arrive after each research run.</p>}
      </section>}

      {historyOn && <div className="wb-changes" data-spot="home.changes"><WhatChanged changes={history === undefined ? undefined : changes} error={historyError} onOpenTrend={openTrend} onOpenTracker={onOpenTracker} onStartResearch={startResearch} limit={3} /></div>}

      <section className="wb-card wb-ready" aria-labelledby="wb-ready-title" data-spot="home.latest">
        <header className="wb-card-head"><span className="wb-icon tone-mint" aria-hidden="true"><FileText size={17} /></span><h2 id="wb-ready-title">Ready for channels <span className="wb-count">{number(ready.length)}</span></h2><button type="button" className="wb-link" data-spot="home.reports" onClick={() => open({ kind: 'page', id: 'reports', page: 'reports' })}>All reports<ArrowRight size={14} aria-hidden="true" /></button></header>
        {ready.length ? <ul className="wb-list">{ready.map((row) => <li key={row.card.themeId} className="wb-ready-row">
          <button type="button" className="wb-title-link" onClick={() => (row.report ? open({ kind: 'report', id: row.report.id, page: 'reports' }) : open({ kind: 'trend', id: row.card.themeId, page: 'trends' }))}>{row.card.name}</button>
          <DecidedBy by={row.by} decision="approved" channelName={(id) => channelLabel(channels, id)} />
          <ul className="wb-chips" aria-label={`Channel answers for ${row.card.name}`}>
            {row.channels.filter((channel) => channel.answer || (row.routed.length && channel.offered)).map((channel) => <li key={channel.id} className={`wb-chip ${channel.answer || 'none'}`} title={channel.name}>{channel.answer === 'using' ? <Check size={12} aria-hidden="true" /> : channel.answer === 'not-using' ? <X size={12} aria-hidden="true" /> : null}{channel.short}<span className="sr-only">: {channel.answer === 'using' ? 'using' : channel.answer === 'not-using' ? 'not for us' : 'no answer'}</span></li>)}
            {!row.routed.length && row.quiet.length > 0 && <li className="wb-chip none">{row.using.length || row.channels.some((channel) => channel.answer) ? `No answer from ${plural(row.quiet.length, 'channel')}` : `No answer yet from ${plural(row.quiet.length, 'channel')}`}</li>}
          </ul>
        </li>)}</ul> : <p className="wb-empty">{data.reportsEver ? 'No new briefs this week. Earlier ones are in Reports.' : 'No reports yet. Say yes to a trend on Trends, then press Write reports. Its trends report and editorial toolkit land here.'}</p>}
      </section>

      {forYou.length > 0 && <section className="wb-card wb-for-you" aria-labelledby="wb-for-you-title">
        <header className="wb-card-head"><span className="wb-icon tone-ink" aria-hidden="true"><Megaphone size={17} /></span><h2 id="wb-for-you-title">Ready for your channels</h2></header>
        <ul className="wb-list">{forYou.map((row) => <li key={row.card.themeId} className="wb-ready-row">
          <button type="button" className="wb-title-link" onClick={() => (row.report ? open({ kind: 'report', id: row.report.id, page: 'reports' }) : open({ kind: 'trend', id: row.card.themeId, page: 'trends' }))}>{row.card.name}</button>
          <ul className="wb-chips" aria-label={`Your channels for ${row.card.name}`}>{row.focus.map((channel) => <li key={channel.id} className={`wb-chip ${channel.answer || 'none'}`}>{channel.answer === 'using' ? <Check size={12} aria-hidden="true" /> : null}{channel.name}<span className="sr-only">: {channel.answer === 'using' ? 'using' : channel.answer === 'not-using' ? 'not for us' : 'no answer'}</span></li>)}</ul>
        </li>)}</ul>
      </section>}

      <section className="wb-card wb-shipped" aria-labelledby="wb-shipped-title">
        <header className="wb-card-head"><span className="wb-icon tone-mint" aria-hidden="true"><Rocket size={17} /></span><h2 id="wb-shipped-title">Shipped <span className="wb-count">{number(shipped.length)}</span></h2></header>
        {shipped.length ? <ul className="wb-list">{shipped.slice(0, 8).map((row) => <li key={row.key} className="wb-shipped-row"><span><strong>{row.channel}</strong> {row.verb || 'used'} {quote(row.title)}</span>{row.link ? linkButton(row.link) : <small className="wb-muted">No link yet</small>}</li>)}</ul>
          : <p className="wb-empty">Nothing shipped yet this week. When a channel says it’s using a trend, it shows here with the link.</p>}
      </section>

      {live.length > 0 && <section className="wb-card wb-working" aria-labelledby="wb-working-title" data-spot="home.working">
        <header className="wb-card-head"><span className="wb-icon tone-ink" aria-hidden="true"><LoaderCircle className="spin" size={17} /></span><h2 id="wb-working-title">Working now <span className="wb-count">{number(live.length)}</span></h2></header>
        <ul className="wb-list">{live.slice(0, 5).map((run) => { const progress = run.progress?.total > 0 ? Math.min(100, Math.round(((run.progress.completed ?? run.progress.done ?? 0) / run.progress.total) * 100)) : null; return <li key={run.id} className="wb-run">
          <button type="button" className="wb-title-link" onClick={() => open(run.kit ? { kind: 'folder', id: run.kit.sourceKey || '', page: 'assets' } : { kind: 'run', id: run.id, page: run.runKind === 'research' ? 'research' : 'create' })}>{run.kit ? `Channel assets · ${run.kit.sourceTitle || run.title}` : run.title || 'Research run'}</button>
          <small className="wb-muted">{run.status === 'queued' ? 'Starting soon' : run.message || (run.stage ? `${readable(run.stage)}…` : 'Working…')}</small>
          {progress !== null && <span className="wb-progress" role="progressbar" aria-label={`${run.title || 'Run'} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${Math.max(4, progress)}%` }} /></span>}
        </li>; })}</ul>
      </section>}
    </div>
  </div>;
}

// Used by tests and the Slack copy: "Approved by Riley · Oct 14" for a briefing row.
export const readyLine = (row) => decidedLine(row?.by, 'approved');
