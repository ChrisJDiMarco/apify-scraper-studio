// @vitest-environment jsdom
import './helpers/prosemirror-dom.js';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetEditor, LEAVE_MESSAGE, UnsavedContext, canEditAsset, createUnsavedGuard, useUnsavedGuard } from '../src/renderer/src/asset-editor.jsx';
import { ViewerContext } from '../src/renderer/src/viewer.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const asset = { id: 'asset-report', title: 'AI Overviews — Comprehensive Trends Report', deliverableId: 'evidence-report', kind: 'text' };
const edited = { at: '2026-10-14T15:12:00.000Z', byName: 'Riley' };
const api = (over = {}) => ({ editStudioAsset: vi.fn(async ({ markdown }) => ({ asset: { ...asset, edited: { at: '2026-10-16T10:00:00.000Z', byName: 'Chris' } }, markdown })), restoreStudioAsset: vi.fn(async () => ({ asset: { ...asset, edited: null } })), ...over });
const editorOf = (box) => box.editor;
// Typing through the editor (jsdom has no real text input): append text at the end.
const type = (box, text) => act(() => { editorOf(box).chain().focus('end').insertContent(text).run(); });
const saveNow = () => act(async () => { fireEvent.keyDown(window, { key: 's', metaKey: true }); await new Promise((resolve) => setTimeout(resolve, 0)); });
async function open(props = {}, guard = createUnsavedGuard()) {
  const handlers = { onSaved: vi.fn(), onCancel: vi.fn() };
  const services = props.api || api();
  render(<UnsavedContext.Provider value={guard}><AssetEditor api={services} asset={asset} markdown={'# AI Overviews\n\nThe original text.'} edited={null} {...handlers} {...props} /></UnsavedContext.Provider>);
  const text = await screen.findByRole('textbox', { name: `Text of ${asset.title}` });
  await waitFor(() => expect(text).toHaveTextContent('The original text.'));
  return { services, guard, ...handlers, text };
}

describe('AssetEditor', () => {
  it('edits in place in the report editor and saves as you type, with the version it opened', async () => {
    const { services, text, onSaved, guard } = await open({ edited });
    expect(screen.getByRole('region', { name: `Editing ${asset.title}` })).toBeInTheDocument();
    type(text, ' Fixed claim.');
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await waitFor(() => expect(services.editStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-report', markdown: '# AI Overviews\n\nThe original text. Fixed claim.', baseEditedAt: '2026-10-14T15:12:00.000Z' }), { timeout: 4000 });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(guard.isDirty()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ asset: expect.objectContaining({ id: 'asset-report' }), markdown: '# AI Overviews\n\nThe original text. Fixed claim.' }));
  }, 10000);

  it('saves at once with ⌘S, sends an empty base for a report never edited, and Done without changes just closes', async () => {
    const { services, text, onCancel, onSaved } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
    type(text, ' New.');
    await saveNow();
    await waitFor(() => expect(services.editStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-report', markdown: '# AI Overviews\n\nThe original text. New.', baseEditedAt: '' }));
  });

  it('keeps the person’s text on screen when someone else saved first (409), and guards leaving', async () => {
    const message = 'Riley saved this report at 3:12 PM, after you opened it. Copy your text, reopen the report and try again.';
    const conflict = Object.assign(new Error(message), { status: 409 });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { text, onSaved, onCancel, guard } = await open({ edited, api: api({ editStudioAsset: vi.fn(async () => { throw conflict; }) }) });
    type(text, ' My careful rewrite.');
    await saveNow();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(text).toHaveTextContent('My careful rewrite.');
    expect(guard.isDirty()).toBe(true);
    expect(guard.confirmLeave()).toBe(false);
    expect(confirm).toHaveBeenLastCalledWith(LEAVE_MESSAGE);
    fireEvent.click(within(alert).getByRole('button', { name: /Copy my text/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# AI Overviews\n\nThe original text. My careful rewrite.'));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining(LEAVE_MESSAGE)));
    expect(onSaved).not.toHaveBeenCalled(); expect(onCancel).not.toHaveBeenCalled();
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    fireEvent.keyDown(text, { key: 'Escape' });
    window.removeEventListener('keydown', outside);
    expect(outside).not.toHaveBeenCalled(); // the reader underneath never sees this Esc
  });

  it('holds the browser tab on the web while edits are still going out', async () => {
    const { text } = await open({ web: true });
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    type(text, ' Changed.');
    const held = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
  });

  it('restores the original from History only after saying whose edits go', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { services, onSaved } = await open({ edited });
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Versions' })).getByRole('menuitem', { name: /Original version/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(`Restore the original?\n\nThis removes Riley’s edits from ${day(edited.at)}. Drafts already made from the edited version stay as they are.`));
    expect(services.restoreStudioAsset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Versions' })).getByRole('menuitem', { name: /Original version/ }));
    await waitFor(() => expect(services.restoreStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-report' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ asset: expect.objectContaining({ edited: null }), restored: true }));
  });

  it('offers no History for an unedited report, and is read-only in a preview', async () => {
    render(<ViewerContext.Provider value={{ role: 'editor', realRole: 'admin', preview: true, allowed: ['state'] }}><AssetEditor api={api()} asset={asset} markdown="Text." /></ViewerContext.Provider>);
    const page = await screen.findByRole('document', { name: asset.title });
    expect(page).toHaveAttribute('contenteditable', 'false');
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  it('isn’t offered for pictures or the landing page', () => {
    expect(canEditAsset(asset)).toBe(true);
    expect(canEditAsset({ ...asset, kind: 'image' })).toBe(false);
    expect(canEditAsset({ ...asset, deliverableId: 'landingpage' })).toBe(false);
    render(<AssetEditor api={api()} asset={{ ...asset, kind: 'image' }} markdown="" onCancel={() => {}} />);
    expect(screen.getByText('Pictures and landing pages can’t be edited here.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('works without a provider through one shared guard', async () => {
    let shared;
    function Probe() { shared = useUnsavedGuard(); return null; }
    render(<><Probe /><AssetEditor api={api({ editStudioAsset: vi.fn(async () => { throw new Error('Offline'); }) })} asset={asset} markdown="Text." /></>);
    const text = await screen.findByRole('textbox', { name: `Text of ${asset.title}` });
    type(text, ' Changed.');
    await saveNow();
    await waitFor(() => expect(shared.isDirty()).toBe(true));
  });

  it('checks the text against the brand as it changes and selects a finding in the text', async () => {
    const { text } = await open({ brand: { claimsToAvoid: 'guaranteed results', editionId: 'general' } });
    type(text, ' We promise guaranteed results.');
    fireEvent.click(await screen.findByRole('button', { name: /Check against brand/ }));
    const finding = await screen.findByRole('button', { name: /guaranteed results/ });
    fireEvent.click(finding);
    const { state } = editorOf(text);
    expect(state.doc.textBetween(state.selection.from, state.selection.to)).toMatch(/guaranteed results/i);
  });
});
