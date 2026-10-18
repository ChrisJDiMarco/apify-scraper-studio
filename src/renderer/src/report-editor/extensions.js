import { Extension, InputRule } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { resolveAnchor } from './ydoc.js';
import { safeHref } from './markdown.js';

// The report editor's own plugins: note highlights, the Markdown link shortcut and the Add note shortcut.

export const noteHighlightsKey = new PluginKey('reportNoteHighlights');

// Open notes (and the note being written) drawn as soft highlights. Their places are worked out from the anchors when
// the notes change or someone else's edit arrives (Yjs has the positions then), and mapped through local typing.
// Clicking a highlight opens that note. Ask for a redraw with refreshNoteHighlights(editor).
function decorationsFor(state, notes, activeId) {
  const marks = [];
  for (const note of notes) {
    if (!note?.anchor || note.resolved) continue;
    const { from, to, changed } = resolveAnchor(state, note.anchor);
    if (changed || from === null) continue;
    const active = note.id === activeId;
    marks.push(Decoration.inline(from, to, { class: `rd-note-mark${active ? ' is-active' : ''}${note.draft ? ' is-draft' : ''}`, 'data-note-id': note.id }, { noteId: note.id }));
  }
  return DecorationSet.create(state.doc, marks);
}

export const NoteHighlights = Extension.create({
  name: 'reportNoteHighlights',
  addOptions() { return { getNotes: () => [], getActive: () => '', onOpen: () => {} }; },
  addProseMirrorPlugins() {
    const { getNotes, getActive, onOpen } = this.options;
    return [new Plugin({
      key: noteHighlightsKey,
      state: {
        init: (_, state) => decorationsFor(state, getNotes(), getActive()),
        apply(tr, set, _old, state) {
          const remote = tr.getMeta(ySyncPluginKey)?.isChangeOrigin;
          if (tr.getMeta(noteHighlightsKey) || remote) return decorationsFor(state, getNotes(), getActive());
          return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
        },
      },
      props: {
        decorations: (state) => noteHighlightsKey.getState(state),
        handleDOMEvents: {
          click: (_view, event) => {
            const mark = event.target?.closest?.('[data-note-id]');
            if (!mark) return false;
            const id = mark.getAttribute('data-note-id');
            if (id && id !== '__draft') onOpen(id);
            return false;
          },
        },
      },
    })];
  },
});

export function refreshNoteHighlights(editor) {
  if (!editor || editor.isDestroyed) return;
  try { editor.view.dispatch(editor.state.tr.setMeta(noteHighlightsKey, true).setMeta('addToHistory', false)); } catch { /* the editor is going away */ }
}

// [text](https://…) typed in the text becomes a link, as in Markdown.
export const MarkdownLink = Extension.create({
  name: 'reportMarkdownLink',
  addInputRules() {
    return [new InputRule({
      find: /\[([^\]]+)\]\(([^)\s]+)\)$/,
      handler: ({ state, range, match }) => {
        const href = safeHref(match[2]);
        const link = state.schema.marks.link;
        if (!href || !link) return null;
        state.tr.replaceWith(range.from, range.to, state.schema.text(match[1], [link.create({ href })]));
        state.tr.removeStoredMark(link);
        return undefined;
      },
    })];
  },
});

// ⌘⌥M (Ctrl+Alt+M) adds a note on the selection, as in Google Docs.
export const NoteShortcut = Extension.create({
  name: 'reportNoteShortcut',
  addOptions() { return { onAddNote: () => false }; },
  addKeyboardShortcuts() { return { 'Mod-Alt-m': () => Boolean(this.options.onAddNote()) }; },
});
