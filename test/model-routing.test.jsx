// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelRouting } from '../src/renderer/src/model-routing.jsx';
import { ConfirmProvider } from '../src/renderer/src/confirm-dialog.jsx';
import routingModule from '../src/main/ai-routing.js';
import catalogModule from '../src/main/ai-catalog.js';

// Settings → Model routing (src/renderer/src/model-routing.jsx) on the real resolver: previewAiRouting is ai-routing.js's
// own preview, so every row, inheritance and preset below is what the studio would resolve.
const { createAiRouting } = routingModule; const { createAiCatalog } = catalogModule;
// The curated catalog only: no key, no cache folder, no Codex model list, and a fetch that never answers.
const catalog = () => createAiCatalog({ dataDir: '', codexHome: '/nonexistent-codex-home', fetchImpl: async () => { throw new Error('offline'); } });
const statuses = { connections: [{ id: 'claude', status: 'ready' }, { id: 'claude-api', status: 'no-key' }, { id: 'codex', status: 'ready' }, { id: 'openai', status: 'ready' }, { id: 'openrouter', status: 'no-key' }, { id: 'fal', status: 'ready' }] };
function api(overrides = {}) {
  const routing = createAiRouting({ getSettings: () => ({}), catalog: catalog() });
  return {
    previewAiRouting: vi.fn(async ({ routing: draft, preset } = {}) => routing.preview({ routing: draft || null, preset: preset || null })),
    saveAiRouting: vi.fn(async ({ routing: draft }) => ({ routing: { ...draft, updatedAt: '2026-10-17T15:42:00.000Z', updatedBy: { id: 'owner', name: 'Studio admin' } }, updatedAt: '2026-10-17T15:42:00.000Z' })),
    getAiConnections: vi.fn(async () => statuses),
    listAiModels: vi.fn(async () => ({ models: [], nextCursor: null })),
    estimateAiTaskTest: vi.fn(async () => ({ kind: 'text', promptId: 'research.tagging', sampleLabel: 'Bundled sample', estimateUsd: 0.01, capUsd: 0.5, metered: true, lines: ['Runs the Tag every post prompt once on the sample with Claude Fable 5.1 · low through the Claude app.', 'About $0.01, capped at $0.50.'], fingerprint: 'fp-1' })),
    testAiTask: vi.fn(async () => ({ ok: true, durationMs: 6000, receipt: { costUsd: 0.004 }, problems: [], output: { assignments: [] }, preview: '{ "assignments": [] }' })),
    ...overrides,
  };
}
const mount = (props = {}) => render(<ConfirmProvider><ModelRouting state={{ settings: {} }} layout="classic" {...props} /></ConfirmProvider>);
const rowOf = (label) => screen.getByText(label, { selector: 'strong' }).closest('tr');
afterEach(cleanup);

