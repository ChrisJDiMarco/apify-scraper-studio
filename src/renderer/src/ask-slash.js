// Ask AI's / commands and keyboard shortcuts, and the drag-and-drop format that lets a report, folder or trend be
// dropped into the chat. Plain data and pure functions (ESM), so the composer, the shortcuts dialog and the rows that
// can be dragged all read the same lists.
//
// No command starts paid studio work by itself: /scan asks Ask AI to plan a scan, and the plan's card shows the cost and
// its own Start button. /remember saves to memory for free; /memory, /new and /help never call the AI.

export const SLASH_COMMANDS = Object.freeze([
  { id: 'scan', usage: '/scan topic', label: 'Plan a quick scan', hint: 'You see the plan and its cost before anything runs.', arg: 'topic', needs: ['startQuickScan'] },
  { id: 'summarize', usage: '/summarize', label: 'Summarize what changed since the last research run', needs: ['readStudioRun'] },
  { id: 'report', usage: '/report title', label: 'Ask about a report', hint: 'Attaches the report to your question.', arg: 'title', attach: 'report' },
  { id: 'trend', usage: '/trend name', label: 'Ask about a trend', hint: 'Attaches the trend to your question.', arg: 'name', attach: 'trend' },
  { id: 'draft', usage: '/draft kind', label: 'Draft a Slack, email, LinkedIn or X post', hint: 'Add “about …”, or attach a report first.', arg: 'kind' },
  { id: 'picture', usage: '/picture description', label: 'Create a picture', arg: 'description', needs: ['createHelpImage'], pictures: true },
  { id: 'remember', usage: '/remember text', label: 'Remember something', hint: 'Free. Saved to what Ask AI remembers about you.', arg: 'text', needs: ['saveAskMemory'] },
  { id: 'memory', usage: '/memory', label: 'Open what Ask AI remembers', needs: ['listAskMemory'] },
  { id: 'new', usage: '/new', label: 'Start a new conversation' },
  { id: 'help', usage: '/help', label: 'List these commands' },
]);
const DRAFT_KINDS = { slack: 'Slack', email: 'email', linkedin: 'LinkedIn', x: 'X' };

// The commands this person can use here. `can(method)` is the role check; `memoryOn` and `imagesReady` say whether the
// memory panel and pictures exist in this layout.
export function slashCommandsFor({ can = () => true, imagesReady = false, memoryOn = true } = {}) {
  return SLASH_COMMANDS.filter((command) => (command.needs || []).every((method) => can(method)) && (!command.pictures || imagesReady) && (command.id !== 'memory' || memoryOn) && (command.id !== 'remember' || memoryOn));
}
// "/sca" → the commands it could be; null when the text isn't a command being typed (no slash, or past the first word).
export function matchSlash(text, commands = SLASH_COMMANDS) {
  const value = String(text ?? '');
  if (!value.startsWith('/') || /\s/.test(value)) return null;
  const want = value.slice(1).toLowerCase();
  return commands.filter((command) => command.id.startsWith(want));
}
// "/scan AI Overviews" → { command, rest: 'AI Overviews' }; null when the text doesn't start with a known command.
export function parseSlash(text, commands = SLASH_COMMANDS) {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
  if (!match) return null;
  const command = commands.find((row) => row.id === match[1].toLowerCase());
  return command ? { command, rest: String(match[2] || '').trim() } : null;
}

// What a command does, as data the panel acts on:
//   { ask } a question to send · { attach: { kind, query } } pick an item to attach · { remember } save to memory
//   { open: 'memory' } · { reset: true } a new conversation · { help: true } list the commands · { needs } what to add
// `attached` is the title of something already attached (a draft "about" it), when there is one.
export function slashAction({ command, rest = '' } = {}, { attached = '' } = {}) {
  const words = String(rest || '').trim();
  switch (command?.id) {
    case 'scan': return words ? { ask: `Plan a quick scan on ${words}` } : { needs: 'Add a topic: /scan AI Overviews' };
    case 'summarize': return { ask: 'Summarize what changed since the last research run.' };
    case 'report': return { attach: { kind: 'report', query: words } };
    case 'trend': return { attach: { kind: 'trend', query: words } };
    case 'draft': {
      const [first = '', ...others] = words.split(/\s+/); const kind = DRAFT_KINDS[first.toLowerCase()];
      if (!kind) return { needs: 'Say which kind: /draft slack, /draft email, /draft linkedin or /draft x' };
      const about = others.join(' ').replace(/^about\s+/i, '').trim() || (attached ? `“${attached}”` : '');
      return about ? { ask: `Draft a ${kind} post about ${about}` } : { needs: `Say what it’s about: /draft ${first.toLowerCase()} about AI Overviews` };
    }
    case 'picture': return words ? { ask: `Create a picture: ${words}` } : { needs: 'Describe the picture: /picture a hero image for AI Overviews' };
    case 'remember': return words ? { remember: words } : { needs: 'Add what to remember: /remember Keep LinkedIn posts under 150 words' };
    case 'memory': return { open: 'memory' };
    case 'new': return { reset: true };
    case 'help': return { help: true };
    default: return null;
  }
}

