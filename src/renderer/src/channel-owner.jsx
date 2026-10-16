import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleStop, ClipboardCopy, Clock, Download, ExternalLink, FileText, FolderDown, FolderOpen, Image as ImageIcon, LayoutTemplate, Link2, LoaderCircle, Pencil, RefreshCw, RotateCcw, Sparkles, TriangleAlert, TrendingUp } from 'lucide-react';
import { MarkdownContent } from './markdown-content.jsx';
import { Dialog, DialogClose, MoreMenu, copyText, useToast } from './role-screens.jsx';
import { PREVIEW_TITLE, firstName, formatDay, plural, writeProps } from './viewer.js';
import './channel-owner.css';

// The channel owner's whole studio: Trends (read the brief, Generate for my channel, say whether it was used) and
// My assets (the drafts made for their channel, by trend). Alex's verb is "Generate" everywhere. Owners never see
// money, models or other channels; the server already projected all of that out of `view` (state.contentStudio.channelView).
const ACTIVE = new Set(['queued', 'running']);
const list = (value) => (Array.isArray(value) ? value : []);
const PRIORITY = { top: 'Top priority', strong: 'Strong', watch: 'Worth watching' };
const byNewest = (key) => (a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || ''));
// "Blog — Short News Update" → "Short News Update": the channel name is already on screen.
export const fileLabel = (label) => String(label || '').replace(/^[^—]+—\s*/, '') || String(label || '');
const domId = (prefix, id) => `${prefix}-${String(id || 'x').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const headingId = (themeId) => domId('channel-trend', themeId);
const DAY = 86400000;

function dayGroup(value) {
  const then = new Date(value || 0);
  if (!value || Number.isNaN(then.getTime())) return 'Older';
  const now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(then.getFullYear(), then.getMonth(), then.getDate())) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  if (days < 31) return 'This month';
  return then.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
const groupBy = (rows, keyOf) => rows.reduce((all, row) => { const key = keyOf(row); const found = all.find((entry) => entry.key === key); if (found) found.rows.push(row); else all.push({ key, rows: [row] }); return all; }, []);

// Links: bare domains get https://, and anything that isn't a plain web address is refused (on Save only). The result
// is written exactly as the server stores it (URL.href: "semrush.com" → "https://semrush.com/"), so an answer shown
// before the save lands matches the saved one and gives way to it.
export function normalizeLink(raw) {
  const text = String(raw || '').trim();
  if (!text || /\s/.test(text) || text.length > 2048) return '';
  const value = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/+/, '')}`;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') && !url.username && !url.password && url.href.length <= 2048 ? url.href : '';
  } catch { return ''; }
}
export function linkLabel(link) {
  try {
    const url = new URL(link);
    const text = `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;
    return text.length > 44 ? `${text.slice(0, 43)}…` : text;
  } catch { return String(link || ''); }
}
const sameAnswer = (a, b) => (!a && !b) || (Boolean(a) && Boolean(b) && a.status === b.status && (a.link || '') === (b.link || '') && (a.note || '') === (b.note || ''));
// The trend arrived more than 14 days before this person joined (the server's "earlier" rule).
const beforeJoining = (readyAt, memberSince) => Boolean(readyAt && memberSince) && new Date(readyAt).getTime() < new Date(memberSince).getTime() - 14 * DAY;

// Answers show the instant they're given and are forgotten once the saved state agrees, like Simple's decide().
function useAnswers({ api, viewer, trends, onError }) {
  const [local, setLocal] = useState({});
  const errorRef = useRef(onError); errorRef.current = onError;
  useEffect(() => {
    setLocal((current) => {
      const keys = Object.keys(current); if (!keys.length) return current;
      const next = { ...current }; let changed = false;
      for (const themeId of keys) { if (sameAnswer(trends.find((trend) => trend.themeId === themeId)?.adoption || null, current[themeId])) { delete next[themeId]; changed = true; } }
      return changed ? next : current;
    });
  }, [trends]);
  const of = (trend) => (Object.prototype.hasOwnProperty.call(local, trend.themeId) ? local[trend.themeId] : trend.adoption || null);
  function save(trend, next) {
    const before = of(trend);
    setLocal((current) => ({ ...current, [trend.themeId]: next ? { status: next.status, link: next.link || '', note: next.note || '', at: new Date().toISOString(), byName: viewer.name || '', byMe: true } : null }));
    if (!api?.setTrendAdoption) return Promise.resolve(false);
    const payload = next ? { themeId: trend.themeId, status: next.status, link: next.link || '', note: next.note || '' } : { themeId: trend.themeId, status: 'clear' };
    let request;
    try { request = Promise.resolve(api.setTrendAdoption(payload)); } catch (failure) { request = Promise.reject(failure); }
    return request.then(() => true, (failure) => {
      setLocal((current) => { const copy = { ...current }; if (sameAnswer(trend.adoption || null, before)) delete copy[trend.themeId]; else copy[trend.themeId] = before; return copy; });
      errorRef.current?.(failure?.message || 'That answer couldn’t be saved. Try again.');
      return false;
    });
  }
  return { of, save };
}

// App's runAction(fn, message, throwOnError) refreshes state after a write; errors come back here to show in place.
const runWith = (action, fn) => (action ? action(fn, '', true) : Promise.resolve().then(fn));

function jobsDone(run) {
  const jobs = list(run?.jobs);
  const total = Number(run?.progress?.total) || jobs.length;
  const done = Number.isFinite(Number(run?.progress?.done)) && run?.progress ? Number(run.progress.done) : jobs.filter((job) => job.status === 'succeeded').length;
  return { total, done: Math.min(done, total || done) };
}
const hasFiles = (run) => list(run?.jobs).some((job) => job.assetId || list(job.assetIds).length) || jobsDone(run).done > 0;
const minutesText = (minutes) => { const value = Math.round(Number(minutes) || 0); return value <= 0 ? 'Usually a few minutes' : value === 1 ? 'About a minute' : `About ${value} minutes`; };

function Progress({ run, label }) {
  const { total, done } = jobsDone(run);
  return <div className="channel-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(1, total)} aria-valuenow={done} aria-valuetext={`${done} of ${total} ready`}><span style={{ width: `${Math.max(4, Math.round((done / Math.max(1, total)) * 100))}%` }} /></div>;
}

// What the card offers for making drafts, driven by the newest set for this trend.
function MakeSlot({ trend, run, channel, viewer, imagesReady, pending, describedBy, onGenerate, onAgain, onOpenAssets, onStop, onFinish }) {
  const deliverables = list(channel.deliverables);
  const pictures = deliverables.some((item) => item.kind === 'image');
  const files = deliverables.filter((item) => imagesReady || item.kind !== 'image').map((item) => fileLabel(item.label));
  const picturesOff = !imagesReady && pictures ? <p className="channel-note">Pictures are off for your team, so only the written drafts are made.</p> : null;
  const write = (disabled) => writeProps(viewer, disabled || Boolean(pending));
  if (!run) {
    const ready = Boolean(trend.primaryReportId);
    return <div className="channel-make">
      <button type="button" className="studio-primary wide" data-spot="trends.generate" data-spot-item={trend.name} aria-describedby={describedBy} {...write(!ready)} title={viewer.preview ? PREVIEW_TITLE : ready ? undefined : 'The brief isn’t ready yet.'} onClick={onGenerate}><Sparkles size={16} aria-hidden="true" />Generate for my channel</button>
      {files.length > 0 && <p className="channel-make-files">{files.join(' · ')}</p>}
      {picturesOff}
    </div>;
  }
  const { total, done } = jobsDone(run);
  // Drafts for this trend from any set, not only this one: an earlier set's files are one tap away too.
  const anyFiles = hasFiles(run) || Number(trend.assetCount) > 0;
  if (ACTIVE.has(run.status)) {
    return <div className="channel-make is-live">
      <p className="channel-make-status"><LoaderCircle className="spin" size={15} aria-hidden="true" />{run.status === 'queued' ? 'Starting soon…' : `Writing ${Math.min(done + 1, Math.max(1, total))} of ${Math.max(1, total)}…`}</p>
      <Progress run={run} label={`Drafts for “${trend.name}”`} />
      {!run.shared && <button type="button" className="studio-quiet small" aria-describedby={describedBy} {...write(false)} onClick={onStop}><CircleStop size={15} aria-hidden="true" />Stop</button>}
      {anyFiles && <button type="button" className="studio-link" aria-describedby={describedBy} onClick={onOpenAssets}><FolderOpen size={14} aria-hidden="true" />Open my assets</button>}
    </div>;
  }
  if (run.status === 'succeeded') {
    return <div className="channel-make is-done">
      <p className="channel-make-status done"><Check size={15} aria-hidden="true" />{run.createdAt ? `Drafts ready · ${formatDay(run.createdAt)}` : 'Drafts ready'}</p>
      <button type="button" className="studio-primary wide" aria-describedby={describedBy} onClick={onOpenAssets}><FolderOpen size={16} aria-hidden="true" />Open my assets</button>
      <button type="button" className="studio-link" aria-describedby={describedBy} {...write(false)} onClick={onAgain}><RefreshCw size={14} aria-hidden="true" />Generate a new set</button>
      {picturesOff}
    </div>;
  }
  const left = Math.max(0, total - done);
  // Only an admin can fix what stopped it (a key, a sign-in, the account): say so, and offer no retry that would fail again.
  const adminNeeded = Boolean(run.needsAdmin);
  const canFinish = !run.shared && !adminNeeded;
  return <div className="channel-make is-problem">
    <p className="channel-make-status problem"><TriangleAlert size={15} aria-hidden="true" />{run.status === 'cancelled' && !done ? 'Stopped before any drafts were ready.' : `${left} of ${total} ${total === 1 ? 'draft' : 'drafts'} didn’t finish.`}</p>
    {adminNeeded && <p className="channel-note">{run.message || 'Ask an admin: the AI connection needs attention.'}</p>}
    {canFinish && <button type="button" className="studio-primary wide" aria-describedby={describedBy} {...write(false)} onClick={onFinish}><RefreshCw size={15} aria-hidden="true" />Finish the rest</button>}
    {run.shared && !adminNeeded && <p className="channel-note">This set was made with other channels. Ask an editor.</p>}
    {anyFiles && <button type="button" className={canFinish ? 'studio-quiet' : 'studio-primary wide'} aria-describedby={describedBy} onClick={onOpenAssets}><FolderOpen size={15} aria-hidden="true" />Open my assets</button>}
    {run.shared && !adminNeeded && <button type="button" className="studio-link" aria-describedby={describedBy} {...write(false)} onClick={onAgain}><RefreshCw size={14} aria-hidden="true" />Generate a new set</button>}
  </div>;
}

function LinkField({ initial = '', viewer, describedBy, onSave, onCancel }) {
  const [value, setValue] = useState(initial || '');
  const [error, setError] = useState('');
  const input = useRef(null);
  const id = useId();
  useEffect(() => { input.current?.focus(); }, []);
  function save(event) {
    event.preventDefault();
    const link = normalizeLink(value);
    if (!link) { setError('That doesn’t look like a web link.'); input.current?.focus(); return; }
    onSave(link);
  }
  return <form className="channel-link-form" noValidate onSubmit={save}>
    <label className="studio-field"><span>Where did you use it?</span>
      <input ref={input} type="url" inputMode="url" autoComplete="url" placeholder="semrush.com/blog/…" value={value} aria-invalid={error ? 'true' : undefined} aria-describedby={[`${id}-hint`, error ? `${id}-error` : '', describedBy].filter(Boolean).join(' ')} onChange={(event) => { setValue(event.target.value); setError(''); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }} />
    </label>
    <p id={`${id}-hint`} className="studio-hint">Paste the post, page or email link. You can add it later.</p>
    {error && <p id={`${id}-error`} className="studio-error" role="alert">{error}</p>}
    <div className="channel-link-actions"><button type="submit" className="studio-primary small" {...writeProps(viewer, !value.trim())}>Save</button><button type="button" className="studio-quiet small" onClick={onCancel}>Not now</button></div>
  </form>;
}

// "Yes, I'm using this trend" / "Not for us", then the link once it's live. Shared by Trends and My assets.
export function AnswerRow({ api, trend, answer, channel = {}, viewer = {}, describedBy, onAnswer }) {
  const [editing, setEditing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [refocus, setRefocus] = useState(false);
  const after = useRef(null);
  const yes = useRef(null);
  const using = answer?.status === 'using';
  const notUsing = answer?.status === 'not-using';
  const preview = Boolean(viewer.preview);
  // The control that was pressed goes away (the buttons fold into "Using"), so focus moves to what replaced it.
  useEffect(() => { if (refocus) { after.current?.focus(); setRefocus(false); } }, [refocus, using]);
  useEffect(() => { if (editing) yes.current?.focus(); }, [editing]);
  const answeredBy = answer && answer.byMe === false && answer.byName ? <p className="channel-answered-by">Answered by {answer.byName}{answer.at ? ` · ${formatDay(answer.at)}` : ''}</p> : null;
  if (using && !editing) {
    return <div className="channel-answer is-using">
      <div className="channel-answer-line">
        <span className="studio-chip using"><Check size={13} aria-hidden="true" />Using</span>
        {answer.link && !linkOpen && <button ref={after} type="button" className="channel-link-chip" aria-describedby={describedBy} title={answer.link} onClick={() => api?.openSourceUrl?.(answer.link)}><ExternalLink size={14} aria-hidden="true" /><span>{linkLabel(answer.link)}</span></button>}
        {!answer.link && !linkOpen && <button ref={after} type="button" className="studio-link" data-spot="trends.link" aria-describedby={describedBy} {...writeProps(viewer)} onClick={() => setLinkOpen(true)}><Link2 size={14} aria-hidden="true" />Add the link when it’s live</button>}
        <MoreMenu label={`More for “${trend.name}”`} describedBy={describedBy} disabled={preview} title={preview ? PREVIEW_TITLE : undefined} items={[
          answer.link && { label: 'Change link', icon: Link2, onSelect: () => setLinkOpen(true) },
          { label: 'Change my answer', icon: RotateCcw, onSelect: () => setEditing(true) },
        ]} />
      </div>
      {linkOpen && <LinkField initial={answer.link} viewer={viewer} describedBy={describedBy} onSave={(link) => { onAnswer({ status: 'using', link, note: answer.note || '' }); setLinkOpen(false); setRefocus(true); }} onCancel={() => { setLinkOpen(false); setRefocus(true); }} />}
      {answeredBy}
    </div>;
  }
  return <div className="channel-answer">
    <span className="channel-answer-label" aria-hidden="true">Your answer</span>
    <div className="channel-answer-buttons" role="group" aria-label={`Using this trend for ${channel.name || 'your channel'}?`} data-spot="trends.use" data-spot-item={trend.name}>
      <button ref={yes} type="button" className="channel-yes" aria-pressed={using} aria-describedby={describedBy} {...writeProps(viewer)} onClick={() => { setEditing(false); setRefocus(true); if (!using) onAnswer({ status: 'using', link: answer?.link || '', note: answer?.note || '' }); }}><Check size={16} aria-hidden="true" />Yes, I’m using this trend</button>
      <button type="button" className="channel-no" aria-pressed={notUsing} aria-describedby={describedBy} {...writeProps(viewer)} onClick={() => { setEditing(false); onAnswer(notUsing ? null : { status: 'not-using', link: '', note: answer?.note || '' }); }}>Not for us</button>
    </div>
    {editing && <button type="button" className="studio-link" onClick={() => { setEditing(false); setRefocus(true); }}>Keep my answer</button>}
    {answeredBy}
  </div>;
}

function briefMarkdown(payload) {
  if (!payload) return '';
  if (typeof payload.markdown === 'string') return payload.markdown;
  const output = payload.output; if (!output || typeof output !== 'object') return '';
  const text = (value) => (typeof value === 'string' ? value : '');
  return [`# ${text(output.title)}`, text(output.summary), ...list(output.sections).map((section) => `## ${text(section.heading)}\n\n${text(section.body)}`)].filter((part) => part.trim() && part.trim() !== '#').join('\n\n');
}

// The brief, read in place: what the trend is and why it matters, with who last edited it.
export function ChannelBriefReader({ api, trend, onClose }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const titleId = useId();
  useEffect(() => {
    let cancelled = false;
    if (!trend.primaryReportId) { setError('The brief for this trend isn’t ready yet.'); return undefined; }
    Promise.resolve().then(() => api.readStudioAsset({ assetId: trend.primaryReportId })).then((result) => { if (!cancelled) setPayload(result || {}); }, (failure) => { if (!cancelled) setError(failure?.message || 'The brief couldn’t be opened. Try again.'); });
    return () => { cancelled = true; };
  }, [trend.primaryReportId]);
  const markdown = briefMarkdown(payload);
  const edited = payload?.asset?.edited || payload?.edited || (trend.briefEditedAt ? { at: trend.briefEditedAt } : null);
  return <Dialog labelledBy={titleId} wide onClose={onClose} className="channel-brief">
    <header className="studio-dialog-head">
      <div><small>The brief</small><h2 id={titleId}>{trend.name}</h2>{edited?.at && <p className="studio-dialog-meta"><Pencil size={13} aria-hidden="true" />Edited{edited.byName ? ` by ${edited.byName}` : ''} · {formatDay(edited.at)}</p>}</div>
      <div className="studio-dialog-tools"><button type="button" className="studio-quiet small" disabled={!markdown} onClick={async () => { setCopied(await copyText(markdown)); setTimeout(() => setCopied(false), 1800); }}>{copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy text'}</button><DialogClose onClose={onClose} /></div>
    </header>
    <div className="studio-dialog-body studio-reading">
      {error ? <p className="studio-error" role="alert">{error}</p>
        : !payload ? <div className="studio-skeleton" role="status" aria-label="Opening the brief"><span /><span /><span /><span /></div>
        : markdown ? <MarkdownContent onOpenSourceUrl={api.openSourceUrl ? (url) => api.openSourceUrl(url) : undefined}>{markdown}</MarkdownContent>
        : <p className="studio-hint">This brief has no readable text yet.</p>}
    </div>
  </Dialog>;
}

// Only this channel's part of a plan, with no money, route or model on any AI route (Codex plans included).
export function channelPlan(plan, channel = {}, imagesReady = true) {
  const source = plan || {};
  const folders = list(source.folders);
  const folder = source.folder || folders.find((entry) => entry.id === channel.id) || (folders.length === 1 ? folders[0] : null);
  const pictures = imagesReady && source.imagesReady !== false;
  let items = list(folder?.items).filter((item) => item.available !== false && item.selected !== false).map((item) => ({ id: item.id, label: item.label, kind: item.kind || 'text', pictures: Number(item.pictures) || 0 }));
  if (!items.length) items = list(channel.deliverables).map((item) => ({ id: item.id, label: item.label, kind: item.kind || 'text', pictures: 0 }));
  if (!pictures) items = items.filter((item) => item.kind !== 'image');
  return { title: String(source.title || ''), folderName: folder?.name || channel.name || '', items, minutes: Number(source.minutes) || 0, picturesOff: !pictures && list(channel.deliverables).some((item) => item.kind === 'image'), edited: source.edited && source.edited.at ? { at: source.edited.at, byName: source.edited.byName || '' } : null, earlierSets: list(source.earlierSets) };
}

export function ChannelGenerateSheet({ api, trend, channel = {}, viewer = {}, imagesReady = true, busy = false, action, onClose, onStarted }) {
  const [plan, setPlan] = useState(null);
  const [problem, setProblem] = useState('');
  const [starting, setStarting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const titleId = useId();
  const source = { kind: 'report', assetId: trend.primaryReportId };
  const deliverableIds = list(channel.deliverables).map((item) => item.id);
  useEffect(() => {
    let cancelled = false; setPlan(null); setProblem('');
    if (!api?.planAssetKit) { setPlan(channelPlan(null, channel, imagesReady)); return undefined; }
    Promise.resolve().then(() => api.planAssetKit({ source, ...(deliverableIds.length ? { deliverableIds } : {}) })).then((result) => { if (!cancelled) setPlan(channelPlan(result, channel, imagesReady)); }, (failure) => { if (!cancelled) setProblem(failure?.message || 'This brief can’t be used right now. Try again in a minute.'); });
    return () => { cancelled = true; };
  }, [attempt]);
  const items = plan?.items || [];
  async function start() {
    if (!plan || !items.length || viewer.preview || starting) return;
    setStarting(true); setProblem('');
    try {
      const run = await runWith(action, () => api.createAssetKit({ source, deliverableIds: items.map((item) => item.id) }));
      setStarting(false);
      if (run === null) { setProblem('The drafts couldn’t be started. Try again.'); return; }
      onStarted?.(run, items.length);
    } catch (failure) { setStarting(false); setProblem(failure?.message || 'The drafts couldn’t be started. Try again.'); }
  }
  const earlier = plan?.earlierSets?.length ? [...plan.earlierSets].sort(byNewest('createdAt'))[0] : null;
  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={starting} className="channel-sheet">
    <header className="studio-dialog-head">
      <div><small>{channel.name || 'Your channel'}</small><h2 id={titleId}>Generate drafts for “{trend.name}”</h2></div>
      <DialogClose onClose={onClose} disabled={starting} />
    </header>
    <div className="studio-dialog-body">
      {!plan && !problem && <div className="studio-skeleton" role="status" aria-label="Checking what will be made"><span /><span /><span /></div>}
      {plan && <>
        <section className="channel-plan" aria-labelledby={`${titleId}-files`}>
          <h3 id={`${titleId}-files`}>What will be made</h3>
          <ul>{items.map((item) => <li key={item.id}><span className="channel-plan-icon">{item.kind === 'image' ? <ImageIcon size={17} aria-hidden="true" /> : item.id === 'landingpage' ? <LayoutTemplate size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}</span><span><strong>{fileLabel(item.label)}</strong><small>{item.kind === 'image' ? (item.pictures ? plural(item.pictures, 'picture') : 'Pictures') : 'Written draft'}</small></span></li>)}</ul>
          {!items.length && <p className="studio-hint">Nothing for your channel can be made from this brief yet.</p>}
        </section>
        {plan.picturesOff && <p className="channel-note">Pictures are off for your team, so only the written drafts are made.</p>}
        <ul className="channel-plan-facts">
          <li><Clock size={16} aria-hidden="true" />{minutesText(plan.minutes)}</li>
          <li><FolderDown size={16} aria-hidden="true" />Drafts appear in My assets. You’ll see progress on this card.</li>
          {plan.edited && <li><Pencil size={16} aria-hidden="true" />Uses {plan.edited.byName ? `${plan.edited.byName}’s` : 'the'} edited brief ({formatDay(plan.edited.at)}).</li>}
          {earlier?.createdAt && <li><FolderOpen size={16} aria-hidden="true" />Your earlier set from {formatDay(earlier.createdAt)} stays in My assets.</li>}
        </ul>
      </>}
      {problem && <div className="channel-sheet-problem" role="alert"><p className="studio-error">{problem}</p>{!plan && <button type="button" className="studio-quiet small" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={14} aria-hidden="true" />Try again</button>}</div>}
    </div>
    <footer className="studio-dialog-foot">
      <button type="button" className="studio-quiet" disabled={starting} onClick={onClose}>Cancel</button>
      <button type="button" className="studio-primary" data-spot="trends.generate-confirm" {...writeProps(viewer, !plan || !items.length || starting || busy)} onClick={start}>{starting ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}{starting ? 'Starting…' : `Generate ${plural(items.length, 'draft')}`}</button>
    </footer>
  </Dialog>;
}

function TrendCard({ row, api, channel, viewer, imagesReady, run, pending, onRead, onGenerate, onAgain, onOpenAssets, onStop, onFinish, onAnswer }) {
  const { trend, answer, isNew } = row;
  const hid = headingId(trend.themeId);
  return <article className={`channel-card${isNew ? ' is-new' : ''}`} aria-labelledby={hid} data-theme-card={trend.themeId} data-spot="trends.channel-card" data-spot-item={trend.name}>
    <div className="channel-card-main">
      <div className="channel-card-meta">
        {PRIORITY[trend.priority] && <span className={`studio-chip priority-${trend.priority}`}>{PRIORITY[trend.priority]}</span>}
        {isNew && <span className="studio-chip new">New</span>}
        {trend.category && <span className="studio-chip plain">{trend.category}</span>}
        {trend.evidenceCount > 0 && <span className="studio-chip plain">{plural(trend.evidenceCount, 'source')}</span>}
      </div>
      <h3 id={hid} tabIndex={-1}>{trend.name}</h3>
      {trend.description && <p className="channel-card-summary">{trend.description}</p>}
      <button type="button" className="studio-link" data-spot="trends.brief" aria-describedby={hid} disabled={!trend.primaryReportId} onClick={onRead}><FileText size={15} aria-hidden="true" />Read the brief{trend.briefEditedAt ? <span className="channel-edited"> · edited {formatDay(trend.briefEditedAt)}</span> : null}</button>
    </div>
    <div className="channel-card-side">
      <MakeSlot trend={trend} run={run} channel={channel} viewer={viewer} imagesReady={imagesReady} pending={pending} describedBy={hid} onGenerate={onGenerate} onAgain={onAgain} onOpenAssets={onOpenAssets} onStop={onStop} onFinish={onFinish} />
      <AnswerRow api={api} trend={trend} answer={answer} channel={channel} viewer={viewer} describedBy={hid} onAnswer={onAnswer} />
    </div>
  </article>;
}

function ChannelLoading({ title }) {
  return <div className="studio-screen studio-page channel-page" aria-busy="true">
    <div className="studio-page-head"><div><h1>{title}</h1><p>Opening your channel…</p></div></div>
    <div className="channel-cards" role="status" aria-label="Loading">{[0, 1].map((n) => <div key={n} className="channel-card is-loading"><div className="studio-skeleton"><span /><span /><span /></div><span className="studio-shimmer channel-loading-side" /></div>)}</div>
  </div>;
}

const FILTERS = [['new', 'New'], ['using', 'Using'], ['not-using', 'Not for us'], ['all', 'All']];
const EMPTY = {
  using: 'You haven’t marked any trends as used yet.',
  'not-using': 'Trends you pass on show up here, in case you change your mind.',
  new: 'You’ve answered every trend. New ones show up here, and the count next to Trends tells you when.',
  all: 'You’ve answered every trend. New ones show up here, and the count next to Trends tells you when.',
};

export function ChannelTrends({ api, view, viewer = {}, busy = false, action, imagesReady = true, onOpenAssets, onPrefs, onToast }) {
  const channel = view?.channel || {};
  const trends = useMemo(() => [...list(view?.trends)].sort(byNewest('readyAt')), [view?.trends]);
  const [toast, showToast] = useToast();
  const notify = (text) => (onToast ? onToast(text) : showToast(text));
  const answers = useAnswers({ api, viewer, trends, onError: (text) => showToast(text, { tone: 'error' }) });
  const [filter, setFilter] = useState(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [welcomed, setWelcomed] = useState(false);
  const [reading, setReading] = useState(null);
  const [making, setMaking] = useState(null);
  const [started, setStarted] = useState({}); // themeId → the set just started, until the next state push has it
  const [pending, setPending] = useState({});
  const [focusTarget, setFocusTarget] = useState(null);
  const listRef = useRef(null);
  const titleRef = useRef(null);
  const preview = Boolean(viewer.preview);

  // "Earlier": unanswered, and ready well before this person joined. The server decides for unanswered trends; an
  // answer cleared here falls back to the same date rule.
  const rowOf = (trend, answer) => {
    const old = !answer && Boolean(trend.earlier || (trend.adoption && viewer.via !== 'desktop' && beforeJoining(trend.readyAt, viewer.memberSince)));
    return { trend, answer, old, isNew: !answer && !old };
  };
  const rows = trends.map((trend) => rowOf(trend, answers.of(trend)));
  const counts = { new: rows.filter((row) => row.isNew).length, using: rows.filter((row) => row.answer?.status === 'using').length, 'not-using': rows.filter((row) => row.answer?.status === 'not-using').length, all: rows.length };
  const shown = filter || (counts.new > 0 ? 'new' : 'all');
  const inFilter = (row, which = shown) => (which === 'new' ? row.isNew : which === 'using' ? row.answer?.status === 'using' : which === 'not-using' ? row.answer?.status === 'not-using' : !row.old);
  const main = rows.filter((row) => inFilter(row));
  const earlier = ['new', 'all'].includes(shown) ? rows.filter((row) => row.old) : [];
  const groups = groupBy(main, (row) => dayGroup(row.trend.readyAt));

  // A set just started shows on its card at once; it's dropped when the pushed state carries it, or any set other
  // than the one that was newest when it started.
  useEffect(() => {
    setStarted((current) => {
      const keys = Object.keys(current); if (!keys.length) return current;
      const next = { ...current }; let changed = false;
      for (const themeId of keys) { const server = trends.find((trend) => trend.themeId === themeId)?.latestRun; if (server && (server.id === current[themeId].run.id || server.id !== current[themeId].previousId)) { delete next[themeId]; changed = true; } }
      return changed ? next : current;
    });
  }, [trends, started]);
  const runOf = (trend) => started[trend.themeId]?.run || trend.latestRun || null;

  useEffect(() => {
    if (!focusTarget) return;
    const node = focusTarget.id ? document.getElementById(headingId(focusTarget.id)) : null;
    (node && !node.closest('[hidden]') ? node : titleRef.current)?.focus({ preventScroll: false });
    setFocusTarget(null);
  }, [focusTarget]);

  const visibleOrder = () => [...(listRef.current?.querySelectorAll('[data-theme-card]') || [])].filter((node) => !node.closest('[hidden]')).map((node) => node.dataset.themeCard);
  function answer(row, next) {
    const before = row.answer;
    const after = rowOf(row.trend, next);
    if (!filter) setFilter(shown); // keep the list where it is while cards move between filters
    const stays = inFilter(after, shown) || (after.old && earlierOpen && ['new', 'all'].includes(shown));
    const leaves = !stays;
    if (leaves) {
      const order = visibleOrder(); const index = order.indexOf(row.trend.themeId);
      setFocusTarget({ id: order[index + 1] || order[index - 1] || '' });
    } else if (row.old !== after.old) setFocusTarget({ id: row.trend.themeId }); // it moved between Earlier and the list: follow it
    answers.save(row.trend, next);
    if (leaves) {
      const text = !next ? 'Answer cleared.' : next.status === 'using' ? 'Marked as used.' : 'Marked Not for us.';
      showToast(text, { actionLabel: 'Undo', onAction: () => { answers.save(row.trend, before); setFocusTarget({ id: row.trend.themeId }); } });
    }
  }
  function generate(trend) { setMaking(trend); }
  function again(trend) {
    const run = runOf(trend);
    // Ask only when drafts exist; name the set's date when the card's set is the one that has them.
    const when = hasFiles(run) && run?.createdAt ? ` from ${formatDay(run.createdAt)}` : '';
    if ((hasFiles(run) || Number(trend.assetCount) > 0) && !window.confirm(`You already have drafts for this trend${when}. Generate a new set?`)) return;
    setMaking(trend);
  }
  async function stop(trend) {
    const run = runOf(trend); if (!run?.id || !api.cancelStudioRun) return;
    if (!window.confirm('Stop making these drafts? Finished ones are kept, and you can finish the rest later.')) return;
    setPending((current) => ({ ...current, [trend.themeId]: 'stop' }));
    try { const result = await runWith(action, () => api.cancelStudioRun({ runId: run.id })); setStarted((current) => { const next = { ...current }; delete next[trend.themeId]; return next; }); if (result !== null) notify('Stopped. Finished drafts are kept.'); }
    catch (failure) { showToast(failure?.message || 'That set couldn’t be stopped. Try again.', { tone: 'error' }); }
    finally { setPending((current) => { const next = { ...current }; delete next[trend.themeId]; return next; }); }
  }
  async function finish(trend) {
    const run = runOf(trend); if (!run?.id || !api.retryStudioRun) return;
    setPending((current) => ({ ...current, [trend.themeId]: 'finish' }));
    try { const result = await runWith(action, () => api.retryStudioRun({ runId: run.id })); if (result !== null) notify('Finishing the rest. You’ll see progress on this card.'); }
    catch (failure) { showToast(failure?.message || 'The rest couldn’t be started. Try again.', { tone: 'error' }); }
    finally { setPending((current) => { const next = { ...current }; delete next[trend.themeId]; return next; }); }
  }
  function startedSet(trend, run, count) {
    setMaking(null);
    const total = count || list(channel.deliverables).length;
    const set = run && typeof run === 'object' && run.id ? run : { id: `starting-${trend.themeId}`, status: 'queued', jobs: [], progress: { done: 0, total } };
    const previousId = trends.find((row) => row.themeId === trend.themeId)?.latestRun?.id || '';
    // The refreshed state may already carry the new set; only show the local one while it doesn't.
    if (set.id !== previousId) setStarted((current) => ({ ...current, [trend.themeId]: { previousId, run: { ...set, status: ACTIVE.has(set.status) ? set.status : 'queued', createdAt: set.createdAt || new Date().toISOString() } } }));
    setFocusTarget({ id: trend.themeId }); // the Generate button that opened the sheet is now a progress bar
    notify(`Generating ${plural(total, 'draft')} for ${channel.name || 'your channel'}. You’ll see progress on this card.`);
  }

  const card = (row) => <TrendCard key={row.trend.themeId} row={row} api={api} channel={channel} viewer={viewer} imagesReady={imagesReady} run={runOf(row.trend)} pending={pending[row.trend.themeId]}
    onRead={() => setReading(row.trend)} onGenerate={() => generate(row.trend)} onAgain={() => again(row.trend)} onOpenAssets={() => onOpenAssets?.(row.trend.themeId)}
    onStop={() => stop(row.trend)} onFinish={() => finish(row.trend)} onAnswer={(next) => answer(row, next)} />;
  const showWelcome = !viewer.prefs?.welcomedAt && !preview && !welcomed;
  if (!view) return <ChannelLoading title="Trends" />;
  return <div className="studio-screen studio-page channel-page" data-spot="trends.channel">
    <div className="studio-page-head"><div>
      <h1 ref={titleRef} tabIndex={-1}>Trends for {channel.name || 'your channel'}</h1>
      <p>New trends the team approved, each with a brief. Generate drafts for your channel, then tell us if you used it.</p>
    </div></div>

    {showWelcome && <section className="channel-welcome" aria-labelledby="channel-welcome-title">
      <div className="channel-welcome-copy">
        <h2 id="channel-welcome-title">Welcome{firstName(viewer.name) ? `, ${firstName(viewer.name)}` : ''}. This is where trends for {channel.name || 'your channel'} land.</h2>
        <ol className="channel-steps"><li><span>1</span>Read the brief.</li><li><span>2</span>Generate drafts for your channel if it fits.</li><li><span>3</span>Tell us if you used it, and add the link when it’s live.</li></ol>
      </div>
      <button type="button" className="studio-primary" onClick={() => { setWelcomed(true); onPrefs?.({ welcomedAt: new Date().toISOString() }); titleRef.current?.focus(); }}>Got it</button>
    </section>}

    {rows.length > 0 && <div className="studio-filters" role="group" aria-label="Show trends" data-spot="trends.filters">{FILTERS.map(([value, label]) => <button type="button" key={value} aria-pressed={shown === value} onClick={() => setFilter(value)}>{label}<span>{counts[value]}</span></button>)}</div>}

    <div ref={listRef} className="channel-list">
      {!rows.length && <div className="studio-empty big"><TrendingUp size={28} aria-hidden="true" /><p>No trends yet. When the team approves a trend and its brief is written, it shows up here.</p></div>}
      {rows.length > 0 && !main.length && <div className="studio-empty"><p>{earlier.length ? 'Nothing new right now. Trends from before you joined are below, if you want to answer them.' : EMPTY[shown]}</p>{shown !== 'all' && !earlier.length && <button type="button" className="studio-quiet small" onClick={() => setFilter('all')}>Show all trends</button>}</div>}
      {groups.map((group) => <section className="channel-group" key={group.key} aria-labelledby={domId('channel-day', group.key)}>
        <h2 className="studio-group-label" id={domId('channel-day', group.key)}>{group.key}</h2>
        <div className="channel-cards">{group.rows.map(card)}</div>
      </section>)}
      {earlier.length > 0 && <section className="channel-earlier" aria-labelledby="channel-earlier-title">
        <h2 className="channel-earlier-head" id="channel-earlier-title"><button type="button" className="channel-disclosure" aria-expanded={earlierOpen} aria-controls="channel-earlier-list" onClick={() => setEarlierOpen((open) => !open)}><ChevronDown size={16} className={earlierOpen ? 'open' : ''} aria-hidden="true" />Earlier<span className="studio-count">{earlier.length}</span></button></h2>
        <p className="channel-earlier-note">These came in before you joined. Answer them if you like.</p>
        <div id="channel-earlier-list" className="channel-cards" hidden={!earlierOpen}>{earlier.map(card)}</div>
      </section>}
    </div>

    {reading && <ChannelBriefReader api={api} trend={reading} onClose={() => setReading(null)} />}
    {making && <ChannelGenerateSheet api={api} trend={making} channel={channel} viewer={viewer} imagesReady={imagesReady} busy={busy} action={action} onClose={() => setMaking(null)} onStarted={(run, count) => startedSet(making, run, count)} />}
    {toast}
  </div>;
}

function jobLine(job, asset) {
  if (job.status === 'succeeded') return asset?.title || 'Ready';
  if (job.status === 'running') return job.kind === 'image' ? 'Drawing…' : 'Writing…';
  if (job.status === 'queued') return 'Waiting its turn';
  if (job.status === 'cancelled') return 'Stopped before it finished';
  return 'Didn’t finish';
}
function JobDot({ job }) {
  if (job.status === 'succeeded') return <span className="channel-dot done" title="Ready"><Check size={12} aria-hidden="true" /></span>;
  if (job.status === 'running') return <span className="channel-dot" title="Working"><LoaderCircle className="spin" size={13} aria-hidden="true" /></span>;
  if (job.status === 'queued' || job.status === 'cancelled') return <span className="channel-dot waiting" title={job.status === 'cancelled' ? 'Stopped' : 'Waiting'} />;
  return <span className="channel-dot problem" title="Didn’t finish"><TriangleAlert size={12} aria-hidden="true" /></span>;
}
// onCard: this set is the one its trend's card on Trends shows, where Finish the rest is.
function setLine(run, onCard = false) {
  const { total, done } = jobsDone(run);
  if (run.status === 'queued') return 'Starting soon…';
  if (run.status === 'running') return `Writing ${Math.min(done + 1, Math.max(1, total))} of ${Math.max(1, total)}…`;
  if (run.status === 'succeeded') return total ? `All ${plural(total, 'file')} ready` : 'Ready';
  if (run.status === 'cancelled') return done ? `Stopped · ${done} of ${total} ready` : 'Stopped';
  if (run.needsAdmin) return `${done} of ${total} ready · ${run.message || 'Ask an admin: the AI connection needs attention.'}`;
  if (run.shared) return `${done} of ${total} ready · ask an editor to finish it`;
  return onCard ? `${done} of ${total} ready · finish the rest on Trends` : `${done} of ${total} ready`;
}

function ChannelSet({ run, assets, web, cache, saving, onCard = false, onSave, onOpenFile, onOpenPicture }) {
  const jobs = list(run.jobs);
  const live = ACTIVE.has(run.status);
  const day = formatDay(run.createdAt);
  return <article className="channel-set" aria-label={day ? `Set from ${day}` : 'Set'}>
    <header className="channel-set-head">
      <span className="channel-set-icon">{live ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <FolderOpen size={18} aria-hidden="true" />}</span>
      <span className="channel-set-copy"><strong>{day ? `Set from ${day}` : 'Set'}</strong><small>{setLine(run, onCard)}</small></span>
      <button type="button" className="studio-quiet small" data-spot="assets.save-folder" disabled={!assets.length || saving} onClick={onSave}>{saving ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : web ? <Download size={15} aria-hidden="true" /> : <FolderDown size={15} aria-hidden="true" />}{web ? 'Download folder' : 'Save folder'}</button>
    </header>
    {run.shared && <p className="channel-note quiet">Made with other channels.</p>}
    {live && <Progress run={run} label={day ? `Drafts in the set from ${day}` : 'Drafts in this set'} />}
    <ul className="channel-files">{jobs.map((job) => {
      if (job.kind === 'image') {
        const pictures = assets.filter((asset) => asset.deliverableId === job.id && asset.kind === 'image').sort((a, b) => (a.variantIndex ?? 0) - (b.variantIndex ?? 0));
        return <li key={job.id} className="channel-file is-pictures">
          <span className="channel-file-icon"><ImageIcon size={17} aria-hidden="true" /></span>
          <span className="channel-file-copy"><strong>{fileLabel(job.label)}</strong><small>{pictures.length ? plural(pictures.length, 'picture') : jobLine(job)}</small></span>
          <JobDot job={job} />
          {pictures.length > 0 && <span className="channel-thumbs">{pictures.map((asset) => <button type="button" key={asset.id} className="channel-thumb" aria-label={`Open ${asset.title || fileLabel(job.label)}`} onClick={() => onOpenPicture(asset, pictures)}>{cache[`studio:${asset.id}`] ? <img src={cache[`studio:${asset.id}`]} alt="" /> : <span className="studio-shimmer" />}</button>)}</span>}
        </li>;
      }
      const asset = assets.find((row) => row.deliverableId === job.id && row.kind !== 'image') || assets.find((row) => row.id === job.assetId);
      return <li key={job.id}><button type="button" className="channel-file" disabled={!asset} aria-label={asset ? `Open ${fileLabel(job.label)}` : undefined} onClick={() => onOpenFile(asset, run)}>
        <span className="channel-file-icon">{job.id === 'landingpage' ? <LayoutTemplate size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}</span>
        <span className="channel-file-copy"><strong>{fileLabel(job.label)}</strong><small>{jobLine(job, asset)}{asset?.edited?.at ? ` · edited ${formatDay(asset.edited.at)}` : ''}</small></span>
        <JobDot job={job} />
      </button></li>;
    })}</ul>
  </article>;
}

// A written draft, read in place: copy it, download or open the file, and ← → through the set.
function ChannelFileReader({ api, web, file, label, onClose, onMove, onFile }) {
  const { asset } = file;
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const titleId = useId();
  useEffect(() => {
    let cancelled = false; setPayload(null); setError(''); setCopied(false);
    Promise.resolve().then(() => api.readStudioAsset({ assetId: asset.id })).then((result) => { if (!cancelled) setPayload(result || {}); }, (failure) => { if (!cancelled) setError(failure?.message || 'This file couldn’t be opened.'); });
    return () => { cancelled = true; };
  }, [asset.id]);
  const markdown = typeof payload?.markdown === 'string' ? payload.markdown : '';
  const edited = payload?.asset?.edited || asset.edited;
  return <Dialog labelledBy={titleId} wide onClose={onClose} className="channel-reader" onKeyDown={(event) => { if (event.target.closest?.('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return; if (event.key === 'ArrowLeft') { event.preventDefault(); onMove(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); onMove(1); } }}>
      <header className="studio-dialog-head">
        <div><small>{label || 'Draft'}</small><h2 id={titleId}>{asset.title || label || 'Draft'}</h2>{edited?.at && <p className="studio-dialog-meta"><Pencil size={13} aria-hidden="true" />Edited{edited.byName ? ` by ${edited.byName}` : ''} · {formatDay(edited.at)}</p>}</div>
        <div className="studio-dialog-tools">
          <button type="button" className="studio-quiet small" disabled={!markdown} onClick={async () => { setCopied(await copyText(markdown)); setTimeout(() => setCopied(false), 1800); }}>{copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy text'}</button>
          <button type="button" className="studio-quiet small" onClick={() => onFile(asset)}>{web ? <Download size={15} aria-hidden="true" /> : <ExternalLink size={15} aria-hidden="true" />}{web ? 'Download' : 'Open'}</button>
          <DialogClose onClose={onClose} />
        </div>
      </header>
      <div className="studio-dialog-body studio-reading">
        {error ? <p className="studio-error" role="alert">{error}</p> : !payload ? <div className="studio-skeleton" role="status" aria-label="Opening the file"><span /><span /><span /><span /></div> : markdown ? <MarkdownContent onOpenSourceUrl={api.openSourceUrl ? (url) => api.openSourceUrl(url) : undefined}>{markdown}</MarkdownContent> : <p className="studio-hint">This file has no readable text. Try {web ? 'Download' : 'Open'}.</p>}
      </div>
  </Dialog>;
}

function ChannelLightbox({ web, picture, cache, onClose, onMove, onFile }) {
  const { asset, pictures } = picture;
  const index = pictures.findIndex((row) => row.id === asset.id);
  const titleId = useId();
  const url = cache[`studio:${asset.id}`];
  return <Dialog labelledBy={titleId} wide onClose={onClose} className="channel-lightbox" onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); onMove(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); onMove(1); } }}>
    <div className="channel-lightbox-grid">
      <div className="channel-lightbox-media">{url ? <img src={url} alt={asset.title || 'Picture'} /> : <span className="studio-shimmer" role="status" aria-label="Loading the picture" />}</div>
      <aside className="channel-lightbox-side">
        <div className="channel-lightbox-head"><small>{[pictures.length > 1 ? `${index + 1} of ${pictures.length}` : '', formatDay(asset.createdAt)].filter(Boolean).join(' · ')}</small><DialogClose onClose={onClose} /></div>
        <h2 id={titleId}>{asset.title || 'Picture'}</h2>
        <div className="channel-lightbox-actions">
          <button type="button" className="studio-primary" onClick={() => onFile(asset)}>{web ? <Download size={15} aria-hidden="true" /> : <ExternalLink size={15} aria-hidden="true" />}{web ? 'Download' : 'Open file'}</button>
          {pictures.length > 1 && <span className="channel-lightbox-pager"><button type="button" className="studio-icon-button" aria-label="Previous picture" disabled={index <= 0} onClick={() => onMove(-1)}><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" className="studio-icon-button" aria-label="Next picture" disabled={index >= pictures.length - 1} onClick={() => onMove(1)}><ChevronRight size={18} aria-hidden="true" /></button></span>}
        </div>
      </aside>
    </div>
  </Dialog>;
}

export function ChannelAssets({ api, web = false, view, viewer = {}, busy = false, action, cache, onCache, focusThemeId }) {
  const channel = view?.channel || {};
  const trends = useMemo(() => list(view?.trends), [view?.trends]);
  const runs = list(view?.runs);
  const assets = list(view?.assets);
  const [ownCache, setOwnCache] = useState({});
  const images = cache || ownCache;
  const remember = (key, url) => (onCache ? onCache(key, url) : setOwnCache((current) => ({ ...current, [key]: url })));
  const [toast, showToast] = useToast();
  const answers = useAnswers({ api, viewer, trends, onError: (text) => showToast(text, { tone: 'error' }) });
  const [reading, setReading] = useState(null);
  const [picture, setPicture] = useState(null);
  const [brief, setBrief] = useState(null);
  const [saving, setSaving] = useState('');

  // One group per trend, newest first; inside it each set (kit run) for this channel, newest first.
  const groups = useMemo(() => {
    const byKey = new Map();
    const add = (key, fields, at) => { const entry = byKey.get(key) || { key, runs: [], latestAt: '', ...fields }; if (String(at || '') > entry.latestAt) entry.latestAt = String(at || ''); byKey.set(key, entry); return entry; };
    // A set someone stopped before it made anything has nothing to open or finish here; the trend's card still offers a new set.
    const shown = runs.filter((run) => run.status !== 'cancelled' || assets.some((asset) => asset.runId === run.id));
    for (const run of [...shown].sort(byNewest('createdAt'))) { const themeId = run.kit?.themeId || ''; add(themeId || `run:${run.id}`, { themeId, title: run.kit?.sourceTitle || run.title || 'Trend' }, run.createdAt).runs.push(run); }
    for (const asset of assets) { if (!runs.some((run) => run.id === asset.runId)) add(asset.themeId || `run:${asset.runId}`, { themeId: asset.themeId || '', title: asset.title || 'Trend' }, asset.createdAt); }
    return [...byKey.values()].map((entry) => { const trend = trends.find((row) => row.themeId && row.themeId === entry.themeId) || null; return { ...entry, trend, title: trend?.name || entry.title, files: assets.filter((asset) => entry.runs.some((run) => run.id === asset.runId)) }; })
      .filter((entry) => entry.runs.length).sort(byNewest('latestAt'));
  }, [view?.runs, view?.assets, trends]);

  // Thumbnails load three at a time and stay cached for the session. Each picture is asked for once: a picture that
  // arrives only shortens the list, and must not restart the loaders on pictures already on their way. A failed one is
  // asked for again the next time the list changes.
  const pictureIds = assets.filter((asset) => asset.kind === 'image' && !images[`studio:${asset.id}`]).map((asset) => asset.id);
  const requested = useRef(new Set());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const queue = pictureIds.filter((id) => !requested.current.has(id));
    if (!queue.length || !api.readStudioAsset) return;
    for (const id of queue) requested.current.add(id);
    const worker = async () => {
      while (mounted.current && queue.length) {
        const id = queue.shift(); let loaded = false;
        try { const url = (await api.readStudioAsset({ assetId: id }))?.imageDataUrl; if (mounted.current && typeof url === 'string' && url.startsWith('data:image/')) { remember(`studio:${id}`, url); loaded = true; } } catch { /* the thumbnail keeps its placeholder */ }
        if (!loaded) requested.current.delete(id);
      }
      for (const id of queue) requested.current.delete(id); // left unasked after an unmount
    };
    Promise.all([worker(), worker(), worker()]);
  }, [pictureIds.join('|')]);

  // A trend opened from its card is jumped to once, when its group is there; later changes don't pull focus back.
  const focused = useRef('');
  useEffect(() => {
    if (!focusThemeId || focused.current === focusThemeId) return;
    const node = document.getElementById(domId('channel-group', focusThemeId));
    if (!node) return;
    focused.current = focusThemeId;
    node.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    node.focus({ preventScroll: true });
  }, [focusThemeId, groups.length]);

  async function save(run) {
    setSaving(run.id);
    try { const result = await runWith(action, () => api.saveAssetKitFolder({ runId: run.id })); if (result !== null && !result?.cancelled) showToast(web ? 'Download started.' : 'Saved to your Downloads folder.'); }
    catch (failure) { showToast(failure?.message || 'The folder couldn’t be saved. Try again.', { tone: 'error' }); }
    finally { setSaving(''); }
  }
  async function openFile(asset) {
    try { await runWith(action, () => api.openStudioAsset({ assetId: asset.id })); if (web) showToast('Download started.'); }
    catch (failure) { showToast(failure?.message || 'That file couldn’t be opened.', { tone: 'error' }); }
  }
  function moveFile(step) {
    if (!reading) return;
    const order = list(reading.run.jobs).filter((job) => job.kind !== 'image').map((job) => assets.find((asset) => asset.runId === reading.run.id && asset.deliverableId === job.id)).filter(Boolean);
    const next = order[order.findIndex((asset) => asset.id === reading.asset.id) + step];
    if (next) setReading({ asset: next, run: reading.run });
  }
  function movePicture(step) {
    if (!picture) return;
    const next = picture.pictures[picture.pictures.findIndex((asset) => asset.id === picture.asset.id) + step];
    if (next) setPicture({ ...picture, asset: next });
  }
  const labelOf = (asset, run) => fileLabel(list(run?.jobs).find((job) => job.id === asset.deliverableId)?.label || '');
  if (!view) return <ChannelLoading title="My assets" />;

  return <div className="studio-screen studio-page channel-page channel-assets" data-spot="assets.my-channel">
    <div className="studio-page-head"><div>
      <h1>My assets · {channel.name || 'your channel'}</h1>
      <p>Drafts made for {channel.name || 'your channel'}, by trend, newest first.</p>
    </div></div>
    {!groups.length && <div className="studio-empty big"><FolderOpen size={28} aria-hidden="true" /><p>No drafts yet. On Trends, choose a trend and press Generate for my channel.</p></div>}
    {groups.map((group) => {
      const hid = domId('channel-group', group.themeId || group.key);
      return <section className="channel-asset-group" key={group.key} aria-labelledby={hid}>
        <header className="channel-asset-head">
          <div><h2 id={hid} tabIndex={-1}>{group.title}</h2><p>{[plural(group.runs.length, 'set'), plural(group.files.length, 'file')].join(' · ')}</p></div>
          {group.trend && <button type="button" className="studio-quiet small" aria-describedby={hid} disabled={!group.trend.primaryReportId} onClick={() => setBrief(group.trend)}><FileText size={15} aria-hidden="true" />Read the brief</button>}
        </header>
        {group.trend && <AnswerRow api={api} trend={group.trend} answer={answers.of(group.trend)} channel={channel} viewer={viewer} describedBy={hid} onAnswer={(next) => answers.save(group.trend, next)} />}
        <div className="channel-sets">{group.runs.map((run) => <ChannelSet key={run.id} run={run} assets={assets.filter((asset) => asset.runId === run.id)} web={web} cache={images} saving={saving === run.id || busy} onCard={group.trend?.latestRun?.id === run.id} onSave={() => save(run)} onOpenFile={(asset) => setReading({ asset, run })} onOpenPicture={(asset, pictures) => setPicture({ asset, pictures, run })} />)}</div>
      </section>;
    })}
    {reading && <ChannelFileReader api={api} web={web} file={reading} label={labelOf(reading.asset, reading.run)} onClose={() => setReading(null)} onMove={moveFile} onFile={openFile} />}
    {picture && <ChannelLightbox web={web} picture={picture} cache={images} onClose={() => setPicture(null)} onMove={movePicture} onFile={openFile} />}
    {brief && <ChannelBriefReader api={api} trend={brief} onClose={() => setBrief(null)} />}
    {toast}
  </div>;
}