describe('Settings → Model routing', () => {
  it('lists every job by group with its resolved connection, model and typical cost, inherited rows folded', async () => {
    const setupApi = api(); mount({ api: setupApi });
    expect(await screen.findByRole('table', { name: 'Research jobs' })).toBeVisible();
    for (const group of ['Quick scans', 'Reports', 'Channel assets', 'Create content', 'Pictures', 'Video', 'Ask AI', 'Data tools']) expect(screen.getByRole('table', { name: `${group} jobs` })).toBeVisible();
    const discovery = rowOf('Find candidate trends');
    expect(within(discovery).getByLabelText('Find candidate trends connection')).toHaveValue('auto');
    expect(within(discovery).getByLabelText('Find candidate trends effort')).toHaveValue('medium');
    expect(within(discovery).getByText(/about \$[\d.]+ a call/)).toBeVisible();
    // The editorial toolkit follows the trends report until someone changes it.
    const toolkit = rowOf('Editorial toolkit');
    expect(within(toolkit).getByText('Same as Trends report: Claude Fable 5.1 · high')).toBeVisible();
    fireEvent.click(within(toolkit).getByRole('button', { name: 'Change' }));
    expect(within(rowOf('Editorial toolkit')).getByLabelText('Editorial toolkit connection')).toBeVisible();
    // Channel assets show one row until someone opens the per-channel choices.
    expect(screen.queryByText('Short news update', { selector: 'strong' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set per channel (12)' }));
    expect(screen.getByText('Short news update', { selector: 'strong' })).toBeVisible();
    // Connections that aren't ready can't be chosen, and say why.
    const option = within(rowOf('Tag every post')).getByRole('option', { name: 'OpenRouter · add a key first' });
    await waitFor(() => expect(option).toBeDisabled());
    expect(setupApi.saveAiRouting).not.toHaveBeenCalled();
  });

  it('previews a preset’s effect before anything is saved, then saves the draft on request', async () => {
    const setupApi = api(); mount({ api: setupApi });
    fireEvent.click(await screen.findByRole('radio', { name: /Lowest cost/ }));
    await waitFor(() => expect(setupApi.previewAiRouting).toHaveBeenCalledWith(expect.objectContaining({ preset: 'lowest-cost' })));
    expect(await screen.findByText(/Changes \d+ jobs\. A typical research run goes from about \$[\d.]+ to about \$[\d.]+\. Nothing is saved until you choose Save routing\./)).toBeVisible();
    expect(setupApi.saveAiRouting).not.toHaveBeenCalled();
    expect(within(rowOf('Tag every post')).getByText('Claude Haiku 5.5')).toBeInTheDocument();
    const bar = screen.getByRole('region', { name: 'Unsaved routing' });
    expect(within(bar).getByText(/\d+ unsaved changes/)).toBeVisible();
    fireEvent.click(within(bar).getByRole('button', { name: 'Save routing' }));
    await waitFor(() => expect(setupApi.saveAiRouting).toHaveBeenCalledWith(expect.objectContaining({ baseUpdatedAt: '', routing: expect.objectContaining({ preset: 'lowest-cost', tasks: expect.objectContaining({ 'research.tagging': { model: 'claude-haiku-5-5', effort: 'low' } }) }) })));
    expect(await screen.findByText(/Routing saved\. New runs use it/)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Unsaved routing' })).not.toBeInTheDocument();
  });

  it('tests a job only after showing its estimate in a confirmation, and videos have no Test', async () => {
    const setupApi = api(); mount({ api: setupApi });
    await screen.findByRole('table', { name: 'Research jobs' });
    fireEvent.click(within(rowOf('Tag every post')).getByRole('button', { name: 'Test…' }));
    await waitFor(() => expect(setupApi.estimateAiTaskTest).toHaveBeenCalledWith({ taskId: 'research.tagging', route: 'auto', model: 'claude-fable-5-1', effort: 'low' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Runs the Tag every post prompt once on the sample with Claude Fable 5.1 · low');
    expect(setupApi.testAiTask).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test · about $0.01' }));
    await waitFor(() => expect(setupApi.testAiTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'research.tagging', route: 'auto', model: 'claude-fable-5-1', effort: 'low', fingerprint: 'fp-1', requestId: expect.stringMatching(/^task-/) })));
    expect(await screen.findByText('Passed the checks in 6 s · $0.004')).toBeVisible();
    // Saying no to the estimate sends nothing.
    fireEvent.click(within(rowOf('Tag every post')).getByRole('button', { name: 'Test…' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(setupApi.testAiTask).toHaveBeenCalledTimes(1);
    const clip = rowOf('Short social video');
    expect(within(clip).queryByRole('button', { name: 'Test…' })).not.toBeInTheDocument();
    expect(within(clip).getByText(/Try video models by making a video from a report/)).toBeVisible();
    expect(within(clip).getByLabelText('Video length')).toHaveValue('8');
  });

  it('keeps the draft when someone else saved first, and says who and when', async () => {
    const conflict = Object.assign(new Error('Another admin saved routing after you opened it. Reload to see their changes.'), { code: 'routingConflict' });
    const setupApi = api({ saveAiRouting: vi.fn(async () => { throw conflict; }) }); mount({ api: setupApi });
    const effort = within(rowOf('Tag every post', await screen.findByRole('table', { name: 'Research jobs' }))).getByLabelText('Tag every post effort');
    fireEvent.change(effort, { target: { value: 'medium' } });
    fireEvent.click(within(screen.getByRole('region', { name: 'Unsaved routing' })).getByRole('button', { name: 'Save routing' }));
    const bar = screen.getByRole('region', { name: 'Unsaved routing' });
    expect(await within(bar).findByText(/saved routing after you opened it/)).toBeVisible();
    expect(within(bar).getByRole('button', { name: 'Reload' })).toBeVisible();
  });

  it('shows the groups as accordions in the Simple layout, and a note to people who aren’t admins', async () => {
    mount({ api: api(), layout: 'simple' });
    const research = (await screen.findByText(/^Research/, { selector: 'summary' })).closest('details');
    expect(research).toHaveAttribute('open');
    expect(screen.getByText(/^Pictures/, { selector: 'summary' }).closest('details')).not.toHaveAttribute('open');
    cleanup();
    mount({ api: api(), role: 'editor' });
    expect(screen.getByText('An admin chooses which connection and model does each AI job.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