// The Keyboard shortcuts dialog's "In Ask AI" section (keyboard-shortcuts.jsx) and the composer's own handling.
export const ASK_SHORTCUTS = Object.freeze([
  { keys: 'Enter', label: 'Send your question' },
  { keys: '⇧Enter', label: 'Start a new line' },
  { keys: '↑', label: 'Edit your last question (in an empty box)' },
  { keys: 'Esc', label: 'Stop an answer that’s being written' },
  { keys: '/', label: 'Commands, or jump to the question box' },
]);

// Reports, folders and trends dragged into Ask AI. The row being dragged is also remembered here, so the drop overlay can
// name it while the drag is still over the panel (a page can't read the dragged data before the drop).
export const STUDIO_REF_TYPE = 'application/x-studio-ref';
const REF_KINDS = ['report', 'asset-folder', 'trend', 'run'];
let dragging = null;
export const currentStudioDrag = () => dragging;
export function studioRefDragProps({ kind, ref, id = '' } = {}) {
  if (!REF_KINDS.includes(kind) || !String(ref || '').trim()) return {};
  const item = { kind, ref: String(ref).trim().slice(0, 200), id: String(id || '').slice(0, 200) };
  return {
    draggable: true,
    onDragStart: (event) => {
      dragging = item;
      try { event.dataTransfer.setData(STUDIO_REF_TYPE, JSON.stringify(item)); event.dataTransfer.setData('text/plain', item.ref); event.dataTransfer.effectAllowed = 'copy'; } catch { /* the drop reads `dragging` */ }
      try { window.dispatchEvent(new CustomEvent('studio-ref-drag', { detail: item })); } catch { /* a courtesy for the Ask AI sidebar item */ }
    },
    onDragEnd: () => { dragging = null; try { window.dispatchEvent(new CustomEvent('studio-ref-drag', { detail: null })); } catch { /* as above */ } },
  };
}
// For a row that is already draggable for its own reasons (a trend card moving between board columns): adds the studio
// item to its drag without changing what the drag allows. clearStudioDrag() goes in its dragend.
export function markStudioDrag(event, { kind, ref, id = '' } = {}) {
  if (!REF_KINDS.includes(kind) || !String(ref || '').trim()) return;
  dragging = { kind, ref: String(ref).trim().slice(0, 200), id: String(id || '').slice(0, 200) };
  try { event.dataTransfer.setData(STUDIO_REF_TYPE, JSON.stringify(dragging)); } catch { /* the drop reads `dragging` */ }
  try { window.dispatchEvent(new CustomEvent('studio-ref-drag', { detail: dragging })); } catch { /* a courtesy */ }
}
export function clearStudioDrag() { dragging = null; try { window.dispatchEvent(new CustomEvent('studio-ref-drag', { detail: null })); } catch { /* a courtesy */ } }
// The studio item a drop carries, or null.
export function readStudioRef(dataTransfer) {
  let raw = '';
  try { raw = dataTransfer?.getData?.(STUDIO_REF_TYPE) || ''; } catch { raw = ''; }
  let item = null;
  try { item = raw ? JSON.parse(raw) : dragging; } catch { item = dragging; }
  if (!item || !REF_KINDS.includes(item.kind) || typeof item.ref !== 'string' || !item.ref.trim()) return null;
  return { kind: item.kind, ref: item.ref.trim().slice(0, 200), id: typeof item.id === 'string' ? item.id : '' };
}
export const dragHasStudioRef = (dataTransfer) => { try { return [...(dataTransfer?.types || [])].includes(STUDIO_REF_TYPE) || Boolean(dragging); } catch { return Boolean(dragging); } };
export const dragHasFiles = (dataTransfer) => { try { return [...(dataTransfer?.types || [])].includes('Files'); } catch { return false; } };
export const REF_LABEL = Object.freeze({ report: 'report', 'asset-folder': 'folder', trend: 'trend', run: 'run' });
