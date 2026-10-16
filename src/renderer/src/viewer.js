import { createContext, useCallback, useContext } from 'react';

// Who is looking at the studio, as the server projected it (state.viewer). The server enforces access; the renderer
// only hides what the role can't do. Labels live here (not in roles.json) so a renderer import never pulls in policy.
export const ROLE_LABELS = Object.freeze({ admin: 'Admin', editor: 'Editor', channel: 'Channel owner' });
export const ROLE_DESCRIPTIONS = Object.freeze({
  admin: 'Everything, including settings, people and analytics.',
  editor: 'Finds trends, writes and edits reports, makes assets for any channel.',
  channel: 'Sees new trends and their channel’s assets, and says which trends they used.',
});
export const ROLE_IDS = Object.freeze(['admin', 'editor', 'channel']);
export const PREVIEW_TITLE = 'Buttons that change things are off in a preview.';

// Old mocks and the Mac app before its first state push: an admin who may call everything (allowed: null).
export const LOCAL_ADMIN_FALLBACK = Object.freeze({
  id: 'local', name: 'You', email: '', role: 'admin', realRole: 'admin', channelId: null, channelName: '', via: 'desktop', web: false, disabled: false, memberSince: '',
  preview: false, viewAs: null, prefs: Object.freeze({}), nav: null, modes: Object.freeze(['simple', 'classic']), hiddenPages: Object.freeze([]), allowed: null, channels: Object.freeze([]),
});

export const ViewerContext = createContext(LOCAL_ADMIN_FALLBACK);
export const useViewer = () => useContext(ViewerContext) || LOCAL_ADMIN_FALLBACK;
// can: whether this role has the control, so whether to show it. In an admin's preview that is the previewed role's
// (viewer.roleAllowed), so the preview shows what that person sees; its write buttons render disabled (writeProps).
// canRun: whether the server takes the call now (viewer.allowed: a preview allows reads only). Guard calls with canRun.
export const can = (viewer, method) => !viewer?.allowed || (Array.isArray(viewer.roleAllowed) ? viewer.roleAllowed : viewer.allowed).includes(method);
export const canRun = (viewer, method) => !viewer?.allowed || viewer.allowed.includes(method);
export function useCan() {
  const viewer = useViewer();
  return useCallback((method) => can(viewer, method), [viewer]);
}
export function useCanRun() {
  const viewer = useViewer();
  return useCallback((method) => canRun(viewer, method), [viewer]);
}

export const roleLabel = (role) => ROLE_LABELS[role] || 'No access';
export const roleDescription = (role) => ROLE_DESCRIPTIONS[role] || '';
export const isPreview = (viewer) => Boolean(viewer?.preview);
// Spread onto any button that changes something: off in a preview, with the reason as its title.
export const writeProps = (viewer, disabled = false) => (viewer?.preview ? { disabled: true, title: PREVIEW_TITLE } : { disabled: Boolean(disabled) });
// "Semrush Blog’s channel owner" or "an editor", for the preview banner and its announcement.
export function previewWho(viewer) {
  if (viewer?.role === 'channel') return viewer.channelName ? `${viewer.channelName}’s channel owner` : 'a channel owner';
  return viewer?.role === 'editor' ? 'an editor' : 'an admin';
}
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
export function initials(name) {
  const words = String(name || '').trim().split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '?';
}

// "Chris DiMarco", "Chris DiMarco or Pat Lee", "Chris, Pat or Alex"; the fallback when the team has no admins listed.
export function joinOr(names) {
  const rows = [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))];
  if (rows.length <= 1) return rows[0] || '';
  return `${rows.slice(0, -1).join(', ')} or ${rows[rows.length - 1]}`;
}
export function adminNames(state, fallback = 'an admin') {
  const admins = Array.isArray(state) ? state : Array.isArray(state?.team?.admins) ? state.team.admins : Array.isArray(state?.admins) ? state.admins : [];
  return joinOr(admins.slice(0, 3).map((row) => (typeof row === 'string' ? row : row?.name))) || fallback;
}

// Dates in the viewer's locale: "Oct 12" this year, "Oct 12, 2025" otherwise.
export function formatDay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.getFullYear() === new Date().getFullYear() ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
export const formatTime = (value) => { const date = new Date(value || 0); return Number.isNaN(date.getTime()) || !value ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
export const plural = (count, word, many = `${word}s`) => `${new Intl.NumberFormat().format(Number(count) || 0)} ${Number(count) === 1 ? word : many}`;
