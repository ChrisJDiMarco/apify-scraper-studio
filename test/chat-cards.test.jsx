// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatCards, cardActionIndexes, forSlack, paramsLine } from '../src/renderer/src/chat-cards.jsx';

// Ask AI's cards that take input or run steps: the action form, the choice, the plan, the draft, the report change and
// the run card's full-research button. Every one runs through the shared runner (onRunAction / onAction) and records
// what happened (onOutcome), so a failure is shown and stored as failed, never as done.
afterEach(cleanup);
const STATE = { contentStudio: { activeWorkspaceId: 'w', workspaces: [{ id: 'w', editionId: 'semrush' }], programs: [{ id: 'p-weekly', name: 'Weekly listening' }], researchRuns: [], contentRuns: [], assets: [{ id: 'asset-r', title: 'Zero-click report', edited: null }] } };
const draw = (cards, actions, extra = {}) => render(<ChatCards cards={cards} actions={actions} actionState={{}} state={STATE} onNav={{}} {...extra} />);

describe('the action form card', () => {
  const action = { kind: 'approve-trend', label: 'Yes, for Social', target: 'AI Overviews', runId: 'run-1', themeId: 'theme-1', params: { note: 'Lead with clicks', channels: ['social'] } };
  const card = { type: 'action', title: 'Yes, for Social', note: '', actionIndexes: [0], data: { kind: 'approve-trend', title: 'AI Overviews', fields: [{ key: 'note', type: 'text', label: 'Note for the channels', value: 'Lead with clicks', max: 280 }, { key: 'channels', type: 'channels', label: 'Channels', value: ['social'], options: [{ value: 'social', label: 'Semrush Social Team' }, { value: 'blog', label: 'Semrush Blog' }] }], problems: ['I left out “Podcast”: not one of this workspace’s channels.'], spends: false } };
  it('shows what Ask AI filled in, lets the person change it, and saves only what they leave', async () => {
    const onRunAction = vi.fn(async () => 'Approved “AI Overviews” for Social and Blog.'); const onOutcome = vi.fn();
    draw([card], [action], { onRunAction, onOutcome });
    expect(screen.getByText('I left out “Podcast”: not one of this workspace’s channels.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Note for the channels/ }), { target: { value: 'Lead with the click loss' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Semrush Blog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, for Social' }));
    await screen.findByText('Approved “AI Overviews” for Social and Blog.');
    expect(onRunAction).toHaveBeenCalledWith({ ...action, params: { note: 'Lead with the click loss', channels: ['social', 'blog'] } });
    expect(onOutcome).toHaveBeenCalledWith(0, { status: 'done', text: 'Approved “AI Overviews” for Social and Blog.' });
  });
  it('shows a refusal under the form and records it as failed', async () => {
    const onOutcome = vi.fn();
    draw([card], [action], { onRunAction: async () => { throw new Error('This trend is no longer waiting for a decision.'); }, onOutcome });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, for Social' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer waiting');
    expect(onOutcome).toHaveBeenCalledWith(0, { status: 'failed', text: 'This trend is no longer waiting for a decision.' });
  });
});

