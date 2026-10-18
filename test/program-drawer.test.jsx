// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramsPanel } from '../src/renderer/src/home-programs.jsx';
import { ConfirmProvider } from '../src/renderer/src/confirm-dialog.jsx';
import { UnsavedContext, createUnsavedGuard } from '../src/renderer/src/asset-editor.jsx';

// Home's quick editor for a research program: every setting in groups, jump chips, Save/Discard, the unsaved guard, a
// confirmation before a schedule turns on, and protection against replacing someone else's save.
const admin = { role: 'admin', base: 'admin' };
const group = (sourceId, targets) => ({ id: `source-${sourceId}`, sourceId, platform: sourceId, name: sourceId === 'x' ? 'X accounts' : 'Reddit communities', targets, enabled: true, options: {} });
const weekly = { frequency: 'weekly', enabled: false, time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1, lookbackDays: 7, nextRunAt: '' };
const pulse = { id: 'p1', workspaceId: 'w', name: 'AI search pulse', query: '', updatedAt: '2026-10-10T10:00:00.000Z', sourceGroups: [group('x', ['@a', '@b'])], budgets: { collectionUsd: 10, aiUsd: 25 }, schedule: weekly };
const stateWith = (program = pulse) => ({ keys: { APIFY_API_TOKEN: true }, contentStudio: { activeWorkspaceId: 'w', workspaces: [{ id: 'w', name: 'Main', editionId: 'semrush' }], programs: program ? [program] : [], researchRuns: [], capabilities: {} } });
let guard; let scrolled;
function setup({ program = pulse, api = {}, viewer = admin } = {}) {
  guard = createUnsavedGuard();
  const handlers = { api: { saveResearchProgram: vi.fn(async (value) => ({ ...value, updatedAt: '2026-10-17T12:00:00.000Z' })), ...api }, onNotice: vi.fn(), onStartResearch: vi.fn() };
  const view = (state) => <UnsavedContext.Provider value={guard}><ConfirmProvider><ProgramsPanel state={state} viewer={viewer} {...handlers} /></ConfirmProvider></UnsavedContext.Provider>;
  const result = render(view(stateWith(program)));
  return { ...handlers, rerender: (next) => result.rerender(view(stateWith(next))) };
}
const open = (name = 'AI search pulse') => { fireEvent.click(screen.getByRole('button', { name: `Edit “${name}”` })); return screen.getByRole('dialog', { name }); };
const nameField = () => document.getElementById('pd-program-name');
beforeEach(() => { scrolled = []; Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.id); }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete Element.prototype.scrollIntoView; });

