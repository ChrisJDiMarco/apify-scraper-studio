// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybookSetup } from '../src/renderer/src/playbook-setup.jsx';
import { PlaybooksView } from '../src/renderer/src/playbooks-view.jsx';

afterEach(() => cleanup());
const source = { id: 'program-src', workspaceId: 'semrush', name: 'SEO weekly', lookbackDays: 7, sourceGroups: [{ platform: 'x', enabled: true, targets: ['semrush'] }], schedule: { frequency: 'manual', enabled: false } };
const workflow = { name: 'Weekly SEO trend watch', description: '', trigger: { kind: 'schedule', schedule: { frequency: 'weekly', time: '08:00', weekday: 1, timeZone: 'UTC' } }, steps: [
  { id: 'step-1', kind: 'research', programId: 'program-new' },
  { id: 'step-2', kind: 'approve', mode: 'rules', rules: [{ momentum: ['rising', 'new'], priority: ['FAST-TRACK', 'STRONG'] }], maxApprove: 3, otherwise: 'review', waitHours: 48, afterWait: 'continue', channels: [] },
  { id: 'step-3', kind: 'reports' },
  { id: 'step-4', kind: 'assets', channels: ['blog', 'newsletter', 'social'], pictures: true, teamNotes: '' },
  { id: 'step-5', kind: 'monday', alsoAtReview: true },
] };
const program = { id: 'program-new', name: 'SEO weekly watch', query: 'SEO', lookbackDays: 7, maxThemes: 6, sourceGroups: source.sourceGroups, budgets: { collectionUsd: 8, aiUsd: 20 } };
const estimate = { steps: [{ stepId: 'step-1', kind: 'research', aboutUsd: 4, capUsd: 28 }, { stepId: 'step-3', kind: 'reports', aboutUsd: 7, capUsd: 0 }, { stepId: 'step-4', kind: 'assets', aboutUsd: 6, capUsd: 12 }], perRun: { aboutUsd: 17, capUsd: 40 }, perMonth: { runs: { min: 4, max: 5 }, aboutUsd: 85, capUsd: 200 }, warnings: [], blocked: false, budgetHash: 'hash-1' };
function setup({ can = () => true, viewer = { id: 'local', role: 'admin', base: 'admin', allowed: null }, imagesConfigured = true, monday = null } = {}) {
  const api = { previewPlaybook: vi.fn(async () => ({ playbook: { id: 'weekly-seo-trend-watch' }, program, programMode: 'new', workflow, estimate, warnings: [], missing: [] })), applyPlaybook: vi.fn(async () => ({ workflow: { id: 'workflow-1', name: 'Weekly SEO trend watch' } })), saveWorkflow: vi.fn(async () => ({ id: 'workflow-1' })) };
  const action = vi.fn(async (fn) => fn());
  const onDone = vi.fn(); const onClose = vi.fn();
  render(<PlaybookSetup playbookId="weekly-seo-trend-watch" api={api} state={{ contentStudio: { programs: [source], capabilities: { imagesConfigured } }, monday }} viewer={viewer} can={can} action={action} confirm={vi.fn(async () => true)} settingsAllowed={can('saveSettings')} onDone={onDone} onClose={onClose} />);
  return { api, action, onDone, onClose };
}
const goTo = (name) => fireEvent.click(within(screen.getByRole('list', { name: 'Setup steps' })).getByRole('button', { name: new RegExp(name) }));

