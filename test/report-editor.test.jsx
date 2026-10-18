// @vitest-environment jsdom
import './helpers/prosemirror-dom.js';
import '@testing-library/jest-dom/vitest';
import React, { createRef } from 'react';
import * as Y from 'yjs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEEP_ALIVE_MS, ReportDocument } from '../src/renderer/src/report-editor/ReportDocument.jsx';
import { NoteCount, noteCountFor } from '../src/renderer/src/report-editor/NoteCount.jsx';
import { requestNoteFocus } from '../src/renderer/src/report-editor/events.js';
import { FIELD, createReportYDoc, findQuote, resolveAnchor, toBase64 } from '../src/renderer/src/report-editor/ydoc.js';
import { createDocSync } from '../src/renderer/src/report-editor/sync.js';
import { ChannelBriefReader } from '../src/renderer/src/channel-owner.jsx';
import { ViewerContext } from '../src/renderer/src/viewer.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const asset = { id: 'asset-aio', title: 'AI Overviews report', deliverableId: 'evidence-report', kind: 'text' };
const MARKDOWN = '# AI Overviews\n\nZero-click searches grew fast this quarter.\n\nPublishers noticed.';
const sam = { id: 'member-sam', name: 'Sam Lee' };
const riley = { id: 'member-riley', name: 'Riley Park' };
const note = (over = {}) => ({ id: 'note-1', assetId: asset.id, anchor: { yStart: '', yEnd: '', quote: 'Zero-click searches' }, author: sam, body: 'Is this from the X data?', mentions: [], createdAt: '2026-10-17T09:00:00.000Z', editedAt: '', resolved: null, replies: [], ...over });

function liveApi(over = {}) {
  const listeners = new Set();
  return {
    openReportDoc: vi.fn(async ({ assetId }) => ({ assetId, title: asset.title, markdown: MARKDOWN, yState: '', version: 3, epoch: 1, versions: [{ id: 'v-2', at: '2026-10-17T10:00:00.000Z', by: sam, label: '' }], canEdit: true, canNote: true, editors: [{ id: 'local', name: 'You', color: '#7c5cff' }, { ...sam, color: '#1f9d74' }], members: [sam, riley] })),
    pushReportDocUpdate: vi.fn(async () => ({ version: 4, savedAt: '2026-10-18T10:00:00.000Z' })),
    closeReportDoc: vi.fn(async () => ({ ok: true })),
    restoreReportVersion: vi.fn(async ({ assetId }) => ({ assetId, markdown: '# Restored version\n\nOlder words.', yState: '', version: 5, versions: [], canEdit: true, canNote: true, editors: [] })),
    restoreStudioAsset: vi.fn(async () => ({ asset: { ...asset, edited: null } })),
    listReportNotes: vi.fn(async () => ({ notes: [note()] })),
    saveReportNote: vi.fn(async (payload) => ({ note: payload.replyTo ? { ...note(), replies: [{ id: 'reply-1', author: { id: 'local', name: 'You' }, body: payload.body, mentions: payload.mentions || [], createdAt: '2026-10-18T10:00:00.000Z' }] } : { ...note({ id: 'note-new', author: { id: 'local', name: 'You' } }), anchor: payload.anchor, body: payload.body, mentions: payload.mentions || [] } })),
    resolveReportNote: vi.fn(async ({ noteId, resolved }) => ({ note: { ...note({ id: noteId }), resolved: resolved ? { by: { id: 'local', name: 'You' }, at: '2026-10-18T10:00:00.000Z' } : null } })),
    deleteReportNote: vi.fn(async () => ({ ok: true })),
    onPersonEvent: vi.fn((listener) => { listeners.add(listener); return () => listeners.delete(listener); }),
    emit: (event) => act(() => { listeners.forEach((listener) => listener(event)); }),
    ...over,
  };
}
async function openDoc({ api = liveApi(), viewer, ...props } = {}) {
  const ref = createRef();
  const view = <ReportDocument ref={ref} api={api} asset={asset} markdown={MARKDOWN} web editable {...props} />;
  const utils = render(viewer ? <ViewerContext.Provider value={viewer}>{view}</ViewerContext.Provider> : view);
  await waitFor(() => expect(ref.current?.editor?.state.doc.textContent).toContain('Zero-click'));
  return { api, ref, editor: ref.current.editor, ...utils };
}
const select = (editor, text) => act(() => { editor.view.focus(); const spot = findQuote(editor.state.doc, text); editor.commands.setTextSelection(spot); });
const markdownOf = (ref) => ref.current.markdown();