describe('choice, plan and draft cards', () => {
  it('runs the button on the item picked when the server found two', async () => {
    const action = { kind: 'approve-trend', label: 'Yes to AI Overviews', target: 'AI Overviews', candidates: [{ ids: { runId: 'run-a', themeId: 't' }, title: 'AI Overviews' }, { ids: { runId: 'run-b', themeId: 't' }, title: 'AI Overviews' }] };
    const card = { type: 'choice', title: 'Which “AI Overviews” did you mean?', note: '', actionIndexes: [0], data: { pick: true, options: [{ label: 'AI Overviews', detail: 'AI search pulse · 2026-10-16', ids: { runId: 'run-a', themeId: 't' } }, { label: 'AI Overviews', detail: 'Weekly listening · 2026-10-15', ids: { runId: 'run-b', themeId: 't' } }] } };
    const onRunAction = vi.fn(async () => 'Approved “AI Overviews” from Weekly listening.'); const onOutcome = vi.fn();
    draw([card], [action], { onRunAction, onOutcome });
    expect([...cardActionIndexes([card], [action])]).toEqual([0]);
    fireEvent.click(screen.getByRole('button', { name: /Weekly listening · 2026-10-15/ }));
    await screen.findByText('Approved “AI Overviews” from Weekly listening.');
    const sent = onRunAction.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: 'approve-trend', runId: 'run-b', themeId: 't', title: 'AI Overviews' });
    expect(sent.candidates).toBeUndefined();
  });
  it('sends a follow-up question when the model asked one', () => {
    const onAsk = vi.fn();
    draw([{ type: 'choice', title: 'Which report?', note: '', actionIndexes: [], data: { options: [{ label: 'Enterprise', question: 'Make assets for the Enterprise report' }, { label: 'SMB', question: 'SMB' }] } }], [], { onAsk });
    fireEvent.click(screen.getByRole('button', { name: 'Enterprise' }));
    expect(onAsk).toHaveBeenCalledWith('Make assets for the Enterprise report');
    expect(screen.getByRole('button', { name: 'SMB' })).toBeDisabled();
  });
  it('opens each plan step only after the one before is done or skipped', () => {
    const actions = [{ kind: 'approve-trend', label: 'Yes to AI Overviews', params: { channels: ['social'] } }, { kind: 'write-reports', label: 'Write its report' }];
    const card = { type: 'plan', title: 'Get AI Overviews to Social', note: '', actionIndexes: [0, 1], data: { steps: [{ index: 0, why: 'It’s waiting for your OK.' }, { index: 1, why: 'The report feeds the assets.' }] } };
    const onAction = vi.fn(); const onOutcome = vi.fn();
    const { rerender } = render(<ChatCards cards={[card]} actions={actions} actionState={{}} state={STATE} onNav={{}} onAction={onAction} onOutcome={onOutcome} />);
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Channels: Social')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write its report' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes to AI Overviews' }));
    expect(onAction).toHaveBeenCalledWith(0);
    rerender(<ChatCards cards={[card]} actions={actions} actionState={{ 0: { status: 'done', text: 'Approved.' } }} state={STATE} onNav={{}} onAction={onAction} onOutcome={onOutcome} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onOutcome).toHaveBeenCalledWith(1, { status: 'cancelled', text: 'Skipped.' });
    rerender(<ChatCards cards={[card]} actions={actions} actionState={{ 0: { status: 'done', text: 'Approved.' }, 1: { status: 'cancelled', text: 'Skipped.' } }} state={STATE} onNav={{}} onAction={onAction} onOutcome={onOutcome} />);
    expect(screen.getByText('Plan done')).toBeInTheDocument();
  });
  it('copies a draft as written or in Slack’s own formatting, and never sends it', async () => {
    const writeText = vi.fn(async () => {}); Object.assign(navigator, { clipboard: { writeText } });
    draw([{ type: 'draft', title: 'This week', note: '', actionIndexes: [], data: { kind: 'slack', subject: 'This week', text: '**Trends this week**\n- AI Overviews is rising\nSee [the report](https://studio.example.com/#/report/a)' } }], []);
    expect(screen.getByText('Not sent. Copy it and send it yourself.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy for Slack' })); });
    expect(writeText).toHaveBeenCalledWith('*Trends this week*\n• AI Overviews is rising\nSee <https://studio.example.com/#/report/a|the report>');
    expect(forSlack('# Heading')).toBe('*Heading*');
    expect(paramsLine({ status: 'in-review', link: '', channels: ['blog'] }, [{ id: 'blog', name: 'Semrush Blog', short: 'Blog' }])).toBe('Status: In review · Channels: Blog');
  });
});

describe('report change and run cards', () => {
  const card = { type: 'report-change', title: '', note: '', actionIndexes: [0], data: { assetId: 'asset-r', title: 'Zero-click report', section: 'What happened', diff: [{ op: 'del', text: 'Old.' }, { op: 'add', text: 'New text, sourced.' }], added: 1, removed: 1, markdown: '# Zero-click report\n\n## What happened\n\nNew text, sourced.\n', baseEditedAt: '', problems: [], canApply: true, note: 'Shorter.' } };
  it('applies through editStudioAsset with the edit it was based on', async () => {
    const editStudioAsset = vi.fn(async () => ({ asset: {} })); const onOutcome = vi.fn();
    draw([card], [{ kind: 'edit-report', label: 'Review', target: 'Zero-click report', assetId: 'asset-r' }], { api: { editStudioAsset }, onOutcome });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Saved the new “What happened” in “Zero-click report”.');
    expect(editStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-r', markdown: card.data.markdown, baseEditedAt: '' });
    expect(onOutcome).toHaveBeenCalledWith(0, { status: 'done', text: 'Saved the new “What happened” in “Zero-click report”.' });
  });
  it('turns Apply off once someone else edited the report', () => {
    const state = { contentStudio: { ...STATE.contentStudio, assets: [{ id: 'asset-r', title: 'Zero-click report', edited: { at: '2026-10-17T10:00:00Z', by: { name: 'Sam' } } }] } };
    render(<ChatCards cards={[card]} actions={[{ kind: 'edit-report', label: 'Review' }]} actionState={{}} state={state} onNav={{}} api={{ editStudioAsset: vi.fn() }} />);
    expect(screen.getByText(/Sam changed this report after the suggestion/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });
  it('offers a finished quick scan a full run with the program it borrowed, not a topic it can’t keep', async () => {
    const onRunAction = vi.fn(async () => 'Research started. New trends will appear under Trends.');
    const run = { type: 'run', title: '', note: '', actionIndexes: [], data: { runId: 'scan-1', kind: 'quick-scan', title: 'Quick scan · AI Overviews', status: 'succeeded', programId: 'p-weekly', themes: [] } };
    draw([run], [], { onRunAction, onAsk: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Full research with “Weekly listening”' }));
    await waitFor(() => expect(onRunAction).toHaveBeenCalledWith({ kind: 'start-research', label: 'Full research', target: 'Weekly listening', programId: 'p-weekly' }));
    expect(screen.queryByText(/Find full trends on this topic/)).not.toBeInTheDocument();
    expect(within(document.body).getByText('Research started. New trends will appear under Trends.')).toBeInTheDocument();
  });
});
