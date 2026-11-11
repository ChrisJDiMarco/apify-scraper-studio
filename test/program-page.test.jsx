// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PROGRAM_TABS, ProgramPage, programTab, runRows } from '../src/renderer/src/program-page.jsx';
import { ConfirmProvider } from '../src/renderer/src/confirm-dialog.jsx';

afterEach(cleanup);
const workspace = { id: 'ws', name: 'Main', editionId: 'semrush' };
const program = { id: 'p', workspaceId: 'ws', name: 'AI search pulse', query: 'ai search', updatedAt: '2026-10-10T10:00:00.000Z', budgets: { collectionUsd: 5, aiUsd: 3 }, schedule: { frequency: 'manual', enabled: false, time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1, lookbackDays: 7 } };
const runs = [
  { id: 'r2', programId: 'p', status: 'awaiting-review', createdAt: '2026-10-14T10:00:00.000Z', discoveredThemes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], decisions: { a: 'approved', b: 'passed' } },
  { id: 'r1', programId: 'p', status: 'succeeded', createdAt: '2026-10-07T10:00:00.000Z', discoveredThemes: [{ id: 'a' }, { id: 'b' }], themes: [{ id: 'a' }], reportRunIds: [{ themeId: 'a', runId: 'c1' }], costUsd: 4.2 },
];
const state = { contentStudio: { capabilities: {} } };
const page = (props = {}) => {
  const api = { saveResearchProgram: vi.fn(async (payload) => ({ program: { ...program, ...payload, updatedAt: '2026-10-15T10:00:00.000Z' } })), estimateResearchProgram: vi.fn(async () => ({ ai: { totalUsd: 1 }, collection: { worstCaseUsd: 1 } })), ...props.api };
  const view = render(<ConfirmProvider><ProgramPage program={program} workspace={workspace} state={state} viewer={{}} runs={runs} {...props} api={api} /></ConfirmProvider>);
  return { api, ...view };
};

describe('runRows', () => {
  it('says what each run found, approved, wrote and cost', () => {
    expect(runRows(runs).map(({ id, label, found, approved, reports, costUsd }) => ({ id, label, found, approved, reports, costUsd }))).toEqual([
      { id: 'r2', label: 'Waiting for your OK', found: 3, approved: 1, reports: 0, costUsd: null },
      { id: 'r1', label: 'Finished', found: 2, approved: 1, reports: 1, costUsd: 4.2 },
    ]);
  });
});

describe('programTab', () => {
  it('knows the page’s tabs and falls back to Runs', () => {
    expect(PROGRAM_TABS.map(([id]) => id)).toEqual(['runs', 'basics', 'sources', 'when', 'budgets', 'ai', 'automation', 'advanced']);
    expect(programTab('budgets')).toBe('budgets');
    expect(programTab('prompts')).toBe('runs');
    expect(programTab('')).toBe('runs');
  });
});

describe('ProgramPage', () => {
  it('opens on the program’s runs, with Run now and a row per run', () => {
    const onOpenRun = vi.fn(); const onStartResearch = vi.fn();
    page({ onOpenRun, onStartResearch });
    expect(screen.getByRole('heading', { level: 1, name: 'AI search pulse' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Runs/, selected: true })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Waiting for your OK')).toBeInTheDocument();
    expect(screen.getByText('$4.20')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Open the run from / })[1]);
    expect(onOpenRun).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(onStartResearch).toHaveBeenCalledWith(program);
  });
  it('asks for the tab pressed', () => {
    const onTab = vi.fn();
    page({ onTab });
    fireEvent.click(screen.getByRole('tab', { name: 'Budget' }));
    expect(onTab).toHaveBeenCalledWith('budgets');
  });
  it('keeps one draft across tabs and saves the whole program from one bar', async () => {
    const onSaved = vi.fn();
    const onStartResearch = vi.fn();
    const { api, rerender } = page({ tab: 'basics', onSaved, onStartResearch });
    expect(screen.queryByRole('button', { name: /Save program/ })).toBeNull(); // nothing to save yet
    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'AI search pulse, weekly' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled(); // save first
    // Another tab: the edit is still there, and so is the bar.
    rerender(<ConfirmProvider><ProgramPage program={program} workspace={workspace} state={state} viewer={{}} runs={runs} tab="budgets" api={api} onSaved={onSaved} /></ConfirmProvider>);
    expect(screen.getByRole('heading', { level: 1, name: 'AI search pulse, weekly' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save program/ }));
    await waitFor(() => expect(api.saveResearchProgram).toHaveBeenCalledTimes(1));
    expect(api.saveResearchProgram.mock.calls[0][0]).toMatchObject({ id: 'p', name: 'AI search pulse, weekly', baseUpdatedAt: '2026-10-10T10:00:00.000Z' });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
  it('opens the tab that has the problem when a save is refused by a check', async () => {
    const onTab = vi.fn();
    const { api } = page({ tab: 'budgets', onTab });
    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save program/ }));
    await waitFor(() => expect(onTab).toHaveBeenCalledWith('basics'));
    expect(api.saveResearchProgram).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it('shows the settings read-only to someone who can’t manage programs', () => {
    page({ tab: 'basics', viewer: { allowed: ['listResearchPrograms'], roleAllowed: ['listResearchPrograms'], capabilities: [] } });
    expect(screen.getByLabelText('Program name')).toBeDisabled();
    expect(screen.getByText(/Only people who manage research programs/)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Cost' })).toBeNull();
  });
});