describe('setting up a playbook', () => {
  it('prices what will be saved, step by step, and saves it turned on for an approver', async () => {
    const h = setup();
    await waitFor(() => expect(h.api.previewPlaybook).toHaveBeenCalled());
    expect(h.api.previewPlaybook.mock.calls[0][0]).toMatchObject({ playbookId: 'weekly-seo-trend-watch', inputs: { topic: 'SEO' }, sourceProgramId: 'program-src', programMode: 'new' });
    const preview = await screen.findByRole('complementary', { name: 'What it will do' });
    await waitFor(() => expect(within(preview).getAllByRole('listitem').length).toBe(5));
    goTo('Review and cost');
    expect(screen.getByText('Each run: about $17.00, never more than $40.00.')).toBeInTheDocument();
    expect(within(preview).getByText('About $4.00 · up to $28.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save and turn on' }));
    await waitFor(() => expect(h.api.applyPlaybook).toHaveBeenCalledWith(expect.objectContaining({ playbookId: 'weekly-seo-trend-watch', program: expect.objectContaining({ name: 'SEO weekly watch' }), budget: { perRunUsd: 40, perMonthUsd: 200 }, budgetHash: 'hash-1', activate: true })));
    expect(h.onDone).toHaveBeenCalledWith('workflow-1');
  });
  it('lets someone who can’t approve budgets save a draft on an existing program for an admin', async () => {
    const can = (method) => !['approveWorkflowBudget', 'applyPlaybook', 'saveSettings'].includes(method);
    const h = setup({ can, viewer: { id: 'm-riley', role: 'editor', base: 'editor', capabilities: ['readWorkflows', 'manageWorkflows', 'seeCosts'], allowed: [] } });
    await waitFor(() => expect(h.api.previewPlaybook).toHaveBeenCalled());
    expect(h.api.previewPlaybook.mock.calls[0][0].programMode).toBe('existing');
    goTo('Review and cost');
    expect(screen.queryByRole('button', { name: 'Save and turn on' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Save for an admin to approve' }));
    await waitFor(() => expect(h.api.saveWorkflow).toHaveBeenCalledWith(expect.objectContaining({ requestApproval: true })));
  });
  it('turns pictures off with a reason when they aren’t set up, and says who connects Monday.com', async () => {
    const admin = setup({ imagesConfigured: false });
    await waitFor(() => expect(admin.api.previewPlaybook).toHaveBeenCalled());
    goTo('Reports and assets');
    const pictures = await screen.findByRole('checkbox', { name: /Make pictures too/ });
    expect(pictures).toBeDisabled(); expect(pictures).not.toBeChecked();
    expect(screen.getByText(/Turn on pictures in Settings/)).toBeInTheDocument();
    goTo('Schedule and sharing');
    expect(screen.getByText(/Connect Monday.com in Settings/)).toBeInTheDocument();
    cleanup();
    const editor = setup({ can: (method) => method !== 'saveSettings', viewer: { id: 'm-riley', role: 'editor', base: 'editor', capabilities: ['readWorkflows', 'seeCosts'], allowed: [] } });
    await waitFor(() => expect(editor.api.previewPlaybook).toHaveBeenCalled());
    goTo('Schedule and sharing');
    expect(await screen.findByText(/Ask an admin to connect Monday.com/)).toBeInTheDocument();
  });
});

describe('Playbooks', () => {
  it('offers the built-in playbooks with their steps and cost, and opens the setup', () => {
    const onSetUp = vi.fn();
    render(<PlaybooksView state={{ contentStudio: { programs: [source], workflows: [{ id: 'workflow-1', name: 'Weekly SEO trend watch', playbookId: 'weekly-seo-trend-watch' }] } }} viewer={{ id: 'local', role: 'admin', base: 'admin', allowed: null }} can={() => true} onSetUp={onSetUp} onOpenWorkflow={vi.fn()} edition="semrush" />);
    expect(screen.getByRole('heading', { name: 'Start from a playbook' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Competitor launch watch' })).toBeInTheDocument();
    expect(screen.getAllByText('About $45.00 a run')[0]).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PR' }));
    expect(screen.queryByRole('heading', { name: 'Competitor launch watch' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Set up' })[0]);
    expect(onSetUp).toHaveBeenCalledWith('pr-angle-finder');
    expect(screen.getByRole('region', { name: 'In use' })).toHaveTextContent('Weekly SEO trend watch');
  });
});
