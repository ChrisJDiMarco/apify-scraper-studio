// The channel table the renderer reads: the built-in channels (kit-folders.json) plus the ones an admin added to the
// current workspace (custom-channels.js on the server, state.contentStudio.customChannels here; App sets them on every
// state push). Readers use KIT.folders when they need it rather than caching it, so an added channel appears on the
// next render. A custom channel's deliverables are `<channelId>--<format>`, which is how its files find their channel.
import BUILT_IN from './kit-folders.json';

const SEP = '--';
const KIT = { ...BUILT_IN, folders: [...BUILT_IN.folders] };
let custom = [];
let lastKey = '';

export function setCustomChannels(list, assetTypes = []) {
  const rows = (Array.isArray(list) ? list : []).filter((row) => row && !row.archived && /^c-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(row.id || '')) && Array.isArray(row.formats) && row.formats.length);
  const key = JSON.stringify([rows.map((row) => [row.id, row.name, row.short, row.formats]), assetTypes]);
  if (key === lastKey) return;
  lastKey = key;
  custom = rows.map((row) => ({ id: row.id, name: String(row.name || row.id), short: String(row.short || row.name || row.id), formats: row.formats.map(String) }));
  KIT.folders = [...BUILT_IN.folders, ...custom.map((row) => ({ id: row.id, semrush: row.name, general: row.name, semrushShort: row.short, generalShort: row.short, deliverables: row.formats.map((format) => `${row.id}${SEP}${format}`), custom: true }))].map((folder) => ({
    ...folder, deliverables: [...folder.deliverables, ...assetTypes.filter((type) => type.channelId === folder.id).map((type) => type.id)],
  }));
}
export const customChannelList = () => custom;
export const isCustomChannel = (id) => custom.some((row) => row.id === id);
// `c-podcast--social` → 'c-podcast'; anything else → ''.
export function customChannelIdOf(deliverableId) {
  const value = String(deliverableId || ''); const at = value.indexOf(SEP);
  const assetChannel = /^a-([a-z0-9]+(?:-[a-z0-9]+)*)--[a-f0-9-]{36}$/.exec(value)?.[1];
  if (assetChannel) return assetChannel;
  return value.startsWith('c-') && at > 2 ? value.slice(0, at) : '';
}
export const BUILT_IN_FOLDERS = BUILT_IN.folders;
export default KIT;
