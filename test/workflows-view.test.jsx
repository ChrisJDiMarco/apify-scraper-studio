// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationsCard, WorkflowsView } from '../src/renderer/src/workflows-view.jsx';

afterEach(() => cleanup());
const program = { id: 'program-a', workspaceId: 'semrush', name: 'SEO weekly', lookbackDays: 7, sourceGroups: [{ platform: 'x', enabled: true, targets: ['a'] }], schedule: { frequency: 'manual', enabled: false } };
const steps = [
  { id: 'step-1', kind: 'research', programId: 'program-a' },
  { id: 'step-2', kind: 'approve', mode: 'rules', rules: [{ momentum: ['rising', 'new'], priority: ['FAST-TRACK', 'STRONG'] }], maxApprove: 3, otherwise: 'review', waitHours: 48, afterWait: 'continue', channels: [] },
  { id: 'step-3', kind: 'reports' },
];
const weekly = { kind: 'schedule', schedule: { frequency: 'weekly', time: '08:00', timeZone: 'America/New_York', weekday: 1 } };
const ON = { id: 'workflow-a', workspaceId: 'semrush', name: 'Weekly SEO watch', status: 'active', needsBudget: false, trigger: weekly, steps, nextRunAt: '2026-10-19T12:00:00.000Z', budget: { perRunUsd: 40, perMonthUsd: 200, budgetHash: 'h', approvedBy: { name: 'Alex' }, approvedAt: '2026-10-10T10:00:00.000Z' }, monthSpentUsd: 12, owner: { id: 'local', name: 'Alex' }, updatedAt: '2026-10-10T10:00:00.000Z' };
const DRAFT = { ...ON, id: 'workflow-b', name: 'PR angles', status: 'draft', needsBudget: true, budget: null, trigger: { kind: 'manual' }, nextRunAt: '' };
const RUN = { id: 'wfrun-a', workflowId: 'workflow-a', workspaceId: 'semrush', trigger: 'schedule', status: 'waiting-review', waiting: { kind: 'review', count: 2 }, startedBy: { name: 'Alex' }, capUsd: 40, spentUsd: 3.5, committedUsd: 11, createdAt: '2026-10-12T12:00:00.000Z', currentStepId: 'step-2', steps: [{ stepId: 'step-1', kind: 'research', status: 'done', refs: { researchRunId: 'research-1' } }, { stepId: 'step-2', kind: 'approve', status: 'waiting', refs: {} }, { stepId: 'step-3', kind: 'reports', status: 'pending', refs: {} }], plan: steps };
const ESTIMATE = { steps: [{ stepId: 'step-1', kind: 'research', aboutUsd: 6, capUsd: 11 }, { stepId: 'step-2', kind: 'approve', aboutUsd: 0, capUsd: 0 }, { stepId: 'step-3', kind: 'reports', aboutUsd: 8, capUsd: 0 }], perRun: { aboutUsd: 14, capUsd: 11 }, perMonth: { runs: { min: 4, max: 5 }, aboutUsd: 70, capUsd: 55 }, uncapped: false, warnings: [], blocked: false, budgetHash: 'h' };
const state = (extra = {}) => ({ contentStudio: { activeWorkspaceId: 'semrush', programs: [program], workflows: [ON, DRAFT], workflowRuns: [RUN], workflowSummary: { active: 1, paused: 0, drafts: 1, waiting: 1, monthSpentUsd: 12, monthCapUsd: 200 }, capabilities: { imagesConfigured: true }, ...extra } });
const admin = { id: 'local', role: 'admin', base: 'admin', allowed: null };
function setup({ viewer = admin, can = () => true, extra = {} } = {}) {
  const api = { estimateWorkflow: vi.fn(async () => ESTIMATE), runWorkflow: vi.fn(async () => ({ id: 'wfrun-new' })), setWorkflowStatus: vi.fn(async () => ({})), readWorkflowRun: vi.fn(async () => ({ ...RUN, steps: RUN.steps.map((step) => ({ ...step, log: [] })) })), approveWorkflowBudget: vi.fn(async () => ({})) };
  const action = vi.fn(async (fn) => fn());
  const confirm = vi.fn(async () => true);
  const onOpenTarget = vi.fn();
  render(<WorkflowsView state={state(extra)} api={api} viewer={viewer} can={can} confirm={confirm} action={action} onOpenTarget={onOpenTarget} onOpenPlaybooks={vi.fn()} />);
  return { api, action, confirm, onOpenTarget };
}
const row = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li');

