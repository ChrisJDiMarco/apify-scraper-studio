'use strict';
// Channels an admin adds to a workspace (Studio setup › Channels › Add channel), on top of the built-in channels in
// kit-folders.json. Main-only CommonJS; the renderer's copy of the list is channel-table.js.
//
// A custom channel makes the same kinds of assets as the built-in formats it picks (`formats`: text deliverable ids such
// as `social` or `newsletter`). Each format becomes the channel's own deliverable, `<channelId>--<format>`, which writes
// with that format's sections, schema and Prompt Library prompt (assets.<format>) plus the channel's own knowledge, and
// is filed under the custom channel because its id starts with the channel's. Channel ids are `c-<slug>`, so they never
// collide with a built-in id or 'other'.
//
// content-workspace.js registers every workspace's custom channels here when it loads and after each change, and says
// which workspace is current (setWorkspaceResolver): kitFolders() lists the current workspace's channels, while lookups
// by id (isCustomChannelId, channelIdOf, descriptors) work for any workspace's, archived ones included, so assets made
// for a channel that was later removed still read.
const CHANNEL_ID = /^c-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEP = '--';
const MAX_CHANNELS = 30;
const MAX_FORMATS = 4;

let registered = []; // [{ id, workspaceId, name, short, formats, archived, createdAt }]
let resolveWorkspace = () => '';
const listeners = new Set();

const clean = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
function setWorkspaceResolver(fn) { resolveWorkspace = typeof fn === 'function' ? fn : () => ''; }
function currentWorkspace() { try { return String(resolveWorkspace() || ''); } catch (_) { return ''; } }
// Every workspace's custom channels, each with its workspaceId. Malformed rows are dropped, never thrown on: this runs
// when the studio loads.
function setCustomChannels(list) {
  const seen = new Set();
  registered = (Array.isArray(list) ? list : []).filter((row) => row && CHANNEL_ID.test(String(row.id || '')) && clean(row.name, 60) && Array.isArray(row.formats) && row.formats.length)
    .filter((row) => { const key = `${row.workspaceId || ''}:${row.id}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .map((row) => ({ id: row.id, workspaceId: String(row.workspaceId || ''), name: clean(row.name, 60), short: clean(row.short, 24) || clean(row.name, 24), formats: [...new Set(row.formats.map(String))].slice(0, MAX_FORMATS), archived: Boolean(row.archived), createdAt: row.createdAt || '' }));
  for (const listener of listeners) { try { listener(registered); } catch (_) { /* a listener never stops registration */ } }
}
function onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
// The current workspace's live channels (or one workspace's, by id).
function customChannels(workspaceId = currentWorkspace()) {
  return registered.filter((row) => !row.archived && (!workspaceId || row.workspaceId === workspaceId));
}
function allCustomChannels() { return registered; }
const isCustomChannelId = (id) => registered.some((row) => row.id === id && !row.archived);
const deliverableIdFor = (channelId, format) => `${channelId}${SEP}${format}`;
// `c-podcast--social` → { channelId: 'c-podcast', format: 'social' }; anything else → null.
function parseDeliverableId(deliverableId) {
  const value = String(deliverableId || ''); const at = value.indexOf(SEP);
  if (at < 3 || !value.startsWith('c-')) return null;
  const channelId = value.slice(0, at); const format = value.slice(at + SEP.length);
  return CHANNEL_ID.test(channelId) && format ? { channelId, format } : null;
}
// The built-in deliverable a custom one writes like (its prompt, sections and estimate), or the id itself.
const baseDeliverableId = (deliverableId) => parseDeliverableId(deliverableId)?.format || String(deliverableId || '');
const channelIdOf = (deliverableId) => parseDeliverableId(deliverableId)?.channelId || '';
const channelById = (channelId) => registered.find((row) => row.id === channelId) || null;
// A folder row in kit-folders.json's shape, so asset-kit.js and drive-sync.js treat it like a built-in channel.
const folderOf = (row) => ({ id: row.id, semrush: row.name, general: row.name, semrushShort: row.short, generalShort: row.short, deliverables: row.formats.map((format) => deliverableIdFor(row.id, format)), custom: true });
// A new channel's id from its name: c-<slug>, made unique against `taken`.
function newChannelId(name, taken = []) {
  const slug = clean(name, 60).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '') || 'channel';
  const used = new Set(taken); let id = `c-${slug}`; let n = 2;
  while (used.has(id)) { id = `c-${slug}-${n}`; n += 1; }
  return id;
}

module.exports = { CHANNEL_ID, SEP, MAX_CHANNELS, MAX_FORMATS, setWorkspaceResolver, setCustomChannels, onChange, customChannels, allCustomChannels, isCustomChannelId, deliverableIdFor, parseDeliverableId, baseDeliverableId, channelIdOf, channelById, folderOf, newChannelId };
