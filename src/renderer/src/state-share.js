// Structural sharing for pushed state. Every push from the main process (IPC) or the server (JSON) is a brand-new copy
// of the whole studio state, so every slice changes identity even when nothing in it changed, and every useMemo and
// useEffect keyed on a slice runs again: the trend board, the library tree, the Inbox and the sidebar were rebuilt on
// each progress tick of a run. shareState(previous, next) returns `next` with every part that is deep-equal to the
// previous one replaced by the previous object, two levels down (state.contentStudio.researchRuns keeps its identity
// when only state.contentStudio.contentRuns changed), and returns `previous` itself when nothing changed at all, so
// React skips the render.
//
// Equality is by JSON text: the state is plain JSON by construction (it crossed IPC or HTTP). The text of each part is
// remembered against the object it came from, so each part is stringified once per push, never twice.
const texts = new WeakMap();
const isObject = (value) => value !== null && typeof value === 'object';
function textOf(value) {
  if (!isObject(value)) return JSON.stringify(value) ?? 'undefined';
  let text = texts.get(value);
  if (text === undefined) { text = JSON.stringify(value); texts.set(value, text); }
  return text;
}
const same = (a, b) => a === b || (isObject(a) && isObject(b) && Array.isArray(a) === Array.isArray(b) && textOf(a) === textOf(b)) || (!isObject(a) && !isObject(b) && Object.is(a, b));

// One level: an object whose values are the previous ones wherever they are equal; the previous object when all are.
function shareKeys(previous, next, deeper) {
  if (!isObject(previous) || !isObject(next) || Array.isArray(previous) || Array.isArray(next)) return same(previous, next) ? previous : next;
  const keys = Object.keys(next);
  let kept = keys.length === Object.keys(previous).length;
  const out = {};
  for (const key of keys) {
    const before = previous[key]; const after = next[key];
    const shared = !(key in previous) ? after : deeper ? deeper(before, after) : same(before, after) ? before : after;
    if (shared !== before || !(key in previous)) kept = false;
    out[key] = shared;
  }
  if (!kept) return out;
  // Every value is the previous one: the object is unchanged, and remembers its text for the next comparison.
  return previous;
}

export function shareState(previous, next) {
  if (!isObject(previous) || !isObject(next)) return next;
  try { return shareKeys(previous, next, (before, after) => shareKeys(before, after, null)); }
  catch { return next; } // something that isn't plain JSON (a cycle): take the push as it is
}
