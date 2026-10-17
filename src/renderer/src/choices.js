// Choices a person makes that the studio should remember for them on this device: the research program they last
// picked, how they like Trends laid out, the filters they keep on Reports and Inbox. Per person (keyed on viewer.id, so
// two people sharing a browser don't trade choices) and per browser. Storage can be missing or blocked (a private
// window, a preview frame), so every read falls back and every write is best effort: the page works without it.
const PREFIX = 'studio.choice';
const keyOf = (viewer, name) => `${PREFIX}.${String(viewer?.id || 'local')}.${name}`;

export function readChoice(viewer, name, fallback = '') {
  try { const value = window.localStorage?.getItem(keyOf(viewer, name)); return value == null ? fallback : value; } catch { return fallback; }
}
export function saveChoice(viewer, name, value) {
  try { if (value == null || value === '') window.localStorage?.removeItem(keyOf(viewer, name)); else window.localStorage?.setItem(keyOf(viewer, name), String(value)); } catch { /* a convenience only */ }
}
export function readJsonChoice(viewer, name, fallback = null) {
  const text = readChoice(viewer, name, '');
  if (!text) return fallback;
  try { const value = JSON.parse(text); return value && typeof value === 'object' ? value : fallback; } catch { return fallback; }
}
export const saveJsonChoice = (viewer, name, value) => saveChoice(viewer, name, value ? JSON.stringify(value) : '');

// The newest program first (saving moves a program to the end of state.programs, so list order says nothing).
export const newestProgramFirst = (a, b) => String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || ''));
// The one rule every "Find new trends" button uses: the program picked here (`id`), else the one this person chose last,
// else the newest. A program that's gone falls through to the next rule.
export function defaultProgram(programs, { id = '', lastId = '' } = {}) {
  const rows = Array.isArray(programs) ? programs.filter(Boolean) : [];
  return (id && rows.find((row) => row.id === id)) || (lastId && rows.find((row) => row.id === lastId)) || [...rows].sort(newestProgramFirst)[0] || null;
}
export const LAST_PROGRAM = 'lastProgramId';
export const lastProgramId = (viewer) => readChoice(viewer, LAST_PROGRAM, '');
export const rememberProgram = (viewer, programId) => { if (programId) saveChoice(viewer, LAST_PROGRAM, programId); };