describe('Program drawer', () => {
  it('opens on the program with every group of settings and jump chips', () => {
    setup();
    const dialog = open();
    expect(nameField()).toHaveFocus();
    expect(nameField()).toHaveValue('AI search pulse');
    for (const heading of ['Name & focus', 'Sources', 'Schedule & dates', 'Budgets & estimate', 'AI models', 'Automation', 'Advanced']) expect(within(dialog).getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Theme match confidence')).toHaveValue(0.55);
    const chips = within(dialog).getByRole('navigation', { name: 'Program settings' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Advanced' }), { detail: 1 });
    expect(scrolled).toContain('pd-group-advanced');
    expect(within(chips).getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-current', 'true');
    expect(within(dialog).getByRole('status')).toHaveTextContent('No changes');
  });

  it('marks unsaved changes, asks before closing, and discards on request', async () => {
    setup();
    const dialog = open();
    fireEvent.change(nameField(), { target: { value: 'AI search weekly' } });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Unsaved changes');
    expect(guard.isDirty()).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    const ask = await screen.findByRole('alertdialog', { name: 'Discard changes to “AI search weekly”?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'AI search weekly' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(nameField()).toHaveValue('AI search pulse');
    expect(guard.isDirty()).toBe(false);
  });

  it('saves with the version it opened, says so and closes', async () => {
    const { api, onNotice } = setup();
    const dialog = open();
    fireEvent.change(nameField(), { target: { value: 'AI search weekly' } });
    fireEvent.change(within(dialog).getByLabelText('Notes for finding trends (optional)'), { target: { value: 'Ignore job posts.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save program' }));
    await waitFor(() => expect(api.saveResearchProgram).toHaveBeenCalledOnce());
    expect(api.saveResearchProgram.mock.calls[0][0]).toMatchObject({ notes: { research: 'Ignore job posts.', reports: '' } });
    expect(api.saveResearchProgram.mock.calls[0][0]).toMatchObject({ id: 'p1', name: 'AI search weekly', workspaceId: 'w', baseUpdatedAt: '2026-10-10T10:00:00.000Z', sourceGroups: expect.arrayContaining([expect.objectContaining({ sourceId: 'x', targets: ['@a', '@b'] })]) });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onNotice).toHaveBeenCalledWith('Saved “AI search weekly”.');
    expect(guard.isDirty()).toBe(false);
  });

  it('points at the problem instead of saving', async () => {
    const { api } = setup();
    const dialog = open();
    fireEvent.change(nameField(), { target: { value: ' ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save program' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Name this research program.');
    expect(scrolled).toContain('pd-group-basics');
    expect(api.saveResearchProgram).not.toHaveBeenCalled();
  });

  it('asks before turning a schedule on, with the caps', async () => {
    const { api } = setup();
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Enable scheduled runs/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save program' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Turn on scheduled runs for “AI search pulse”?' });
    expect(ask).toHaveTextContent('Every Monday at 09:00 · UTC.');
    expect(ask).toHaveTextContent('AI up to $25.00');
    expect(ask).toHaveTextContent('Apify up to $10.00');
    expect(api.saveResearchProgram).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Turn on schedule' }));
    await waitFor(() => expect(api.saveResearchProgram).toHaveBeenCalledOnce());
    expect(api.saveResearchProgram.mock.calls[0][0]).toMatchObject({ schedule: { frequency: 'weekly', enabled: true } });
  });

  it('keeps the draft when someone else saved first, and can save over it on purpose', async () => {
    const conflict = Object.assign(new Error('Someone saved this program at Oct 17, 11:58 AM UTC, after you opened it. Reopen it to see their changes, then make yours again.'), { status: 409, code: 'saveConflict' });
    const saveResearchProgram = vi.fn().mockRejectedValueOnce(conflict).mockImplementation(async (value) => value);
    setup({ api: { saveResearchProgram } });
    const dialog = open();
    fireEvent.change(nameField(), { target: { value: 'Mine' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save program' }));
    const banner = await within(dialog).findByRole('alert');
    expect(banner).toHaveTextContent('after you opened it');
    expect(nameField()).toHaveValue('Mine');
    fireEvent.click(within(banner).getByRole('button', { name: 'Save mine anyway' }));
    await waitFor(() => expect(saveResearchProgram).toHaveBeenCalledTimes(2));
    expect(saveResearchProgram.mock.calls[1][0].baseUpdatedAt).toBeUndefined();
    expect(saveResearchProgram.mock.calls[1][0].name).toBe('Mine');
  });

  it('follows a newer saved version while untouched, and warns while edited', async () => {
    const { rerender } = setup();
    open();
    act(() => rerender({ ...pulse, name: 'Renamed elsewhere', updatedAt: '2026-10-17T11:00:00.000Z' }));
    expect(nameField()).toHaveValue('Renamed elsewhere');
    expect(screen.getByRole('status')).toHaveTextContent('Updated with the latest saved version.');
    fireEvent.change(nameField(), { target: { value: 'My edit' } });
    act(() => rerender({ ...pulse, name: 'Renamed again', updatedAt: '2026-10-17T11:30:00.000Z' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Someone saved this program at .*Saving now would replace their changes\./);
    expect(nameField()).toHaveValue('My edit');
    fireEvent.click(screen.getByRole('button', { name: 'Use their version' }));
    expect(nameField()).toHaveValue('Renamed again');
  });

  it('closes with a note when the program leaves the workspace', async () => {
    const { rerender, onNotice } = setup();
    open();
    act(() => rerender(null));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onNotice).toHaveBeenCalledWith('That program isn’t in this workspace anymore.');
  });

  it('shows the estimate only to someone who may price research', async () => {
    const estimateResearchProgram = vi.fn(async () => ({ ai: { totalUsd: 4, stages: { discovery: 1, synthesis: 1, matching: 1, tagging: 0.5, reports: 0.5 }, posts: { total: 100 }, batches: { discovery: 1, tagging: 2 } }, collection: { worstCaseUsd: 2, jobCount: 1 } }));
    const limited = { role: 'custom', allowed: ['saveResearchProgram'], capabilities: ['managePrograms', 'seeCosts'] };
    setup({ api: { estimateResearchProgram }, viewer: limited });
    const dialog = open();
    expect(within(dialog).getByText('Estimates need Start research access.')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(estimateResearchProgram).not.toHaveBeenCalled();
  });
});
