import React, { useMemo, useState } from 'react';
import { ArrowRight, Bell, CheckCheck, CircleAlert, FileText, FolderOpen, Megaphone, PenLine, Radar, ScrollText, Send, TrendingUp } from 'lucide-react';
import { INBOX_KIND_LABEL, buildInbox } from './inbox-model.js';
import { formatDay, useViewer, writeProps } from './viewer.js';
import './weekly-briefing.css';

// Inbox, for every role: trends that need this person's OK, channel answers, edits, finished and stopped runs, prompt
// changes and (for channel owners) trends routed to their channel. Built on the client from the pushed state
// (inbox-model.js); "Mark all read" saves the time in the person's prefs (setViewPrefs({ inboxSeenAt })), with this
// browser's copy as a fallback when the studio can't save it.
const LOCAL_SEEN = 'studio.inbox.seenAt';
const ICONS = { 'needs-ok': TrendingUp, adoption: Megaphone, edit: PenLine, 'run-finished': Radar, 'run-stopped': CircleAlert, 'prompt-change': ScrollText, routed: Send };
const TARGET_ICONS = { report: FileText, folder: FolderOpen };
const readLocal = () => { try { return window.localStorage.getItem(LOCAL_SEEN) || ''; } catch { return ''; } };
const writeLocal = (value) => { try { window.localStorage.setItem(LOCAL_SEEN, value); } catch { /* a convenience only */ } };
const later = (a, b) => ((Date.parse(a || '') || 0) >= (Date.parse(b || '') || 0) ? a || '' : b || '');

// When something happened, in short words: "Just now", "3 hours ago", "Yesterday", "Oct 14".
export function whenLabel(value, now = Date.now()) {
  const ms = Date.parse(value || ''); if (!Number.isFinite(ms)) return '';
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (minutes < 24 * 60) { const hours = Math.round(minutes / 60); return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`; }
  const today = new Date(now); const then = new Date(ms);
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(then.getFullYear(), then.getMonth(), then.getDate())) / 86400000);
  return days === 1 ? 'Yesterday' : formatDay(value);
}

// The unread count for the sidebar's Inbox badge, from the same rows.
export function inboxUnread(state, viewer) {
  return buildInbox({ state, viewer, seenAt: later(viewer?.prefs?.inboxSeenAt, readLocal()) }).unread;
}

export function InboxView({ state = {}, viewer: viewerIn, api = {}, onOpenTarget, onMarkRead }) {
  const contextViewer = useViewer(); const viewer = viewerIn || contextViewer;
  const [seenLocal, setSeenLocal] = useState(readLocal);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [note, setNote] = useState('');
  const seenAt = later(viewer.prefs?.inboxSeenAt, seenLocal);
  const { items, unread } = useMemo(() => buildInbox({ state, viewer, seenAt }), [state.contentStudio, state.activity, viewer, seenAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const kinds = [...new Set(items.map((item) => item.kind))];
  const shown = items.filter((item) => filter === 'all' || (filter === 'unread' ? item.unread : item.kind === filter));
  async function markAllRead() {
    if (saving || viewer.preview || !items.length) return;
    const now = new Date().toISOString();
    setSaving(true); setNote(''); setSeenLocal(now); writeLocal(now);
    try { if (typeof api.setViewPrefs === 'function') await api.setViewPrefs({ inboxSeenAt: now }); setNote('All caught up.'); onMarkRead?.(now); }
    catch { setNote('Marked read on this browser. The studio couldn’t save it for your other devices.'); onMarkRead?.(now); }
    finally { setSaving(false); }
  }
  return <div className="studio-screen studio-page ib-page">
    <div className="studio-page-head"><div><h1>Inbox</h1><p>{unread ? `${unread} new since you last looked.` : 'You’re all caught up.'} What changed that needs you, from the last 30 days.</p></div>
      <div className="studio-head-actions"><button type="button" className="studio-quiet" {...writeProps(viewer, saving || !unread)} onClick={markAllRead}><CheckCheck size={15} aria-hidden="true" />Mark all read</button></div></div>
    <p className="ib-note" role="status">{note}</p>
    {items.length > 0 && <div className="studio-filters" role="group" aria-label="Show">
      {[['all', 'All', items.length], ['unread', 'Unread', unread], ...kinds.map((kind) => [kind, INBOX_KIND_LABEL[kind] || kind, items.filter((item) => item.kind === kind).length])].filter(([value, , count]) => value === 'all' || count).map(([value, label, count]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}
    </div>}
    {!items.length ? <div className="studio-empty big ib-empty"><Bell size={28} aria-hidden="true" /><p>Nothing here yet. Trends that need your OK, finished and stopped runs, channel answers and edits to reports show up here as they happen.</p></div>
      : !shown.length ? <div className="studio-empty"><p>Nothing {filter === 'unread' ? 'unread' : 'like that'} right now.</p><button type="button" className="studio-quiet small" onClick={() => setFilter('all')}>Show everything</button></div>
      : <ul className="ib-list" aria-label="Inbox">{shown.map((item) => { const Icon = ICONS[item.kind] || TARGET_ICONS[item.target?.kind] || Bell; return <li key={item.id}>
        <button type="button" className={`ib-row${item.unread ? ' is-unread' : ''} kind-${item.kind}`} onClick={() => onOpenTarget?.(item.target)}>
          <span className="ib-icon" aria-hidden="true"><Icon size={17} /></span>
          <span className="ib-copy"><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>
          <span className="ib-meta"><time dateTime={item.at}>{whenLabel(item.at)}</time>{item.unread && <span className="ib-dot"><span className="sr-only">Unread</span></span>}</span>
          <ArrowRight size={15} aria-hidden="true" className="ib-go" />
          <span className="sr-only">, {INBOX_KIND_LABEL[item.kind]}</span>
        </button>
      </li>; })}</ul>}
  </div>;
}
