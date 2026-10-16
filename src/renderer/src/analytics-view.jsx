import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Check, ChevronDown, ClipboardCopy, Download, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { DialogClose, copyText, trapTab, useNarrow, useToast } from './role-screens.jsx';
import { formatDay, formatTime, plural } from './viewer.js';
import { linkLabel, normalizeLink } from './channel-owner.jsx';
import './analytics-view.css';

// Analytics (admins): which trends the team approved, and what each channel did with them. Three parts: a funnel
// from found to used, one row per channel, and a trends × channels table of answers. Windows count UTC days.
const RANGES = [7, 30, 90, 365];
const list = (value) => (Array.isArray(value) ? value : []);
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const DECISION = { approved: ['Approved', 'using'], passed: ['Passed', 'not-using'], pending: ['Not decided yet', 'generated'] };
const STATUS_TEXT = { using: 'Using', 'not-using': 'Not for us', generated: 'Drafts made, no answer yet', none: 'No answer yet' };
const quoteJoin = (names) => { const rows = names.map((name) => `“${name}”`); return rows.length <= 1 ? rows[0] || '' : `${rows.slice(0, -1).join(', ')} and ${rows[rows.length - 1]}`; };
const monthKey = (trend) => String(trend.readyAt || trend.firstDetectedAt || '').slice(0, 7) || 'undated';
const monthLabel = (key) => (key === 'undated' ? 'No date' : new Date(`${key}-01T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }));

// One channel's answer in words, for the cell's accessible name: "Semrush Blog: using, link added, by Alex, Oct 12".
export function cellLabel(channel, cell = {}) {
  const status = cell.status || 'none';
  const words = status === 'using' ? 'using' : status === 'not-using' ? 'not for us' : status === 'generated' ? 'drafts made, no answer yet' : cell.offered === false ? (list(channel.owners).length ? 'from before the owner joined' : 'no owner yet') : 'no answer yet';
  return [`${channel.name}: ${words}`, cell.link ? 'link added' : '', cell.byName ? `by ${cell.byName}` : '', cell.at ? formatDay(cell.at) : ''].filter(Boolean).join(', ');
}

// CSV: one row per trend × channel. A cell that starts like a formula gets a leading apostrophe so a spreadsheet
// shows it as text (channel owners type the links and notes).
export function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function analyticsCsv(data) {
  const channels = list(data?.channels);
  const header = ['Trend', 'Decision', 'Decided by', 'Decided at', 'Brief ready', 'Channel', 'Answer', 'Link', 'Answered by', 'Answered at', 'Drafts made', 'Offered to the channel'];
  const rows = list(data?.trends).flatMap((trend) => channels.map((channel) => {
    const cell = trend.cells?.[channel.id] || {};
    return [trend.name, DECISION[trend.decision]?.[0] || trend.decision || '', trend.decidedBy?.name || '', trend.decidedBy?.at || '', trend.readyAt || '', channel.name, STATUS_TEXT[cell.status || 'none'], cell.link || '', cell.byName || '', cell.at || '', Number(cell.assetCount) || 0, cell.offered === false ? 'No' : 'Yes'];
  }));
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
export const csvFileName = (data) => `${String(data?.workspace?.name || 'Studio').replace(/[\\/:*?"<>|]+/g, '-').trim()} trend analytics ${String(data?.generatedAt || new Date().toISOString()).slice(0, 10)}.csv`;
function download(text, name) {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.style.display = 'none';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

// Trends still waiting on a channel: offered to it, brief ready, and no answer yet.
export function waitingFor(data, channelId) {
  return list(data?.trends).filter((trend) => trend.ready !== false && trend.readyAt && trend.cells?.[channelId]?.offered !== false && ['none', 'generated'].includes(trend.cells?.[channelId]?.status || 'none'));
}
export function reminderText(data, channel, origin = '') {
  const names = waitingFor(data, channel.id).map((trend) => trend.name);
  if (!names.length) return '';
  const listed = names.length > 5 ? `${names.slice(0, 5).map((name) => `“${name}”`).join(', ')} and ${names.length - 5} more` : quoteJoin(names);
  return `${names.length} ${names.length === 1 ? 'trend is' : 'trends are'} waiting for ${channel.name}: ${listed}.${origin ? ` ${origin}` : ''}`;
}

function StackBar({ row }) {
  if (row.noAnswer == null) return <span className="analytics-bar-empty">No owner yet, so nothing was offered</span>;
  const offered = Math.max(0, Number(row.offered) || 0);
  const parts = [['using', row.using, 'Using'], ['generated', row.generatedOnly, 'Drafts made'], ['not-using', row.notUsing, 'Not for us'], ['none', row.noAnswer, 'No answer']].map(([status, value, label]) => ({ status, value: Number(value) || 0, label }));
  return <div className="analytics-bar-wrap">
    <div className="analytics-bar" role="img" aria-label={offered ? parts.map((part) => `${part.label} ${part.value}`).join(', ') : 'Nothing offered yet'}>{offered ? parts.filter((part) => part.value > 0).map((part) => <span key={part.status} className={`status-${part.status}`} style={{ width: `${(part.value / offered) * 100}%` }} />) : null}</div>
    <small>{offered ? `${row.using} of ${offered} used` : 'Nothing offered yet'}</small>
  </div>;
}

function CellIcon({ cell }) {
  const status = cell?.status || 'none';
  if (status === 'using') return <><Check size={15} strokeWidth={2.4} aria-hidden="true" />{cell.link && <span className="analytics-link-dot" aria-hidden="true" />}</>;
  if (status === 'not-using') return <X size={14} strokeWidth={2.4} aria-hidden="true" />;
  if (status === 'generated') return <span className="analytics-dot" aria-hidden="true" />;
  return null;
}
function CellButton({ trend, channel, open, onOpen }) {
  const cell = trend.cells?.[channel.id] || { status: 'none' };
  return <button type="button" className={`analytics-cell status-${cell.status || 'none'}${cell.offered === false ? ' not-offered' : ''}`} aria-label={cellLabel(channel, cell)} aria-haspopup="dialog" aria-expanded={open} onClick={(event) => onOpen(trend, channel, event.currentTarget)}><CellIcon cell={cell} /></button>;
}

// One cell's detail: the link, who answered and when, and for admins a way to correct the answer.
function CellPopover({ api, open, admin, narrow = false, onClose, onChanged }) {
  const { trend, channel, anchor } = open;
  const cell = trend.cells?.[channel.id] || { status: 'none' };
  const panel = useRef(null);
  const titleId = useId();
  const [status, setStatus] = useState(cell.status === 'using' || cell.status === 'not-using' ? cell.status : '');
  const [link, setLink] = useState(cell.link || '');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    const box = anchor?.getBoundingClientRect?.(); const width = Math.min(340, window.innerWidth - 24);
    if (!box) { setPlace(null); return; }
    const left = Math.min(Math.max(12, box.left + box.width / 2 - width / 2), window.innerWidth - width - 12);
    setPlace(box.bottom + 330 < window.innerHeight ? { top: box.bottom + 8, left, width } : { bottom: Math.max(12, window.innerHeight - box.top + 8), left, width });
  }, [anchor]);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const away = (event) => { if (!panel.current?.contains(event.target) && !anchor?.contains?.(event.target)) onClose(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  async function save() {
    let value = '';
    if (status === 'using' && link.trim()) { value = normalizeLink(link); if (!value) { setProblem('That doesn’t look like a web link.'); return; } }
    setSaving(true); setProblem('');
    try { await api.setTrendAdoption({ themeId: trend.themeId, channelId: channel.id, status: status || 'clear', link: status === 'using' ? value : '', note: '' }); setSaving(false); onChanged(`${channel.name} ${status === 'using' ? 'is using' : status === 'not-using' ? 'isn’t using' : 'has no answer for'} “${trend.name}” now.`); }
    catch (failure) { setSaving(false); setProblem(failure?.message || 'That answer couldn’t be changed. Try again.'); }
  }
  const changed = status !== (cell.status === 'using' || cell.status === 'not-using' ? cell.status : '') || (status === 'using' && link.trim() !== (cell.link || ''));
  return <div ref={panel} className="analytics-popover" role="dialog" aria-labelledby={titleId} tabIndex={-1} style={narrow ? undefined : place || undefined}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); } else trapTab(event, panel.current); }}>
    <div className="analytics-popover-head"><div><small>{channel.name}</small><h3 id={titleId}>{trend.name}</h3></div><DialogClose onClose={() => onClose(true)} /></div>
    <p className={`studio-chip ${cell.status || 'none'}`}><CellIcon cell={cell} />{STATUS_TEXT[cell.status || 'none']}</p>
    {cell.offered === false && <p className="studio-hint">{list(channel.owners).length ? 'This trend was ready before the channel’s owner joined, so it doesn’t count against them.' : 'This channel has no owner yet.'}</p>}
    {cell.link && <button type="button" className="channel-link-chip analytics-popover-link" title={cell.link} onClick={() => api.openSourceUrl?.(cell.link)}><ExternalLink size={14} aria-hidden="true" /><span>{linkLabel(cell.link)}</span></button>}
    {(cell.byName || cell.at) && <p className="studio-hint">Answered{cell.byName ? ` by ${cell.byName}` : ''}{cell.at ? ` · ${formatDay(cell.at)}` : ''}</p>}
    {Number(cell.assetCount) > 0 && <p className="studio-hint">{plural(cell.assetCount, 'draft')} made for this channel.</p>}
    {admin && api.setTrendAdoption && <div className="analytics-change">
      <h4>Change answer</h4>
      <div className="studio-segment" role="radiogroup" aria-label={`Answer for ${channel.name}`}>
        {[['using', 'Using'], ['not-using', 'Not for us'], ['', 'Clear']].map(([value, text]) => <label key={text} className={status === value ? 'checked' : ''}><input type="radio" name={`${titleId}-answer`} checked={status === value} onChange={() => { setStatus(value); setProblem(''); }} />{text}</label>)}
      </div>
      {status === 'using' && <label className="studio-field"><span>Link <em>(optional)</em></span><input type="url" inputMode="url" placeholder="semrush.com/blog/…" value={link} onChange={(event) => { setLink(event.target.value); setProblem(''); }} /></label>}
      {problem && <p className="studio-error" role="alert">{problem}</p>}
      <p className="studio-hint">The change is logged with your name.</p>
      <button type="button" className="studio-primary small" disabled={saving || !changed} onClick={save}>{saving ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}{saving ? 'Saving…' : 'Save answer'}</button>
    </div>}
  </div>;
}

function MatrixTable({ data, months, openMonths, onToggle, openCell, onOpen, labelledBy }) {
  const channels = list(data.channels);
  return <div className="analytics-matrix-scroll" role="region" aria-labelledby={labelledBy} tabIndex={0}>
    <table className="analytics-matrix">
      <thead><tr><th scope="col" className="analytics-trend-col">Trend</th>{channels.map((channel) => <th key={channel.id} scope="col" title={channel.name} aria-label={channel.name}><span aria-hidden="true">{channel.short || channel.name}</span></th>)}</tr></thead>
      {months.map((month) => {
        const expanded = openMonths.has(month.key);
        return <tbody key={month.key}>
          <tr className="analytics-month"><th scope="colgroup" colSpan={channels.length + 1}><button type="button" className="analytics-month-toggle" aria-expanded={expanded} onClick={() => onToggle(month.key)}><ChevronDown size={15} className={expanded ? 'open' : ''} aria-hidden="true" />{month.label}<span className="studio-count">{month.rows.length}</span></button></th></tr>
          {expanded && month.rows.map((trend) => <tr key={trend.themeId}>
            <th scope="row" className="analytics-trend-col"><span className="analytics-trend"><strong>{trend.name}</strong><span className="analytics-trend-meta"><span className={`studio-chip ${DECISION[trend.decision]?.[1] || 'none'}`}>{DECISION[trend.decision]?.[0] || 'Not decided yet'}</span>{trend.decision !== 'pending' && <small>{trend.decidedBy ? `by ${trend.decidedBy.name}${trend.decidedBy.at ? ` · ${formatDay(trend.decidedBy.at)}` : ''}` : 'Decided by: Not recorded'}</small>}</span></span></th>
            {channels.map((channel) => <td key={channel.id}><CellButton trend={trend} channel={channel} open={openCell?.trend.themeId === trend.themeId && openCell?.channel.id === channel.id} onOpen={onOpen} /></td>)}
          </tr>)}
        </tbody>;
      })}
    </table>
  </div>;
}

function MatrixCards({ data, months, openMonths, onToggle, openCell, onOpen }) {
  const channels = list(data.channels);
  return <div className="analytics-cards">{months.map((month) => {
    const expanded = openMonths.has(month.key);
    return <section key={month.key} className="analytics-card-month" aria-label={month.label}>
      <button type="button" className="analytics-month-toggle" aria-expanded={expanded} onClick={() => onToggle(month.key)}><ChevronDown size={15} className={expanded ? 'open' : ''} aria-hidden="true" />{month.label}<span className="studio-count">{month.rows.length}</span></button>
      {expanded && month.rows.map((trend) => <article key={trend.themeId} className="analytics-card" aria-label={trend.name}>
        <strong>{trend.name}</strong>
        <span className="analytics-trend-meta"><span className={`studio-chip ${DECISION[trend.decision]?.[1] || 'none'}`}>{DECISION[trend.decision]?.[0] || 'Not decided yet'}</span>{trend.decision !== 'pending' && <small>{trend.decidedBy ? `by ${trend.decidedBy.name}` : 'Decided by: Not recorded'}</small>}</span>
        <ul className="analytics-strip">{channels.map((channel) => <li key={channel.id}><CellButton trend={trend} channel={channel} open={openCell?.trend.themeId === trend.themeId && openCell?.channel.id === channel.id} onOpen={onOpen} /><span aria-hidden="true">{channel.short || channel.name}</span></li>)}</ul>
      </article>)}
    </section>;
  })}</div>;
}

export function AnalyticsView({ api, viewer = {}, web = false }) {
  const [days, setDays] = useState(90);
  const [includeAll, setIncludeAll] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [openCell, setOpenCell] = useState(null);
  const [openMonths, setOpenMonths] = useState(() => new Set());
  const [copied, setCopied] = useState('');
  const [allRecent, setAllRecent] = useState(false);
  const [toast, showToast] = useToast();
  const narrow = useNarrow();
  const matrixTitle = useId();
  const available = typeof api?.getTrendAnalytics === 'function';
  const admin = (viewer.realRole || viewer.role || 'admin') === 'admin' && !viewer.preview;

  useEffect(() => {
    if (!available) { setLoading(false); return undefined; }
    let cancelled = false; setLoading(true); setError('');
    Promise.resolve().then(() => api.getTrendAnalytics({ days, includeAll })).then((result) => { if (!cancelled) { setData(result || null); setLoading(false); } }, (failure) => { if (!cancelled) { setError(failure?.message || 'Analytics couldn’t be loaded. Try again.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [days, includeAll, attempt]);

  const months = useMemo(() => {
    const groups = new Map();
    for (const trend of [...list(data?.trends)].sort((a, b) => String(b.readyAt || b.firstDetectedAt || '').localeCompare(String(a.readyAt || a.firstDetectedAt || '')))) { const key = monthKey(trend); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(trend); }
    return [...groups.entries()].map(([key, rows]) => ({ key, label: monthLabel(key), rows }));
  }, [data]);
  // The newest month opens; older months wait until asked for. Adjusted during render, not in an effect, so the table
  // never paints with every month shut first.
  const firstMonth = months[0]?.key || '';
  const [seenFirstMonth, setSeenFirstMonth] = useState('');
  if (firstMonth !== seenFirstMonth) { setSeenFirstMonth(firstMonth); if (!openMonths.size && firstMonth) setOpenMonths(new Set([firstMonth])); }
  const toggleMonth = (key) => setOpenMonths((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  function openPopover(trend, channel, anchor) { setOpenCell((current) => (current && current.trend.themeId === trend.themeId && current.channel.id === channel.id ? null : { trend, channel, anchor })); }
  function closePopover(refocus) { const anchor = openCell?.anchor; setOpenCell(null); if (refocus) anchor?.focus?.(); }
  async function copyReminder(channel) {
    const text = reminderText(data, channel, web && typeof location !== 'undefined' ? location.origin : '');
    if (!text) return;
    if (await copyText(text)) { setCopied(channel.id); setTimeout(() => setCopied((current) => (current === channel.id ? '' : current)), 1800); showToast(`Reminder for ${channel.name} copied. Paste it into Slack or an email.`); }
    else showToast('The reminder couldn’t be copied. Try again.', { tone: 'error' });
  }
  function downloadCsv() {
    if (!data) return;
    if (download(analyticsCsv(data), csvFileName(data))) showToast(web ? 'Download started.' : 'Choose where to save the CSV.');
    else showToast('The CSV couldn’t be made here. Try the browser studio.', { tone: 'error' });
  }

  if (!available) return <div className="studio-screen studio-page analytics-page"><div className="studio-page-head"><div><h1>Analytics</h1></div></div><div className="studio-empty"><p>Analytics isn’t available in this version of the studio.</p></div></div>;
  const totals = data?.totals || {};
  const byChannel = list(data?.byChannel);
  const recent = list(data?.recent);
  const channelInfo = (id) => list(data?.channels).find((channel) => channel.id === id) || { id, name: id, owners: [] };
  return <div className="studio-screen studio-page analytics-page" aria-busy={loading}>
    <div className="studio-page-head">
      <div><h1>Analytics</h1><p>{data?.workspace?.name ? `${data.workspace.name} · ` : ''}Which trends the team approved, and what each channel did with them. Briefs ready in the last {days} days (UTC).</p></div>
      <div className="studio-head-actions"><button type="button" className="studio-quiet" disabled={!data} onClick={downloadCsv}><Download size={15} aria-hidden="true" />Download CSV</button></div>
    </div>
    <div className="analytics-controls">
      <div className="studio-filters" role="group" aria-label="Range">{RANGES.map((value) => <button type="button" key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{value} days</button>)}</div>
      {loading && data && <span className="analytics-updating" role="status"><LoaderCircle className="spin" size={14} aria-hidden="true" />Updating…</span>}
    </div>

    {error && <div className="studio-empty" role="alert"><p>{error}</p><button type="button" className="studio-quiet small" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={14} aria-hidden="true" />Try again</button></div>}
    {!data && loading && !error && <div className="analytics-loading" role="status" aria-label="Loading analytics"><div className="analytics-funnel">{[0, 1, 2, 3, 4].map((n) => <span key={n} className="analytics-tile studio-shimmer" />)}</div><div className="studio-skeleton"><span /><span /><span /><span /></div></div>}

    {data && <>
      <ol className="analytics-funnel" aria-label="From trend to use">
        <li className="analytics-tile"><strong>{totals.trendsFound ?? 0}</strong><span>Trends found</span><small>In the last {days} days</small></li>
        <li className="analytics-tile"><strong>{totals.approved ?? 0}</strong><span>Approved</span><small>{totals.passed ?? 0} passed · {totals.pending ?? 0} not decided</small></li>
        <li className="analytics-tile"><strong>{totals.briefsReady ?? 0}</strong><span>Briefs ready</span><small>{plural(totals.assetsGenerated ?? 0, 'draft')} made from them</small></li>
        <li className="analytics-tile is-key"><strong>{totals.inUse ?? 0} of {totals.briefsReady ?? 0}</strong><span>In use by a channel</span><small>{percent(totals.inUse ?? 0, totals.briefsReady ?? 0)}% of ready briefs</small></li>
        <li className="analytics-tile"><strong>{totals.linksAdded ?? 0}</strong><span>Links added</span><small>Where channels used them</small></li>
      </ol>

      <section className="analytics-section" aria-labelledby="analytics-channels-title">
        <h2 id="analytics-channels-title" className="studio-section-title">Channels</h2>
        <div className="analytics-table-wrap">
          <table className="analytics-channels">
            <thead><tr><th scope="col">Channel</th><th scope="col">Answers</th><th scope="col">Last activity</th><th scope="col"><span className="sr-only">Reminder</span></th></tr></thead>
            <tbody>{byChannel.map((row) => {
              const channel = { ...channelInfo(row.id), ...row };
              const waiting = waitingFor(data, row.id).length;
              const owners = list(row.owners).length ? list(row.owners).map((owner) => owner.name).join(', ') : 'No owner yet';
              return <tr key={row.id}>
                <th scope="row"><span className="analytics-channel"><strong>{row.name}</strong><small>{owners}</small></span></th>
                <td><StackBar row={row} /></td>
                <td className="analytics-when">{row.lastActivityAt ? formatDay(row.lastActivityAt) : 'No activity yet'}</td>
                <td className="analytics-remind"><button type="button" className="studio-quiet small" aria-label={`Copy reminder for ${row.name}`} disabled={!waiting || !list(row.owners).length} title={!list(row.owners).length ? 'This channel has no owner yet.' : !waiting ? 'Nothing is waiting for this channel.' : `Copies a note listing ${plural(waiting, 'waiting trend')}`} onClick={() => copyReminder(channel)}>{copied === row.id ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}{copied === row.id ? 'Copied' : 'Copy reminder'}</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-section-head">
          <h2 id={matrixTitle} className="studio-section-title">Trends × channels</h2>
          <div className="studio-filters"><button type="button" aria-pressed={includeAll} onClick={() => { setIncludeAll((value) => !value); setOpenCell(null); }}>Show passed and pending</button></div>
        </div>
        <div className="analytics-legend" aria-hidden="true">{[['using', 'Using'], ['using has-link', 'Link added'], ['generated', 'Drafts made'], ['not-using', 'Not for us'], ['none', 'No answer']].map(([status, text]) => <span key={text}><span className={`analytics-cell is-key status-${status.split(' ')[0]}`}><CellIcon cell={{ status: status.split(' ')[0], link: status.includes('link') }} /></span>{text}</span>)}</div>
        {!months.length ? <div className="studio-empty"><BarChart3 size={24} aria-hidden="true" /><p>No trends in this range yet.</p>{days < 365 && <button type="button" className="studio-quiet small" onClick={() => setDays(365)}>Show the last 365 days<ArrowRight size={14} aria-hidden="true" /></button>}</div>
          : narrow ? <MatrixCards data={data} months={months} openMonths={openMonths} onToggle={toggleMonth} openCell={openCell} onOpen={openPopover} />
          : <MatrixTable data={data} months={months} openMonths={openMonths} onToggle={toggleMonth} openCell={openCell} onOpen={openPopover} labelledBy={matrixTitle} />}
      </section>

      <section className="analytics-section" aria-labelledby="analytics-recent-title">
        <h2 id="analytics-recent-title" className="studio-section-title">Recent activity</h2>
        {recent.length ? <ol className="analytics-recent">{(allRecent ? recent : recent.slice(0, 12)).map((row, index) => <li key={`${row.at}-${index}`}><span className="analytics-recent-dot" aria-hidden="true" /><span>{row.text}</span><time dateTime={row.at}>{[formatDay(row.at), formatTime(row.at)].filter(Boolean).join(', ')}</time></li>)}</ol>
          : <p className="studio-hint">Nothing yet. Decisions, answers and new drafts show up here.</p>}
        {recent.length > 12 && <button type="button" className="studio-link" onClick={() => setAllRecent((value) => !value)}>{allRecent ? 'Show fewer' : `Show all ${recent.length}`}</button>}
      </section>
    </>}
    {openCell && <CellPopover key={`${openCell.trend.themeId}:${openCell.channel.id}`} api={api} open={openCell} admin={admin} narrow={narrow} onClose={closePopover} onChanged={(text) => { closePopover(true); showToast(text); setAttempt((value) => value + 1); }} />}
    {toast}
  </div>;
}