describe('Workflows', () => {
  it('lists each workflow with its status, trigger, next run and last run', () => {
    setup();
    const on = row('Weekly SEO watch');
    expect(within(on).getByText('On')).toBeInTheDocument();
    expect(within(on).getByText(/Every Monday at 8:00 \(New York\) · next/)).toBeInTheDocument();
    expect(within(on).getByText(/Last run: Waiting for your OK on 2 trends/)).toBeInTheDocument();
    expect(within(row('PR angles')).getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Spent this month')).toBeInTheDocument();
  });
  it('asks before running, with the estimate; a draft asks for a one-off cap', async () => {
    const h = setup();
    fireEvent.click(within(row('Weekly SEO watch')).getByRole('button', { name: /Run now/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Run “Weekly SEO watch” now?' });
    expect(within(dialog).getByText('Each run: about $14.00, never more than $11.00.')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/may spend at most/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(h.api.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'workflow-a', budgetHash: 'h' })));
    expect(h.api.runWorkflow.mock.calls[0][0]).not.toHaveProperty('capUsd');
    cleanup();
    const d = setup();
    fireEvent.click(within(row('PR angles')).getByRole('button', { name: /Run now/ }));
    const draft = await screen.findByRole('dialog', { name: 'Run “PR angles” now?' });
    expect(within(draft).getByLabelText(/may spend at most/)).toHaveValue(11);
    fireEvent.click(within(draft).getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(d.api.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'workflow-b', capUsd: 11 })));
  });
  it('pauses and resumes', async () => {
    const h = setup();
    fireEvent.click(within(row('Weekly SEO watch')).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(h.api.setWorkflowStatus).toHaveBeenCalledWith({ workflowId: 'workflow-a', status: 'paused' }));
  });
  it('shows no dollar amounts to someone who can’t see costs', () => {
    setup({ viewer: { id: 'm-1', role: 'editor', base: 'editor', capabilities: ['readWorkflows'], allowed: ['estimateWorkflow'] } });
    expect(document.body.textContent).not.toMatch(/\$\d/);
    expect(screen.queryByText('Spent this month')).toBeNull();
  });
  it('turns write buttons off in a preview', () => {
    setup({ viewer: { ...admin, preview: true } });
    expect(within(row('Weekly SEO watch')).getByRole('button', { name: /Run now/ })).toBeDisabled();
    expect(within(row('Weekly SEO watch')).getByRole('button', { name: 'Pause' })).toBeDisabled();
  });
  it('opens a run step by step, with links to what it found', async () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Weekly SEO watch/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: /Oct 12/ }));
    const review = await screen.findByRole('button', { name: 'Review trends' });
    fireEvent.click(review);
    expect(h.onOpenTarget).toHaveBeenCalledWith({ kind: 'page', page: 'board', runId: 'research-1' });
    expect(within(screen.getByRole('region', { name: 'Run' })).getByRole('list', { name: 'Workflow steps' })).toBeInTheDocument();
  });
  it('offers Pause all only to admins', () => {
    setup();
    expect(screen.getByRole('button', { name: /Pause all/ })).toBeInTheDocument();
    cleanup();
    setup({ viewer: { id: 'm-1', role: 'editor', base: 'editor', capabilities: ['readWorkflows', 'manageWorkflows', 'seeCosts'], allowed: ['estimateWorkflow', 'setWorkflowStatus'] } });
    expect(screen.queryByRole('button', { name: /Pause all/ })).toBeNull();
  });
});

describe('Home’s Automations card', () => {
  it('lists workflows with what waits, and Manage opens Workflows', () => {
    const onOpenTarget = vi.fn();
    render(<AutomationsCard state={state()} api={{}} viewer={admin} onOpenTarget={onOpenTarget} />);
    expect(screen.getByRole('heading', { name: /Automations/ })).toBeInTheDocument();
    expect(screen.getByText('Waiting for your OK on 2 trends')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'page', page: 'workflows' });
  });
});