describe('ReportDocument, live', () => {
  it('opens the live document, edits in place and autosaves the Yjs update with its Markdown', async () => {
    const { api, ref, editor } = await openDoc();
    expect(api.openReportDoc).toHaveBeenCalledWith({ assetId: asset.id, clientId: expect.any(String) });
    expect(screen.getByRole('textbox', { name: `Text of ${asset.title}` })).toHaveTextContent('Publishers noticed.');
    act(() => { editor.chain().focus('end').insertContent(' Then they adapted.').run(); });
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
    await waitFor(() => expect(api.pushReportDocUpdate).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = api.pushReportDocUpdate.mock.calls[0][0];
    expect(payload).toMatchObject({ assetId: asset.id, markdown: '# AI Overviews\n\nZero-click searches grew fast this quarter.\n\nPublishers noticed. Then they adapted.', clientId: expect.any(String) });
    expect(payload.final).toBeUndefined();
    expect(payload).toMatchObject({ epoch: 1, stateVector: expect.any(String), clientId: api.openReportDoc.mock.calls[0][0].clientId });
    // The first save carries the whole document (the studio had none yet), as a Yjs update another client can apply.
    const copy = new Y.Doc(); Y.applyUpdate(copy, Uint8Array.from(atob(payload.update), (char) => char.charCodeAt(0)));
    expect(copy.getXmlFragment(FIELD).toString()).toContain('Then they adapted.');
    expect(payload.awareness).toEqual(expect.any(String)); // the web sends this person's caret along
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(markdownOf(ref)).toContain('Then they adapted.');
  }, 10000);

  it('sends a final save and leaves the report when it closes', async () => {
    const { api, editor, unmount } = await openDoc();
    act(() => { editor.chain().focus('end').insertContent(' Last words.').run(); });
    unmount();
    await waitFor(() => expect(api.pushReportDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ final: true, markdown: expect.stringContaining('Last words.') })));
    // The browser id it opened with is the one that leaves (and the one it saved under).
    const opened = api.openReportDoc.mock.calls[0][0].clientId;
    expect(api.pushReportDocUpdate.mock.calls.at(-1)[0]).toMatchObject({ clientId: opened, epoch: expect.anything() });
    await waitFor(() => expect(api.closeReportDoc).toHaveBeenCalledWith({ assetId: asset.id, clientId: opened }));
  });

  it('applies other people’s edits live and shows who is here', async () => {
    const { api, editor } = await openDoc();
    expect(screen.getByRole('group', { name: 'Also here: Sam Lee' })).toBeInTheDocument();
    // Another editor opened the same report (the same seed), then typed at the start of the second paragraph.
    const other = createReportYDoc({ markdown: MARKDOWN }).ydoc;
    const before = Y.encodeStateVector(other);
    other.getXmlFragment(FIELD).get(1).get(0).insert(0, 'Remote: ');
    api.emit({ type: 'doc-update', assetId: asset.id, update: toBase64(Y.encodeStateAsUpdate(other, before)), from: { ...sam, color: '#1f9d74' } });
    expect(editor.state.doc.textContent).toContain('Remote: Zero-click');
    api.emit({ type: 'doc-presence', assetId: asset.id, editors: [{ id: 'local', name: 'You' }, sam, riley] });
    expect(screen.getByRole('group', { name: 'Also here: Sam Lee, Riley Park' })).toBeInTheDocument();
    api.emit({ type: 'doc-update', assetId: 'another-report', update: toBase64(Y.encodeStateAsUpdate(other)), from: sam });
    expect(api.pushReportDocUpdate).not.toHaveBeenCalled(); // remote changes are never sent back
  });

  it('formats from the selection menu: bold, italic, heading and a link', async () => {
    const { ref, editor } = await openDoc();
    select(editor, 'grew fast');
    const bar = await screen.findByRole('toolbar', { name: 'Selected text' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Bold' }));
    expect(markdownOf(ref)).toContain('Zero-click searches **grew fast** this quarter.');
    fireEvent.click(within(bar).getByRole('button', { name: 'Italic' }));
    expect(markdownOf(ref)).toContain('***grew fast***');
    fireEvent.click(within(bar).getByRole('button', { name: 'Link' }));
    fireEvent.change(within(bar).getByRole('textbox', { name: 'Link address' }), { target: { value: 'example.com/zero-click' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Apply link' }));
    expect(markdownOf(ref)).toContain('(https://example.com/zero-click)');
    select(editor, 'Publishers noticed');
    fireEvent.click(within(await screen.findByRole('toolbar', { name: 'Selected text' })).getByRole('button', { name: 'Heading' }));
    expect(markdownOf(ref)).toContain('## Publishers noticed.');
  });

  it('opens the / menu on an empty line, filters it, and inserts the block chosen with the keyboard', async () => {
    const { ref, editor } = await openDoc();
    act(() => { editor.chain().focus('end').splitBlock().insertContent('/').run(); });
    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Heading 1'), expect.stringContaining('Bulleted list'), expect.stringContaining('Numbered list'), expect.stringContaining('Quote'), expect.stringContaining('Table'), expect.stringContaining('Divider')]));
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    expect(within(menu).getByRole('option', { selected: true })).toHaveTextContent('Heading 2');
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    expect(screen.queryByRole('listbox', { name: 'Insert a block' })).not.toBeInTheDocument();
    act(() => { editor.commands.insertContent('Next steps'); });
    expect(markdownOf(ref)).toContain('## Next steps');
    act(() => { editor.chain().focus('end').splitBlock().run(); });
    act(() => { editor.commands.insertContent('/quo'); });
    const filtered = await screen.findByRole('listbox', { name: 'Insert a block' });
    expect(within(filtered).getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    act(() => { editor.commands.insertContent('A quote'); });
    expect(markdownOf(ref)).toContain('> A quote');
    act(() => { editor.chain().focus('end').splitBlock().run(); });
    act(() => { editor.commands.insertContent('/'); });
    await screen.findByRole('listbox', { name: 'Insert a block' });
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Insert a block' })).not.toBeInTheDocument();
  });

  it('turns Markdown typed in the text into formatting', async () => {
    const { ref, editor } = await openDoc();
    act(() => { editor.chain().focus('end').splitBlock().run(); });
    for (const char of '## ') act(() => { editor.view.someProp('handleTextInput', (fn) => fn(editor.view, editor.state.selection.from, editor.state.selection.to, char)) || editor.commands.insertContent(char); });
    act(() => { editor.commands.insertContent('Typed heading'); });
    expect(markdownOf(ref)).toContain('## Typed heading');
  });
});

describe('ReportDocument, when the document starts over', () => {
  it('reopens under a new browser id when someone restores a version, and tells the person why', async () => {
    const { api, ref } = await openDoc();
    const first = api.openReportDoc.mock.calls[0][0].clientId;
    api.openReportDoc.mockResolvedValueOnce({ markdown: '# Restored by Sam\n\nOlder words.', yState: '', epoch: 2, versions: [], canEdit: true, canNote: true, editors: [] });
    api.emit({ type: 'doc-update', assetId: asset.id, update: '', reset: true, epoch: 2, from: sam });
    await waitFor(() => expect(ref.current.editor.state.doc.textContent).toContain('Restored by Sam'));
    const second = api.openReportDoc.mock.calls.at(-1)[0].clientId;
    expect(second).not.toBe(first);
    expect(screen.getByText(/Sam Lee restored this report or changed it outside the editor/)).toBeInTheDocument();
    await waitFor(() => expect(api.closeReportDoc).toHaveBeenCalledWith({ assetId: asset.id, clientId: first }));
    // An old event of the same epoch changes nothing more.
    api.emit({ type: 'doc-update', assetId: asset.id, update: '', reset: true, epoch: 2, from: sam });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.openReportDoc.mock.calls.filter(([payload]) => payload.clientId !== first && payload.clientId !== second)).toHaveLength(0);
  });

  it('reopens when a save is refused because the report was restored meanwhile (409 docReset)', async () => {
    const reset = Object.assign(new Error('This report was restored or changed outside the editor. Reopen it to keep editing.'), { status: 409 });
    const api = liveApi({ pushReportDocUpdate: vi.fn().mockRejectedValueOnce(reset).mockResolvedValue({ version: 9, savedAt: 'now', epoch: 2, markdownSaved: true }) });
    const { ref, editor } = await openDoc({ api });
    api.openReportDoc.mockResolvedValueOnce({ markdown: '# Fresh\n\nNew start.', yState: '', epoch: 2, versions: [], canEdit: true, canNote: true, editors: [] });
    act(() => { editor.chain().focus('end').insertContent(' Lost words.').run(); });
    await act(async () => { await ref.current.flush(); });
    await waitFor(() => expect(ref.current.editor.state.doc.textContent).toContain('New start.'));
    expect(screen.getByText(/so it was reloaded/)).toBeInTheDocument();
  });

  it('catches up and sends the Markdown again when the studio says this browser was behind', async () => {
    const api = liveApi({ pushReportDocUpdate: vi.fn().mockResolvedValueOnce({ version: 4, savedAt: '', epoch: 1, markdownSaved: false }).mockResolvedValue({ version: 5, savedAt: 'now', epoch: 1, markdownSaved: true }) });
    const { ref, editor } = await openDoc({ api });
    act(() => { editor.chain().focus('end').insertContent(' Mine.').run(); });
    await act(async () => { await ref.current.flush(); });
    await waitFor(() => expect(api.openReportDoc).toHaveBeenCalledTimes(2)); // the catch-up read
    await waitFor(() => expect(api.pushReportDocUpdate).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  }, 10000);
});

describe('notes', () => {
  it('shows open notes with a count, opens the panel, replies and resolves', async () => {
    const { api } = await openDoc();
    const button = await screen.findByRole('button', { name: 'Notes, 1 open' });
    fireEvent.click(button);
    const panel = screen.getByRole('complementary', { name: 'Notes' });
    const thread = within(panel).getByRole('article', { name: 'Note by Sam Lee' });
    expect(thread).toHaveTextContent('Is this from the X data?');
    expect(thread).toHaveTextContent('Zero-click searches');
    expect(document.querySelector('.rd-note-mark')).toHaveTextContent('Zero-click searches'); // the quote finds its text
    fireEvent.click(within(thread).getByRole('button', { name: 'Reply' }));
    fireEvent.change(within(thread).getByRole('combobox', { name: 'Reply to Sam Lee' }), { target: { value: 'Yes, from X and Reddit.' } });
    fireEvent.click(within(thread).getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(api.saveReportNote).toHaveBeenCalledWith({ assetId: asset.id, replyTo: 'note-1', body: 'Yes, from X and Reddit.', mentions: [] }));
    fireEvent.click(within(thread).getByRole('button', { name: /Resolve/ }));
    await waitFor(() => expect(api.resolveReportNote).toHaveBeenCalledWith({ assetId: asset.id, noteId: 'note-1', resolved: true }));
  });

  it('adds a note on the selected text with a Yjs anchor that follows later edits, and @mentions a teammate', async () => {
    const { api, editor } = await openDoc();
    select(editor, 'Publishers noticed');
    fireEvent.click(within(await screen.findByRole('toolbar', { name: 'Selected text' })).getByRole('button', { name: 'Add note' }));
    const composer = await screen.findByRole('combobox', { name: 'Your note' });
    fireEvent.change(composer, { target: { value: 'Worth a chart? @Ri' } });
    const people = screen.getByRole('listbox', { name: 'People to mention' });
    expect(within(people).getByRole('option')).toHaveTextContent('Riley Park');
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(composer).toHaveValue('Worth a chart? @Riley Park ');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(api.saveReportNote).toHaveBeenCalledTimes(1));
    const sent = api.saveReportNote.mock.calls[0][0];
    expect(sent).toMatchObject({ assetId: asset.id, body: 'Worth a chart? @Riley Park', mentions: ['member-riley'], anchor: { quote: 'Publishers noticed' } });
    expect(sent.anchor.yStart).toEqual(expect.any(String)); expect(sent.anchor.yStart).not.toBe('');
    // Text typed before it moves the anchor along with it.
    act(() => { editor.chain().focus('start').insertContent('Breaking: ').run(); });
    const spot = resolveAnchor(editor.state, sent.anchor);
    expect(editor.state.doc.textBetween(spot.from, spot.to)).toBe('Publishers noticed');
  });

  it('says “text was changed” when a note’s text is gone, and opens a note asked for from the Inbox', async () => {
    requestNoteFocus(asset.id, 'note-gone');
    const api = liveApi({ listReportNotes: vi.fn(async () => ({ notes: [note(), note({ id: 'note-gone', anchor: { yStart: '', yEnd: '', quote: 'A sentence nobody kept' }, body: 'Cut this?' })] })) });
    await openDoc({ api });
    const panel = await screen.findByRole('complementary', { name: 'Notes' });
    const gone = within(panel).getAllByRole('article').find((row) => row.textContent.includes('Cut this?'));
    expect(gone).toHaveClass('is-active');
    expect(gone).toHaveTextContent('text was changed');
  });

  it('edits and deletes only the person’s own notes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = liveApi({ listReportNotes: vi.fn(async () => ({ notes: [note(), note({ id: 'note-mine', author: { id: 'local', name: 'You' }, body: 'My note' })] })) });
    await openDoc({ api });
    fireEvent.click(await screen.findByRole('button', { name: 'Notes, 2 open' }));
    expect(screen.queryByRole('button', { name: 'More for note by Sam Lee' })).toBeInTheDocument(); // an admin may delete anyone's
    fireEvent.click(screen.getByRole('button', { name: 'More for note by You' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const box = screen.getByRole('combobox', { name: 'Edit your note' });
    fireEvent.change(box, { target: { value: 'My better note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveReportNote).toHaveBeenCalledWith({ assetId: asset.id, noteId: 'note-mine', body: 'My better note', mentions: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'More for note by You' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteReportNote).toHaveBeenCalledWith({ assetId: asset.id, noteId: 'note-mine' }));
  });

  it('reloads notes when someone changes one', async () => {
    const { api } = await openDoc();
    await waitFor(() => expect(api.listReportNotes).toHaveBeenCalledTimes(1));
    api.emit({ type: 'note-changed', assetId: asset.id, noteId: 'note-1' });
    await waitFor(() => expect(api.listReportNotes).toHaveBeenCalledTimes(2));
  });
});

describe('roles', () => {
  it('is read-only without edit rights, and keeps notes', async () => {
    const viewer = { id: 'member-viewer', name: 'Jordan', role: 'editor', base: 'editor', allowed: ['openReportDoc', 'closeReportDoc', 'listReportNotes', 'readStudioAsset'] };
    const { api, editor } = await openDoc({ viewer });
    expect(screen.queryByRole('textbox', { name: `Text of ${asset.title}` })).not.toBeInTheDocument();
    expect(screen.getByRole('document', { name: asset.title })).toHaveAttribute('contenteditable', 'false');
    expect(editor.isEditable).toBe(false);
    expect(screen.getByRole('button', { name: 'Notes, 1 open' })).toBeInTheDocument();
    select(editor, 'grew fast');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(screen.queryByRole('toolbar', { name: 'Selected text' })).not.toBeInTheDocument(); // no edit, no notes: no menu
    fireEvent.click(screen.getByRole('button', { name: 'Notes, 1 open' }));
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
    expect(api.pushReportDocUpdate).not.toHaveBeenCalled();
  });

  it('lets a channel owner leave notes on their brief but never edit it', async () => {
    const viewer = { id: 'member-owner', name: 'Alex', role: 'channel', base: 'channel', channelId: 'blog', allowed: ['openReportDoc', 'closeReportDoc', 'listReportNotes', 'saveReportNote', 'resolveReportNote', 'deleteReportNote', 'readStudioAsset'] };
    const api = liveApi({ readStudioAsset: vi.fn(async () => ({ markdown: MARKDOWN })), openReportDoc: vi.fn(async () => ({ markdown: MARKDOWN, yState: '', versions: [], canEdit: false, canNote: true, editors: [] })) });
    render(<ViewerContext.Provider value={viewer}><ChannelBriefReader api={api} trend={{ themeId: 'theme-aio', name: 'AI Overviews', primaryReportId: asset.id }} onClose={() => {}} /></ViewerContext.Provider>);
    const page = await screen.findByRole('document', { name: 'The brief for AI Overviews' });
    await waitFor(() => expect(page).toHaveTextContent('Zero-click'));
    expect(screen.queryByRole('textbox', { name: /Text of/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
    const editor = page.editor;
    select(editor, 'Publishers noticed');
    const bar = await screen.findByRole('toolbar', { name: 'Selected text' });
    expect(within(bar).queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Add note' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Your note' }), { target: { value: 'We can use this for the blog.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(api.saveReportNote).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, body: 'We can use this for the blog.' })));
    expect(api.pushReportDocUpdate).not.toHaveBeenCalled();
  });

  it('checks in while a reader keeps the report open, so the studio keeps sending them changes and notes', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const viewer = { id: 'member-viewer', name: 'Jordan', role: 'editor', base: 'editor', allowed: ['openReportDoc', 'closeReportDoc', 'listReportNotes', 'readStudioAsset'] };
    const { api } = await openDoc({ viewer });
    const opened = api.openReportDoc.mock.calls[0][0].clientId;
    const keepAlive = intervals.mock.calls.find(([, ms]) => ms === KEEP_ALIVE_MS);
    expect(keepAlive).toBeTruthy();
    expect(KEEP_ALIVE_MS).toBeLessThan(30 * 60000); // report-docs.js lets a quiet browser go after 30 minutes
    await act(async () => { keepAlive[0](); });
    await waitFor(() => expect(api.openReportDoc).toHaveBeenCalledTimes(2));
    expect(api.openReportDoc.mock.calls[1][0]).toEqual({ assetId: asset.id, clientId: opened });
    expect(api.pushReportDocUpdate).not.toHaveBeenCalled();
  });

  it('turns editing off in a preview', async () => {
    const viewer = { id: 'local', role: 'editor', realRole: 'admin', preview: true, allowed: ['openReportDoc', 'listReportNotes'] };
    const { editor } = await openDoc({ viewer });
    expect(editor.isEditable).toBe(false);
  });
});

describe('history', () => {
  it('lists versions with who and when, previews one and restores it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api, ref } = await openDoc();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const menu = await screen.findByRole('menu', { name: 'Versions' });
    await waitFor(() => expect(api.openReportDoc).toHaveBeenCalledTimes(2)); // refreshed when opened
    const version = within(menu).getByRole('menuitem', { name: /Sam Lee/ });
    fireEvent.click(version);
    const preview = screen.getByRole('dialog');
    expect(preview).toHaveTextContent('A preview isn’t available for this version');
    fireEvent.click(within(preview).getByRole('button', { name: /Restore this version/ }));
    await waitFor(() => expect(api.restoreReportVersion).toHaveBeenCalledWith({ assetId: asset.id, versionId: 'v-2', clientId: expect.any(String) }));
    await waitFor(() => expect(ref.current.editor.state.doc.textContent).toContain('Restored version'));
  });

  it('previews a version’s text when the studio sends it, and restores the original generated version', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const versions = [{ id: 'v-2', at: '2026-10-17T10:00:00.000Z', by: sam, label: 'Edited' }, { id: 'original', at: '2026-10-16T08:00:00.000Z', by: { id: 'system', name: 'Studio' }, label: 'Original' }];
    const api = liveApi({ readReportVersion: vi.fn(async () => ({ markdown: '# Earlier\n\nEarlier words.' })) });
    api.openReportDoc.mockImplementation(async () => ({ markdown: MARKDOWN, yState: '', epoch: 1, versions, canEdit: true, canNote: true, editors: [] }));
    const onSaved = vi.fn();
    await openDoc({ api, onSaved, edited: { at: '2026-10-17T10:00:00.000Z', byName: 'Sam Lee' } });
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const menu = await screen.findByRole('menu', { name: 'Versions' });
    expect(within(menu).queryByRole('menuitem', { name: /Original version/ })).not.toBeInTheDocument(); // the studio lists the original itself
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Sam Lee/ }));
    expect(await within(screen.getByRole('dialog')).findByText('Earlier words.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(within(await screen.findByRole('menu', { name: 'Versions' })).getByRole('menuitem', { name: /Original/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Restore this version/ }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('This removes Sam Lee’s edits')));
    await waitFor(() => expect(api.restoreReportVersion).toHaveBeenCalledWith({ assetId: asset.id, versionId: 'original', clientId: expect.any(String) }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ restored: true })));
  });
});

describe('plain studio (no live methods)', () => {
  it('edits the same way and saves through editStudioAsset', async () => {
    const api = { editStudioAsset: vi.fn(async ({ markdown }) => ({ asset: { ...asset, edited: { at: '2026-10-18T10:00:00.000Z' } }, markdown })) };
    const { ref, editor } = await openDoc({ api, baseEditedAt: '2026-10-17T09:00:00.000Z' });
    expect(screen.queryByRole('button', { name: /Notes/ })).not.toBeInTheDocument();
    act(() => { editor.chain().focus('end').insertContent(' More.').run(); });
    await act(async () => { await ref.current.flush(); });
    expect(api.editStudioAsset).toHaveBeenCalledWith({ assetId: asset.id, markdown: `${MARKDOWN} More.`, baseEditedAt: '2026-10-17T09:00:00.000Z' });
    act(() => { editor.commands.insertContent('!'); });
    await act(async () => { await ref.current.flush(); });
    expect(api.editStudioAsset).toHaveBeenLastCalledWith(expect.objectContaining({ baseEditedAt: '2026-10-18T10:00:00.000Z' })); // the next save starts from its own
  });
});

describe('sync', () => {
  it('waits for typing to stop, sends once, and retries after a failure', async () => {
    vi.useFakeTimers();
    try {
      const { ydoc } = createReportYDoc({ markdown: 'Text.' });
      const pushReportDocUpdate = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ version: 2, savedAt: 'now' });
      const states = [];
      const sync = createDocSync({ api: { pushReportDocUpdate }, assetId: 'a', ydoc, getMarkdown: () => 'Text!', seeded: true, onStatus: (status) => states.push(status.state) });
      ydoc.getXmlFragment(FIELD).get(0).get(0).insert(4, '!');
      ydoc.getXmlFragment(FIELD).get(0).get(0).insert(5, '!');
      expect(pushReportDocUpdate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1500);
      expect(pushReportDocUpdate).toHaveBeenCalledTimes(1);
      expect(states).toContain('error');
      await vi.advanceTimersByTimeAsync(5000);
      expect(pushReportDocUpdate).toHaveBeenCalledTimes(2);
      expect(sync.status.state).toBe('saved');
      sync.destroy();
    } finally { vi.useRealTimers(); }
  });

  it('says an emptied report can’t be saved instead of sending it again and again', async () => {
    vi.useFakeTimers();
    try {
      const { ydoc } = createReportYDoc({ markdown: 'Text.' });
      let text = '';
      const pushReportDocUpdate = vi.fn().mockResolvedValue({ version: 2, savedAt: 'now', epoch: 0, markdownSaved: false });
      const onBehind = vi.fn();
      const sync = createDocSync({ api: { pushReportDocUpdate }, assetId: 'a', ydoc, getMarkdown: () => text, seeded: true, onBehind });
      ydoc.getXmlFragment(FIELD).get(0).get(0).delete(0, 5);
      await vi.advanceTimersByTimeAsync(30000);
      expect(pushReportDocUpdate).not.toHaveBeenCalled();
      expect(onBehind).not.toHaveBeenCalled();
      expect(sync.status).toMatchObject({ state: 'error', conflict: false, error: expect.stringMatching(/Write the report before saving/) });
      // Typing again saves as usual.
      text = 'New.'; pushReportDocUpdate.mockResolvedValue({ version: 3, savedAt: 'now', epoch: 0, markdownSaved: true });
      ydoc.getXmlFragment(FIELD).get(0).get(0).insert(0, 'New.');
      await vi.advanceTimersByTimeAsync(1500);
      expect(pushReportDocUpdate).toHaveBeenCalledTimes(1);
      expect(sync.status.state).toBe('saved');
      sync.destroy();
    } finally { vi.useRealTimers(); }
  });

  it('never overwrites someone else’s save (409) in a plain studio', async () => {
    const { ydoc } = createReportYDoc({ markdown: 'Text.' });
    const conflict = Object.assign(new Error('Riley saved this report after you opened it.'), { status: 409 });
    const editStudioAsset = vi.fn().mockRejectedValue(conflict);
    const sync = createDocSync({ api: { editStudioAsset }, assetId: 'a', ydoc, mode: 'plain', getMarkdown: () => 'Mine.', initialMarkdown: 'Text.' });
    ydoc.getXmlFragment(FIELD).get(0).get(0).insert(0, 'x');
    await sync.flush();
    expect(sync.status).toMatchObject({ state: 'error', conflict: true });
    await sync.flush();
    expect(editStudioAsset).toHaveBeenCalledTimes(1);
    sync.destroy();
  });
});

describe('note counts', () => {
  it('sums open notes over a row’s documents and hides when there are none', () => {
    const counts = { a: { open: 2, total: 3 }, b: { open: 1, total: 1 }, c: { open: 0, total: 4 } };
    expect(noteCountFor(counts, ['a', 'b'])).toEqual({ open: 3, total: 4 });
    const { container, rerender } = render(<NoteCount counts={counts} ids={['a', 'b']} />);
    expect(container).toHaveTextContent('3 open notes');
    rerender(<NoteCount counts={counts} ids={['c']} />);
    expect(container).toBeEmptyDOMElement();
  });
});
