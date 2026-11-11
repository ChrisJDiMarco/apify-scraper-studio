import React, { useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, ClipboardCopy, Download, ExternalLink, LoaderCircle } from 'lucide-react';
import { copyText, useNarrow } from './role-screens.jsx';
import { useViewer, writeProps } from './viewer.js';
import { routingChannels } from './trend-decision-sheet.jsx';
import './calendar.css';

// The content calendar: when each channel plans to run a trend it said it's using ("Planned for <date>" after "Yes, I'm
// using this trend"). Calendar (admins and editors, mode 'team') is weeks × channels for the team; My plan (channel
// owners, mode 'channel') is the same for one channel, where trends in use without a date can get one. Download .ics
// gives a local file any calendar app opens, and Copy week as a table pastes into Sheets or Docs.
const WEEKS = 4;
const list = (value) => (Array.isArray(value) ? value : []);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (day) => new Date(`${day}T12:00:00`);
const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function mondayOf(date = new Date()) { const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()); day.setDate(day.getDate() - ((day.getDay() + 6) % 7)); return day; }
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const short = (date) => date.toLocaleDateString([], { month: 'short', day: 'numeric' });
const weekdayDate = (day) => asDate(day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const webLink = (value) => (/^https?:\/\/\S+$/i.test(String(value || '').trim()) ? String(value).trim() : '');

// Every "using" answer as a calendar entry: { key, themeId, trend, channelId, channel, plannedFor ('' when undated), link, byName, at }.
export function calendarEntries({ state = {}, mode = 'team' } = {}) {
  const studio = state.contentStudio || {};
  if (mode === 'channel') {
    const view = studio.channelView || {}; const channel = view.channel || {};
    return list(view.trends).filter((trend) => trend.adoption?.status === 'using').map((trend) => ({ key: `${trend.themeId}:${channel.id}`, themeId: trend.themeId, trend: trend.name, channelId: channel.id || '', channel: channel.name || 'Your channel', short: channel.short || channel.name || '', plannedFor: ISO_DAY.test(trend.adoption.plannedFor || '') ? trend.adoption.plannedFor : '', link: webLink(trend.adoption.link), note: trend.adoption.note || '', byName: trend.adoption.byName || '', at: trend.adoption.at || '', trendRef: trend }));
  }
  const workspace = list(studio.workspaces).find((row) => row.id === studio.activeWorkspaceId);
  const channels = routingChannels(workspace?.editionId || 'general');
  const names = new Map();
  for (const run of list(studio.researchRuns)) for (const theme of [...list(run.discoveredThemes), ...list(run.themes)]) if (theme?.id && theme.name) names.set(theme.id, theme.name);
  for (const theme of list(studio.themes)) if (theme?.id && theme.name && !names.has(theme.id)) names.set(theme.id, theme.name);
  const rows = [];
  for (const [themeId, byChannel] of Object.entries(studio.adoptionsByTheme || {})) for (const [channelId, row] of Object.entries(byChannel || {})) {
    if (row?.status !== 'using') continue;
    const channel = channels.find((entry) => entry.id === channelId);
    rows.push({ key: `${themeId}:${channelId}`, themeId, trend: names.get(themeId) || 'Untitled trend', channelId, channel: row.channelName || channel?.name || channelId, short: channel?.short || row.channelName || channelId, plannedFor: ISO_DAY.test(row.plannedFor || '') ? row.plannedFor : '', link: webLink(row.link), note: '', byName: row.byName || '', at: row.at || '' });
  }
  return rows;
}

// RFC 5545 text: backslash, semicolon, comma and newlines escaped; lines folded at 74 characters.
const icsText = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line) => { const parts = []; let rest = line; while (rest.length > 74) { parts.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; } parts.push(rest); return parts.join('\r\n'); };
const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// All-day events for planned entries, one per trend and channel.
export function icsFor(entries, { now = new Date(), name = 'Content calendar' } = {}) {
  const events = list(entries).filter((entry) => ISO_DAY.test(entry.plannedFor)).map((entry) => {
    const start = entry.plannedFor.replace(/-/g, ''); const end = dayKey(addDays(asDate(entry.plannedFor), 1)).replace(/-/g, '');
    return ['BEGIN:VEVENT', `UID:${icsText(`${entry.themeId}-${entry.channelId}`)}@scraper-studio`, `DTSTAMP:${stamp(now)}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${icsText(`${entry.short || entry.channel}: ${entry.trend}`)}`,
      `DESCRIPTION:${icsText([`${entry.channel} is using “${entry.trend}”.`, entry.note ? `Note: ${entry.note}` : '', entry.link ? `Link: ${entry.link}` : ''].filter(Boolean).join('\n'))}`, ...(entry.link ? [`URL:${icsText(entry.link)}`] : []), 'END:VEVENT'];
  });
  return `${['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Golden Thread//Content calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(name)}`, ...events.flat(), 'END:VCALENDAR'].map(fold).join('\r\n')}\r\n`;
}
// One week as a tab-separated table (pastes as a table into Google Sheets and Docs).
export function weekTable(entries, weekStart) {
  const from = dayKey(weekStart); const to = dayKey(addDays(weekStart, 6));
  const rows = list(entries).filter((entry) => entry.plannedFor >= from && entry.plannedFor <= to).sort((a, b) => a.plannedFor.localeCompare(b.plannedFor) || a.channel.localeCompare(b.channel));
  const cell = (value) => String(value || '').replace(/[\t\r\n]+/g, ' ');
  return [['Date', 'Channel', 'Trend', 'Link'], ...rows.map((entry) => [weekdayDate(entry.plannedFor), entry.channel, entry.trend, entry.link])].map((row) => row.map(cell).join('\t')).join('\n');
}
function download(text, name) {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.style.display = 'none';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

// Scheduled research on the calendar: for each week shown, the programs with a schedule turned on that run in it. The
// next run is exact (schedule.nextRunAt); later weeks are worked out from how often it runs, and a monthly program
// shows in the week holding its day. { [weekKey]: [{ key, name, when }] }
export function researchByWeek(programs, weeks) {
  const out = {};
  for (const week of list(weeks)) {
    const start = dayKey(week); const end = dayKey(addDays(week, 6)); const rows = [];
    for (const program of list(programs)) {
      const schedule = program?.schedule || {};
      if (!schedule.enabled || !schedule.frequency || schedule.frequency === 'manual') continue;
      const next = schedule.nextRunAt ? dayKey(new Date(schedule.nextRunAt)) : '';
      if (next && next > end) continue; // it hasn't started running by this week
      const time = schedule.time || '';
      let when = '';
      if (next && next >= start && next <= end) when = [schedule.frequency === 'daily' ? `Every day from ${weekdayDate(next)}` : weekdayDate(next), time].filter(Boolean).join(' · ');
      else if (!next || next < start) {
        if (schedule.frequency === 'daily') when = ['Every day', time].filter(Boolean).join(' · ');
        else if (schedule.frequency === 'weekly') when = [weekdayDate(dayKey(addDays(week, ((Number(schedule.weekday) || 0) + 6) % 7))), time].filter(Boolean).join(' · ');
        else if (schedule.frequency === 'monthly') { const wanted = Number(schedule.dayOfMonth) || 1; const day = Array.from({ length: 7 }, (_, index) => addDays(week, index)).find((date) => date.getDate() === Math.min(wanted, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate())); if (day) when = [weekdayDate(dayKey(day)), time].filter(Boolean).join(' · '); }
      }
      if (when) rows.push({ key: `${program.id}:${start}`, name: program.name || 'Research program', when });
    }
    out[start] = rows;
  }
  return out;
}

// "Nov 9 – 15", or "Nov 30 – Dec 6" across a month end.
export function weekRange(week) {
  const end = addDays(week, 6);
  return week.getMonth() === end.getMonth() ? `${short(week)} – ${end.getDate()}` : `${short(week)} – ${short(end)}`;
}
// How far a week is from this one, in words: "This week", "Next week", "In 3 weeks", "Last week", "2 weeks ago".
export function weekDistance(week, now = new Date()) {
  const weeks = Math.round((week.getTime() - mondayOf(now).getTime()) / (7 * 86400000));
  return weeks === 0 ? 'This week' : weeks === 1 ? 'Next week' : weeks === -1 ? 'Last week' : weeks > 0 ? `In ${weeks} weeks` : `${-weeks} weeks ago`;
}

export function CalendarView({ state = {}, viewer: viewerIn, api = {}, mode = 'team', onOpenTarget }) {
  const contextViewer = useViewer(); const viewer = viewerIn || contextViewer;
  const narrow = useNarrow();
  const [offset, setOffset] = useState(0);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [dates, setDates] = useState({});
  const [saving, setSaving] = useState('');
  const channelMode = mode === 'channel';
  const entries = useMemo(() => calendarEntries({ state, mode }), [state.contentStudio, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = addDays(mondayOf(), offset * 7);
  const weeks = Array.from({ length: narrow ? 2 : WEEKS }, (_, index) => addDays(first, index * 7));
  const end = dayKey(addDays(weeks.at(-1), 6));
  const inRange = entries.filter((entry) => entry.plannedFor && entry.plannedFor >= dayKey(first) && entry.plannedFor <= end);
  const undated = entries.filter((entry) => !entry.plannedFor);
  const view = state.contentStudio?.channelView;
  const workspace = (state.contentStudio?.workspaces || []).find((row) => row.id === state.contentStudio?.activeWorkspaceId);
  // The team's grid always shows every channel, planned or not: an empty row is somewhere to plan into.
  const teamChannels = channelMode ? [] : routingChannels(workspace?.editionId || 'general').map((channel) => ({ id: channel.id, name: channel.name }));
  const rows = channelMode ? [{ id: view?.channel?.id || '', name: view?.channel?.name || 'Your channel' }]
    : [...new Map([...teamChannels, ...inRange.map((entry) => ({ id: entry.channelId, name: entry.channel }))].map((row) => [row.id, row])).values()];
  const grid = !narrow && !channelMode;
  const mine = (row) => !workspace || !row?.workspaceId || row.workspaceId === workspace.id;
  const research = useMemo(() => (grid ? researchByWeek(list(state.contentStudio?.programs).filter(mine), weeks) : {}), [state.contentStudio?.programs, grid, offset, workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasResearch = Object.values(research).some((cell) => cell.length);
  const inWeek = (entry, week) => entry.plannedFor >= dayKey(week) && entry.plannedFor <= dayKey(addDays(week, 6));
  const flash = (text) => { setNote(text); setTimeout(() => setNote((current) => (current === text ? '' : current)), 2600); };
  async function copyWeek(week) {
    const table = weekTable(entries, week);
    if (table.split('\n').length < 2) { flash(`Nothing is planned for the week of ${short(week)}.`); return; }
    flash((await copyText(table)) ? `The week of ${short(week)} is copied as a table. Paste it into a sheet or doc.` : 'The week couldn’t be copied. Try again.');
  }
  function downloadIcs() {
    const planned = entries.filter((entry) => entry.plannedFor);
    if (!planned.length) { flash('Nothing has a date yet, so there’s nothing to add to a calendar.'); return; }
    const name = `${channelMode ? view?.channel?.name || 'My plan' : workspace?.name || 'Content'} calendar`;
    flash(download(icsFor(planned, { name }), `${name.replace(/[\\/:*?"<>|]+/g, '-')}.ics`) ? 'Calendar file ready. Open it to add the dates to your calendar.' : 'The calendar file couldn’t be made here.');
  }
  async function plan(entry) {
    const day = dates[entry.key] ?? entry.plannedFor;
    if (day && !ISO_DAY.test(day)) { setProblem('Choose a date.'); return; }
    if (!api.setTrendAdoption || viewer.preview) return;
    setSaving(entry.key); setProblem('');
    try { await api.setTrendAdoption({ themeId: entry.themeId, status: 'using', link: entry.link || '', note: entry.note || '', plannedFor: day || '' }); flash(day ? `Planned for ${weekdayDate(day)}.` : 'Date cleared.'); setDates((current) => { const next = { ...current }; delete next[entry.key]; return next; }); }
    catch (failure) { setProblem(failure?.message || 'That date couldn’t be saved. Try again.'); }
    finally { setSaving(''); }
  }
  const entryCard = (entry) => <li key={entry.key} className="cal-entry">
    <strong>{entry.trend}</strong>
    <small>{[weekdayDate(entry.plannedFor), channelMode ? '' : entry.byName ? `by ${entry.byName}` : ''].filter(Boolean).join(' · ')}</small>
    {entry.link && (api.openSourceUrl ? <button type="button" className="cal-link" onClick={() => api.openSourceUrl(entry.link)}><ExternalLink size={12} aria-hidden="true" />Open the post</button> : <a className="cal-link" href={entry.link} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden="true" />Open the post</a>)}
  </li>;
  const title = channelMode ? 'My plan' : 'Calendar';
  return <div className="studio-screen studio-page cal-page" data-mode={mode}>
    <div className="studio-page-head"><div><h1>{title}</h1><p>{channelMode ? `When ${view?.channel?.name || 'your channel'} runs the trends it’s using.` : 'When each channel plans to run the trends it’s using.'}{!grid && ' Dates come from “Planned for” after “Yes, I’m using this trend”.'}</p></div>
      <div className="studio-head-actions"><button type="button" className="studio-quiet" onClick={() => copyWeek(first)}><ClipboardCopy size={15} aria-hidden="true" />Copy week as a table</button><button type="button" className="studio-quiet" onClick={downloadIcs}><Download size={15} aria-hidden="true" />Download .ics</button></div></div>
    <div className="cal-toolbar">
      <div className="cal-nav" role="group" aria-label="Weeks">
        <button type="button" className="studio-icon-button" aria-label="Earlier weeks" onClick={() => setOffset((value) => value - 1)}><ChevronLeft size={17} aria-hidden="true" /></button>
        <p className="cal-range" aria-live="polite">{short(first)} – {short(addDays(weeks.at(-1), 6))}</p>
        <button type="button" className="studio-icon-button" aria-label="Later weeks" onClick={() => setOffset((value) => value + 1)}><ChevronRight size={17} aria-hidden="true" /></button>
        {offset !== 0 && <button type="button" className="studio-quiet small" onClick={() => setOffset(0)}>Back to this week</button>}
      </div>
      {grid && <p className="cal-summary">{inRange.length ? `${inRange.length} planned` : 'Nothing planned'} · {rows.length} {rows.length === 1 ? 'channel' : 'channels'}{undated.length > 0 && ` · ${undated.length} without a date`}</p>}
    </div>
    <p className="cal-note" role="status">{note}</p>
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    {grid && !inRange.length && <div className="cal-callout" role="note"><span className="cal-callout-icon" aria-hidden="true"><CalendarDays size={18} /></span>
      <div><strong>{entries.length ? 'Nothing is planned in these weeks' : 'Nothing is planned yet'}</strong><p>A channel’s plan appears in its row when its owner answers “Yes, I’m using this trend” and adds a “Planned for” date.</p></div>
      {offset !== 0 && entries.length > 0 ? <button type="button" className="studio-quiet small" onClick={() => setOffset(0)}>Back to this week</button>
        : onOpenTarget && <button type="button" className="studio-quiet small" onClick={() => onOpenTarget({ kind: 'page', page: 'trends' })}>Go to Trends<ArrowRight size={14} aria-hidden="true" /></button>}</div>}
    {!grid && !entries.length && <div className="studio-empty big"><CalendarDays size={28} aria-hidden="true" /><p>Nothing planned yet. When {channelMode ? 'you say' : 'a channel says'} it’s using a trend, add a date and it shows up here.</p></div>}
    {!grid && entries.length > 0 && !inRange.length && <div className="studio-empty"><p>Nothing planned these weeks. When {channelMode ? 'you say' : 'a channel says'} it’s using a trend, add a date and it shows up here.</p>{offset !== 0 && <button type="button" className="studio-quiet small" onClick={() => setOffset(0)}>Back to this week</button>}</div>}
    {(grid || inRange.length > 0) && (!grid
      ? <div className="cal-weeks">{weeks.map((week) => { const rowsIn = inRange.filter((entry) => inWeek(entry, week)); return <section key={dayKey(week)} className="cal-week" aria-label={`Week of ${short(week)}`}>
        <header><h2>Week of {short(week)}</h2><button type="button" className="studio-link" aria-label={`Copy the week of ${short(week)} as a table`} onClick={() => copyWeek(week)}><ClipboardCopy size={13} aria-hidden="true" />Copy</button></header>
        {rowsIn.length ? <ul className="cal-entries">{rowsIn.sort((a, b) => a.plannedFor.localeCompare(b.plannedFor)).map((entry) => <React.Fragment key={entry.key}>{!channelMode && <li className="cal-channel-label">{entry.short}</li>}{entryCard(entry)}</React.Fragment>)}</ul> : <p className="cal-empty">Nothing planned.</p>}
      </section>; })}</div>
      : <div className="cal-grid-scroll" role="region" aria-label={`${title}, weeks by channel`} tabIndex={0}><table className="cal-grid">
        <thead><tr><th scope="col">Channel</th>{weeks.map((week) => { const now = dayKey(week) === dayKey(mondayOf()); return <th key={dayKey(week)} scope="col" className={now ? 'is-now' : undefined} aria-label={`Week of ${short(week)}${now ? ', this week' : ''}`}>
          <span className="cal-week-head"><span><strong>{weekRange(week)}</strong><small>{weekDistance(week)}</small></span>
            <button type="button" className="studio-icon-button cal-copy" title="Copy this week as a table" aria-label={`Copy the week of ${short(week)} as a table`} onClick={() => copyWeek(week)}><ClipboardCopy size={13} aria-hidden="true" /></button></span></th>; })}</tr></thead>
        <tbody>{hasResearch && <tr className="cal-research-row"><th scope="row">Research runs</th>{weeks.map((week) => <td key={dayKey(week)} className={dayKey(week) === dayKey(mondayOf()) ? 'is-now' : undefined}>{list(research[dayKey(week)]).length ? <ul className="cal-entries">{research[dayKey(week)].map((run) => <li key={run.key} className="cal-entry is-research"><strong>{run.name}</strong><small>{run.when}</small></li>)}</ul> : <span className="sr-only">No scheduled run</span>}</td>)}</tr>}
          {rows.map((row) => <tr key={row.id}><th scope="row">{row.name}</th>{weeks.map((week) => { const cell = inRange.filter((entry) => entry.channelId === row.id && inWeek(entry, week)).sort((a, b) => a.plannedFor.localeCompare(b.plannedFor)); return <td key={dayKey(week)} className={dayKey(week) === dayKey(mondayOf()) ? 'is-now' : undefined}>{cell.length ? <ul className="cal-entries">{cell.map(entryCard)}</ul> : <span className="sr-only">Nothing planned</span>}</td>; })}</tr>)}</tbody>
      </table></div>)}
    {undated.length > 0 && <section className="cal-undated" aria-labelledby="cal-undated-title">
      <h2 id="cal-undated-title">Using, no date yet <span className="studio-count">{undated.length}</span></h2>
      <ul>{undated.map((entry) => <li key={entry.key}>
        <span className="cal-undated-copy"><strong>{entry.trend}</strong><small>{channelMode ? 'Add the day it goes out.' : entry.channel}</small></span>
        {channelMode && api.setTrendAdoption && <span className="cal-plan"><label><span className="sr-only">Planned for {entry.trend}</span><input type="date" value={dates[entry.key] ?? ''} onChange={(event) => setDates((current) => ({ ...current, [entry.key]: event.target.value }))} /></label><button type="button" className="studio-primary small" {...writeProps(viewer, !dates[entry.key] || saving === entry.key)} onClick={() => plan(entry)}>{saving === entry.key ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <CalendarPlus size={14} aria-hidden="true" />}Plan it</button></span>}
      </li>)}</ul>
    </section>}
    {channelMode && inRange.length > 0 && <p className="studio-hint cal-hint"><Check size={13} aria-hidden="true" />To move a date, change it on the trend’s card under Trends.</p>}
  </div>;
}
