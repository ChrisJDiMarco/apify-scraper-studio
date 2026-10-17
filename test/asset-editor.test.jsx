// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetEditor, LEAVE_MESSAGE, UnsavedContext, canEditAsset, createUnsavedGuard, useUnsavedGuard } from '../src/renderer/src/asset-editor.jsx';
import { PREVIEW_TITLE, ViewerContext } from '../src/renderer/src/viewer.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const asset = { id: 'asset-report', title: 'AI Overviews — Comprehensive Trends Report', deliverableId: 'evidence-report', kind: 'text' };
const edited = { at: '2026-10-14T15:12:00.000Z', byName: 'Riley' };
const api = (over = {}) => ({ editStudioAsset: vi.fn(async ({ markdown }) => ({ asset: { ...asset, edited: { at: '2026-10-16T10:00:00.000Z', byName: 'Chris' } }, markdown })), restoreStudioAsset: vi.fn(async () => ({ asset: { ...asset, edited: null } })), ...over });
function open(props = {}, guard = createUnsavedGuard()) {
  const handlers = { onSaved: vi.fn(), onCancel: vi.fn() };
  const services = props.api || api();
  render(<UnsavedContext.Provider value={guard}><AssetEditor api={services} asset={asset} markdown={'# AI Overviews\n\nThe original text.'} edited={null} {...handlers} {...props} /></UnsavedContext.Provider>);
  return { services, guard, ...handlers, text: screen.getByRole('textbox', { name: `Text of ${asset.title}` }) };
}

describe('AssetEditor', () => {
  it('edits in place with Write and Preview, a Markdown hint and a character count', () => {
    const { text } = open();
    expect(screen.getByRole('region', { name: `Editing ${asset.title}` })).toBeInTheDocument();
    expect(text).toHaveFocus();
    expect(screen.getByText('# Heading · **bold** · - list · [text](https://…)')).toBeInTheDocument();
    expect(screen.getByText('34 characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(text, { target: { value: '# AI Overviews\n\nA **better** text.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('better', { selector: 'strong' })).toBeInTheDocument();
  });

  it('guards unsaved edits: the shared guard, Cancel and Esc all ask first', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { guard, text, onCancel } = open();
    expect(guard.isDirty()).toBe(false);
    expect(guard.confirmLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(text, { target: { value: 'Changed.' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(guard.isDirty()).toBe(true);
    expect(guard.confirmLeave()).toBe(false);
    expect(confirm).toHaveBeenLastCalledWith(LEAVE_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(confirm).toHaveBeenLastCalledWith('Leave without saving your edits?'));
    expect(onCancel).not.toHaveBeenCalled();
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    fireEvent.keyDown(text, { key: 'Escape' });
    window.removeEventListener('keydown', outside);
    expect(outside).not.toHaveBeenCalled(); // the reader underneath never sees this Esc
    expect(onCancel).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    cleanup();
    expect(guard.isDirty()).toBe(false);
  });

  it('holds the browser tab on the web while there are unsaved edits', () => {
    const { text } = open({ web: true });
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(text, { target: { value: 'Changed.' } });
    const held = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
  });

  it('saves with the version it opened, so the server can catch someone else’s save', async () => {
    const action = vi.fn((fn) => Promise.resolve().then(fn));
    const { services, text, onSaved, guard } = open({ edited, action });
    fireEvent.change(text, { target: { value: '# AI Overviews\n\nFixed claim.' } });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => expect(services.editStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-report', markdown: '# AI Overviews\n\nFixed claim.', baseEditedAt: '2026-10-14T15:12:00.000Z' }));
    expect(action).toHaveBeenCalledWith(expect.any(Function), '', true);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ asset: expect.objectContaining({ id: 'asset-report' }), markdown: '# AI Overviews\n\nFixed claim.' }));
    expect(guard.isDirty()).toBe(false);
  });

  it('sends an empty base for a report that was never edited', async () => {
    const { services, text } = open();
    fireEvent.change(text, { target: { value: 'New.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(services.editStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-report', markdown: 'New.', baseEditedAt: '' }));
  });

  it('keeps the person’s text on screen when someone else saved first (409)', async () => {
    const message = 'Riley saved this report at 3:12 PM, after you opened it. Copy your text, reopen the report and try again.';
    const conflict = Object.assign(new Error(message), { status: 409 });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { text, onSaved } = open({ edited, api: api({ editStudioAsset: vi.fn(async () => { throw conflict; }) }) });
    fireEvent.change(text, { target: { value: 'My careful rewrite.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(text).toHaveValue('My careful rewrite.');
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole('button', { name: /Copy my text/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('My careful rewrite.'));
  });

  it('restores the original only after saying whose edits go', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { services, onSaved } = open({ edited });
    fireEvent.click(screen.getByRole('button', { name: /Restore the original/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(`Restore the original?\n\nThis removes Riley’s edits from ${day(edited.at)}. Drafts already made from the edited version stay as they are.`));
    expect(services.restoreStudioAsset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Restore the original/ }));
    await waitFor(() => expect(services.restoreStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-report' }));
    expect(onSaved).toHaveBeenCalledWith({ asset: expect.objectContaining({ edited: null }), restored: true });
  });

  it('offers no Restore for an unedited report, and turns Save off in a preview', () => {
    render(<ViewerContext.Provider value={{ role: 'editor', realRole: 'admin', preview: true, allowed: ['state'] }}><AssetEditor api={api()} asset={asset} markdown="Text." /></ViewerContext.Provider>);
    expect(screen.queryByRole('button', { name: /Restore the original/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed.' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('title', PREVIEW_TITLE);
  });

  it('isn’t offered for pictures or the landing page', () => {
    expect(canEditAsset(asset)).toBe(true);
    expect(canEditAsset({ ...asset, kind: 'image' })).toBe(false);
    expect(canEditAsset({ ...asset, deliverableId: 'landingpage' })).toBe(false);
    render(<AssetEditor api={api()} asset={{ ...asset, kind: 'image' }} markdown="" onCancel={() => {}} />);
    expect(screen.getByText('Pictures and landing pages can’t be edited here.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('works without a provider through one shared guard', () => {
    let shared;
    function Probe() { shared = useUnsavedGuard(); return null; }
    render(<><Probe /><AssetEditor api={api()} asset={asset} markdown="Text." /></>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed.' } });
    expect(shared.isDirty()).toBe(true);
  });
});
