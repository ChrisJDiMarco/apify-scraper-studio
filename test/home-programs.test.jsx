// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramsPanel } from '../src/renderer/src/home-programs.jsx';
import { WeeklyBriefing } from '../src/renderer/src/weekly-briefing.jsx';
import { ConfirmProvider } from '../src/renderer/src/confirm-dialog.jsx';

// Home → Research programs (admins who manage programs): schedule, next and last run, sources, budgets, Run now, Edit,
// Pause and Resume. Nothing spends from here without the layout's own confirmation.
const admin = { role: 'admin', base: 'admin' };
const group = (sourceId, targets) => ({ id: `source-${sourceId}`, sourceId, platform: sourceId, name: sourceId === 'x' ? 'X accounts' : 'Reddit communities', targets, enabled: true, options: {} });
const pulse = { id: 'p1', workspaceId: 'w', name: 'AI search pulse', query: '', updatedAt: '2026-10-10T10:00:00.000Z', sourceGroups: [group('x', ['@a', '@b']), group('reddit', ['r/SEO'])], budgets: { collectionUsd: 10, aiUsd: 25 }, schedule: { frequency: 'weekly', enabled: true, time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1, lookbackDays: 7, nextRunAt: '2026-10-19T09:00:00.000Z' } };
const paused = { ...pulse, id: 'p2', name: 'Paused pulse', schedule: { ...pulse.schedule, enabled: false, nextRunAt: '' } };
const empty = { ...pulse, id: 'p3', name: 'Empty program', sourceGroups: [], schedule: { frequency: 'manual', enabled: false, time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1, lookbackDays: 7 } };
const state = (programs = [pulse], extra = {}) => ({ keys: { APIFY_API_TOKEN: true }, contentStudio: { activeWorkspaceId: 'w', workspaces: [{ id: 'w', name: 'Main', editionId: 'semrush' }], programs, researchRuns: [{ id: 'r1', programId: 'p1', workspaceId: 'w', status: 'succeeded', createdAt: '2026-10-13T09:00:00Z', costUsd: 3.2 }], capabilities: {}, ...extra } });
const renderPanel = (props = {}) => render(<ConfirmProvider><ProgramsPanel state={state()} viewer={admin} api={{ saveResearchProgram: vi.fn(async (value) => value) }} onStartResearch={vi.fn()} onOpenTarget={vi.fn()} onNotice={vi.fn()} {...props} /></ConfirmProvider>);
const row = (name) => screen.getByRole('button', { name }).closest('li');
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Home → Research programs', () => {
  it('shows only for admins who manage programs, with an api that can save them', () => {
    const base = { state: state(), now: new Date('2026-10-17T12:00:00Z'), onStartResearch: vi.fn(), onOpenTarget: vi.fn() };
    const { unmount } = render(<WeeklyBriefing {...base} viewer={admin} api={{}} />);
    expect(screen.queryByRole('region', { name: /Research programs/ })).not.toBeInTheDocument();
    unmount();
    const editor = { role: 'editor', allowed: ['startResearchRun', 'decideResearchTheme'], capabilities: ['startResearch'] };
    const second = render(<WeeklyBriefing {...base} viewer={editor} api={{ saveResearchProgram: vi.fn() }} />);
    expect(screen.queryByRole('region', { name: /Research programs/ })).not.toBeInTheDocument();
    second.unmount();
    render(<WeeklyBriefing {...base} viewer={admin} api={{ saveResearchProgram: vi.fn() }} />);
    const panel = screen.getByRole('region', { name: /Research programs/ });
    expect(panel.closest('.wb-col-side')).toBeInTheDocument();
    expect(panel).toHaveAttribute('data-spot', 'home.programs');
  });

  it('lists each program’s schedule, next and last run, sources and budgets', () => {
    renderPanel();
    const item = row('AI search pulse');
    expect(item).toHaveTextContent('Every Monday at 09:00 · UTC · Schedule on');
    expect(item).toHaveTextContent(/Next: Mon, Oct 19/);
    expect(item).toHaveTextContent('Last: Oct 13 · Succeeded');
    expect(within(item).getByRole('list', { name: 'Sources for AI search pulse' })).toHaveTextContent('X 2Reddit 1');
    expect(item).toHaveTextContent('$10.00 collection + $25.00 AI per run · last run $3.20');
  });

  it('keeps money from someone without See costs', () => {
    renderPanel({ viewer: { role: 'custom', allowed: ['saveResearchProgram', 'startResearchRun'], capabilities: ['managePrograms', 'startResearch'] } });
    expect(row('AI search pulse')).not.toHaveTextContent('$');
  });

  it('runs a program through the layout’s confirmation, and only when it can', () => {
    const onStartResearch = vi.fn();
    const first = renderPanel({ onStartResearch, state: state([pulse, empty]) });
    fireEvent.click(screen.getByRole('button', { name: 'Run “AI search pulse” now' }));
    expect(onStartResearch).toHaveBeenCalledWith(pulse);
    expect(screen.getByRole('button', { name: 'Run “Empty program” now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run “Empty program” now' })).toHaveAttribute('title', 'Add sources first');
    first.unmount();
    renderPanel({ onStartResearch, needsSetup: true });
    expect(screen.getByRole('button', { name: 'Run “AI search pulse” now' })).toHaveAttribute('title', 'Connect Apify first');
    expect(screen.getByRole('button', { name: 'Run “AI search pulse” now' })).toBeDisabled();
  });

  it('pauses at once, and resumes only after confirming the caps', async () => {
    const saveResearchProgram = vi.fn(async (value) => value); const onNotice = vi.fn();
    renderPanel({ state: state([pulse, paused]), api: { saveResearchProgram }, onNotice });
    fireEvent.click(screen.getByRole('button', { name: 'More for AI search pulse' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause schedule' }));
    await waitFor(() => expect(saveResearchProgram).toHaveBeenCalledTimes(1));
    expect(saveResearchProgram.mock.calls[0][0]).toMatchObject({ id: 'p1', workspaceId: 'w', schedule: { enabled: false }, baseUpdatedAt: '2026-10-10T10:00:00.000Z' });
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Schedule paused for “AI search pulse”. A run already going isn’t stopped.'));
    fireEvent.click(screen.getByRole('button', { name: 'More for Paused pulse' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resume schedule' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Resume “Paused pulse”?' });
    expect(dialog).toHaveTextContent('Each run can spend up to $10.00 on collection and $25.00 on AI.');
    expect(saveResearchProgram).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume schedule' }));
    await waitFor(() => expect(saveResearchProgram).toHaveBeenCalledTimes(2));
    expect(saveResearchProgram.mock.calls[1][0]).toMatchObject({ id: 'p2', schedule: { enabled: true } });
  });

  it('offers Add program when there are none', () => {
    renderPanel({ state: state([]) });
    expect(screen.getByText(/No research programs yet\. A program is the accounts and communities research follows/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add program' }));
    expect(screen.getByRole('dialog', { name: 'New program' })).toBeInTheDocument();
  });

  it('turns every change off in a preview', () => {
    renderPanel({ viewer: { ...admin, preview: true } });
    expect(screen.getByRole('button', { name: 'Run “AI search pulse” now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add program' })).toBeDisabled();
  });
});
