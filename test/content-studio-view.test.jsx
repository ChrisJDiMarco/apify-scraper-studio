// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentStudioView } from '../src/renderer/src/content-studio-view.jsx';
afterEach(cleanup);
const catalog = { editions: [{ id: 'general', label: 'General studio' }, { id: 'semrush', label: 'Semrush workspace' }], deliverables: [
  { id: 'evidence-report', label: 'Evidence report', channel: 'Research', kind: 'text', sections: [{ heading: 'Evidence' }] },
  { id: 'social', label: 'Social captions', channel: 'Social', kind: 'text', sections: [{ heading: 'LinkedIn' }] },
  { id: 'brand-image', label: 'Campaign graphic', channel: 'Design', kind: 'image' },
  { id: 'sel-image', label: 'Editorial heroes', channel: 'Search Engine Land', kind: 'image', editions: ['semrush'] },
] };
const workspace = { id: 'general', name: 'My brand', editionId: 'general', knowledge: { audience: 'B2B marketers', voice: 'Clear and practical' }, products: [] };
const program = { id: 'p1', workspaceId: 'general', name: 'Weekly pulse', query: 'Reporting friction', sourceGroups: [{ id: 'x', sourceId: 'x', platform: 'x', name: 'X accounts', targets: ['apify'], enabled: true, options: {} }], window: { startDate: '2026-09-01', endDate: '2026-09-27' }, budgets: { collectionUsd: 1, aiUsd: 5 } };
const source = { kind: 'text', title: 'A reporting trend', text: 'Public source material reports manual campaign reporting work. Verify the scope before interpreting.', evidence: [{ id: 'e1', text: 'Manual campaign reporting work.', url: 'https://example.com/report' }] };
const fresh = (extra = {}) => ({ activeWorkspaceId: 'general', workspaces: [workspace, { id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }], programs: [], researchRuns: [], contentRuns: [], assets: [], availableDatasets: [], availableReports: [], capabilities: { imagesConfigured: true, googleConfigured: true }, ...extra });
function props(extra = {}) { return { state: { contentStudio: fresh() }, api: { contentCatalog: vi.fn(async () => catalog), selectContentWorkspace: vi.fn(async () => true), saveContentWorkspace: vi.fn(async (value) => ({ ...value, id: value.id || 'new' })), saveResearchProgram: vi.fn(async (value) => ({ ...value, id: value.id || 'saved-program' })), startResearchRun: vi.fn(async () => ({ id: 'new-run' })), approveResearchThemes: vi.fn(async () => true), continueResearchRun: vi.fn(async () => true), createContentRun: vi.fn(async () => ({ id: 'created' })), cancelStudioRun: vi.fn(async () => true), retryStudioRun: vi.fn(async () => true), readStudioRun: vi.fn(async () => true), exportStudioRun: vi.fn(async () => ({ path: '/fixture/export' })), readStudioAsset: vi.fn(async ({ assetId }) => ({ asset: { id: assetId, title: 'Saved report' }, markdown: '# Saved report\n\nA source-backed draft.', evidence: source.evidence })), openStudioAsset: vi.fn(async () => true), importStudioSource: vi.fn(async () => ({ title: 'Imported research', text: 'Authorized imported document.', evidence: [] })) }, onNotice: vi.fn(), onNavigate: vi.fn(), ...extra }; }
const nav = (name) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Content studio' })).getByRole('button', { name, exact: true }));
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const creationStep = (name) => fireEvent.click(screen.getByRole('tab', { name, exact: true }));
async function setupCreate(handlers = props()) { render(<ContentStudioView {...handlers} initialView="create" initialSource={source} />); await screen.findByRole('checkbox', { name: 'Evidence report', hidden: true }); creationStep('Choose deliverables'); return handlers; }

describe('research and content studio workspace', () => {
  it('keeps the Semrush campaign hero on Overview and gives each work view a single contextual title', async () => {
    const handlers = props({ state: { contentStudio: fresh({ activeWorkspaceId: 'semrush' }) } });
    const { container } = render(<ContentStudioView {...handlers} />);
    expect(screen.getByRole('heading', { level: 1, name: 'From a trend to a complete campaign.' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Research your market/ })).toHaveClass('cs-entry-research');
    expect(screen.getByRole('button', { name: /Create from a trend/ })).toHaveClass('cs-entry-content');
    for (const [destination, title] of [['Research programs', 'Research programs'], ['Create content', 'Create content'], ['Library', 'Your asset library'], ['Brand knowledge', 'Brand knowledge']]) {
      nav(destination);
      expect(screen.getByRole('heading', { level: 1, name: title })).toHaveAttribute('id', 'content-studio-title');
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(container.querySelector('.cs-hero')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Research your market/ })).not.toBeInTheDocument();
    }
    nav('Overview');
    expect(screen.getByRole('heading', { level: 1, name: 'From a trend to a complete campaign.' })).toBeVisible();
    expect(handlers.api.createContentRun).not.toHaveBeenCalled();
  });

  it('summarizes actual Semrush activity, excludes other workspaces, and opens the run needing attention', async () => {
    const handlers = props({ state: { contentStudio: fresh({ activeWorkspaceId: 'semrush', researchRuns: [{ id: 'r1', workspaceId: 'semrush', status: 'running' }, { id: 'r2', workspaceId: 'general', status: 'running' }], contentRuns: [{ id: 'c1', workspaceId: 'semrush', status: 'partial', title: 'Review this campaign', maxBudgetUsd: 5, jobs: [{ id: 'social', label: 'Social captions', status: 'failed', error: 'Provider unavailable' }] }, { id: 'c2', workspaceId: 'general', status: 'failed' }], assets: [{ id: 'a1', workspaceId: 'semrush', title: 'Current draft', kind: 'text' }, { id: 'a2', workspaceId: 'general', title: 'Private draft' }] }) } });
    render(<ContentStudioView {...handlers} />);
    const summary = within(screen.getByRole('region', { name: 'Workspace activity' }));
    expect(summary.getByRole('button', { name: '1 active runs' })).toBeEnabled();
    expect(summary.getByRole('button', { name: '1 saved assets' })).toBeEnabled();
    fireEvent.click(summary.getByRole('button', { name: '1 runs need attention' }));
    expect(screen.getByLabelText('Total retry budget (USD)')).toHaveValue(5);
    expect(screen.getByText('Provider unavailable')).toBeVisible();
    expect(handlers.api.retryStudioRun).not.toHaveBeenCalled();
  });

  it('shows compact brand readiness without truncating the actual editable knowledge', async () => {
    const audience = 'Enterprise leaders, practitioners, publishers, and agencies. '.repeat(12);
    const handlers = props({ state: { contentStudio: fresh({ activeWorkspaceId: 'semrush', workspaces: [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: { audience, voice: 'Practical and precise' }, products: [] }] }) } });
    const { container } = render(<ContentStudioView {...handlers} />);
    expect(screen.queryByText(`Writing for ${audience}`)).not.toBeInTheDocument();
    const readiness = within(container.querySelector('.cs-brand-checklist'));
    expect(readiness.getAllByText('Saved')).toHaveLength(2);
    expect(readiness.getByText('Add context')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit brand knowledge' }));
    expect(screen.getByLabelText('Audience')).toHaveValue(audience);
    expect(screen.getByRole('heading', { name: 'Audience & positioning' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Voice & editorial guardrails' })).toBeVisible();
  });

  it('presents two clear paths and only actual workspace records', async () => {
    const handlers = props({ state: { contentStudio: fresh({ assets: [{ id: 'foreign', workspaceId: 'semrush', title: 'Private foreign asset' }], contentRuns: [{ id: 'foreign-run', workspaceId: 'semrush', title: 'Private foreign campaign' }] }) } });
    render(<ContentStudioView {...handlers} />);
    expect(screen.getByRole('button', { name: /Research your market/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Create from a trend/ })).toBeVisible();
    expect(screen.getByText('Your next idea starts here')).toBeVisible();
    expect(screen.queryByText('Private foreign campaign')).not.toBeInTheDocument();
    nav('Library'); expect(screen.getByText('Make something worth sharing')).toBeVisible();
    expect(screen.queryByText('Private foreign asset')).not.toBeInTheDocument();
  });

  it('clears a report handoff before rendering Create content for another workspace', async () => {
    const asset = { id: 'saved-general-report', workspaceId: 'general', kind: 'text', title: 'Private General report' };
    const handlers = props({ state: { contentStudio: fresh({ assets: [asset] }) } });
    const view = render(<ContentStudioView {...handlers} initialView="library" />);
    await screen.findByRole('heading', { name: 'Saved report' });
    fireEvent.click(screen.getByRole('button', { name: 'Create from this' }));
    await waitFor(() => expect(screen.getByLabelText('Source title')).toHaveValue('Saved report'));
    view.rerender(<ContentStudioView {...handlers} state={{ contentStudio: fresh({ activeWorkspaceId: 'semrush' }) }} initialView="library" />);
    expect(screen.getByLabelText('Source title')).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Source brief' })).toHaveValue('');
  });

  it('switches the selected workspace through the service and keeps editions explicit', async () => {
    const handlers = props(); render(<ContentStudioView {...handlers} />);
    fill('Content workspace', 'semrush'); await waitFor(() => expect(handlers.api.selectContentWorkspace).toHaveBeenCalledWith('semrush'));
    nav('Brand knowledge'); expect(screen.getByLabelText('Edition')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    expect(screen.getByLabelText('Edition')).toBeEnabled();
    fill('Workspace name', 'New client'); fill('Edition', 'semrush');
    fireEvent.click(screen.getByRole('button', { name: 'Save brand knowledge' }));
    await waitFor(() => expect(handlers.api.saveContentWorkspace).toHaveBeenCalledWith(expect.objectContaining({ name: 'New client', editionId: 'semrush' })));
  });

  it('generates only the explicitly selected deliverables with the source evidence and budget', async () => {
    const handlers = await setupCreate();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Evidence report' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Social captions' }));
    expect(screen.queryByRole('checkbox', { name: 'Editorial heroes' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review generation' })); fill('Spending allowance (USD)', '2.25');
    fireEvent.click(screen.getByRole('button', { name: 'Generate drafts' }));
    await waitFor(() => expect(handlers.api.createContentRun).toHaveBeenCalledOnce());
    expect(handlers.api.createContentRun).toHaveBeenCalledWith({ workspaceId: 'general', source, deliverableIds: ['evidence-report', 'social'], imageVariants: 3, maxBudgetUsd: 2.25 });
  });

  it('keeps core Semrush formats concise and makes additional formats selectable without losing choices', async () => {
    const handlers = props({ state: { contentStudio: fresh({ activeWorkspaceId: 'semrush' }) } });
    await setupCreate(handlers);
    expect(screen.queryByRole('checkbox', { name: 'Editorial heroes' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Evidence report' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explore 1 more format' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Editorial heroes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show core formats' }));
    creationStep('Review & generate');
    fireEvent.click(screen.getByRole('button', { name: 'Generate drafts' }));
    await waitFor(() => expect(handlers.api.createContentRun).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'semrush', deliverableIds: ['evidence-report', 'sel-image'] })));
  });

  it('validates source input before generation and supports keyboard-accessible steps', async () => {
    const handlers = props(); render(<ContentStudioView {...handlers} initialView="create" />);
    await screen.findByRole('checkbox', { name: 'Evidence report', hidden: true });
    fireEvent.click(screen.getByRole('button', { name: 'Choose deliverables' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give the source brief a title'); expect(handlers.api.createContentRun).not.toHaveBeenCalled();
    const first = screen.getByRole('tab', { name: 'Source brief' }); fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Choose deliverables' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Choose deliverables' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Review & generate' })).toHaveFocus();
  });

  it('keeps image output separate from text and blocks unavailable image providers', async () => {
    const handlers = props({ state: { contentStudio: fresh({ capabilities: { imagesConfigured: false } }) } }); await setupCreate(handlers);
    expect(screen.getByRole('checkbox', { name: 'Campaign graphic' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Social captions' })).toBeEnabled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Configure images' })); expect(handlers.onNavigate).toHaveBeenCalledWith('settings');
  });

  it('shows the configured image route and describes the spending allowance honestly', async () => {
    const handlers = props({ state: { contentStudio: fresh({ capabilities: { imagesConfigured: true, imageProvider: 'OpenAI', imageModel: 'fixture-image-model' } }) } });
    await setupCreate(handlers);
    expect(screen.getByText('OpenAI · fixture-image-model')).toBeVisible();
    expect(screen.getByLabelText('Spending allowance (USD)')).toHaveValue(5);
    expect(screen.getByText('Authorizes requests; it is not a hard cap on provider charges.')).toBeVisible();
    expect(handlers.api.createContentRun).not.toHaveBeenCalled();
  });

  it('requests a chosen number of image directions without inventing image output', async () => {
    const handlers = await setupCreate(); fireEvent.click(screen.getByRole('checkbox', { name: 'Campaign graphic' }));
    fill('Image directions per selected image output', '2'); creationStep('Review & generate');
    fireEvent.click(screen.getByRole('button', { name: 'Generate drafts' }));
    await waitFor(() => expect(handlers.api.createContentRun).toHaveBeenCalledWith(expect.objectContaining({ deliverableIds: ['brand-image'], imageVariants: 2 })));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('imports local and connected Google documents through the configured APIs', async () => {
    const handlers = props(); render(<ContentStudioView {...handlers} initialView="create" />);
    fireEvent.click(screen.getByRole('button', { name: 'Import document' }));
    await waitFor(() => expect(screen.getByLabelText('Source title')).toHaveValue('Imported research'));
    expect(handlers.api.importStudioSource).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole('button', { name: 'Google Doc' })); fill('Google document URL', 'https://docs.google.com/document/d/example/edit');
    fireEvent.click(screen.getByRole('button', { name: 'Read document' }));
    await waitFor(() => expect(handlers.api.importStudioSource).toHaveBeenCalledWith({ url: 'https://docs.google.com/document/d/example/edit' }));
  });

  it('preserves report evidence when handing a saved report into content creation', async () => {
    const handlers = props({ state: { contentStudio: fresh({ availableReports: [{ id: 'report-1', assetId: 'a1', title: 'Ready research' }, { id: 'private-report', workspaceId: 'semrush', title: 'Private report', text: 'Private' }] }) } });
    render(<ContentStudioView {...handlers} initialView="create" />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a report' })); expect(screen.queryByText('Private report')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ready research/ }));
    await waitFor(() => expect(screen.getByLabelText('Source title')).toHaveValue('Saved report'));
    expect(screen.getByText('1 evidence records attached')).toBeVisible();
    expect(handlers.api.readStudioAsset).toHaveBeenCalledWith({ assetId: 'a1' });
  });

  it('saves reusable research programs with bulk sources and explicit budgets', async () => {
    const handlers = props(); render(<ContentStudioView {...handlers} initialView="research" />);
    fill('Program name', 'Competitive listening'); fill('Research focus (optional)', 'AI reporting');
    fireEvent.click(screen.getByRole('checkbox', { name: /Reddit communities/ })); fill('Subreddits', 'r/SaaS\nr/marketing\nr/SaaS');
    fireEvent.click(document.querySelector('#cs-source-options-reddit summary')); fireEvent.click(document.getElementById('cs-source-reddit-includeComments')); fireEvent.change(document.getElementById('cs-source-reddit-maxComments'), { target: { value: '3' } }); fireEvent.change(document.getElementById('cs-source-reddit-time'), { target: { value: 'month' } });
    fill('Collection budget (USD)', '1.25'); fill('AI budget (USD)', '3.50');
    fireEvent.click(screen.getByRole('button', { name: 'Save research program' }));
    await waitFor(() => expect(handlers.api.saveResearchProgram).toHaveBeenCalledOnce());
    const payload = handlers.api.saveResearchProgram.mock.calls[0][0];
    expect(payload).toMatchObject({ name: 'Competitive listening', query: 'AI reporting', workspaceId: 'general', budgets: { collectionUsd: 1.25, aiUsd: 3.5 } });
    expect(payload.sourceGroups.find((group) => group.sourceId === 'reddit').targets).toEqual(['r/SaaS', 'r/marketing']);
    expect(payload.sourceGroups.find((group) => group.sourceId === 'reddit').options).toEqual({ includeComments: true, maxComments: 3, time: 'month' });
    expect(handlers.api.startResearchRun).not.toHaveBeenCalled();
  });

  it.each([
    ['daily', 1, null],
    ['weekly', 7, 'Day of the week'],
    ['monthly', 30, 'Day of the month'],
  ])('configures %s research without enabling paid runs implicitly', async (frequency, days, extraField) => {
    const handlers = props(); render(<ContentStudioView {...handlers} initialView="research" />);
    fill('Program name', 'Recurring research');
    fireEvent.click(screen.getByRole('checkbox', { name: /Reddit communities/ })); fill('Subreddits', 'SEO');
    fireEvent.click(screen.getByRole('radio', { name: /Custom dates/ }));
    fill('Start date', '2026-09-01'); fill('End date', '2026-09-27');
    fill('Repeat', frequency);
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Look back (days)')).toHaveValue(days);
    expect(screen.getByRole('checkbox', { name: /Enable scheduled runs/ })).not.toBeChecked();
    if (extraField) expect(screen.getByLabelText(extraField)).toBeVisible();
    expect(screen.queryByLabelText(frequency === 'weekly' ? 'Day of the month' : 'Day of the week')).not.toBeInTheDocument();
    fill('Run time', '08:30'); fill('Time zone', 'America/New_York');
    if (frequency === 'weekly') fill('Day of the week', '3');
    if (frequency === 'monthly') { fill('Day of the month', '31'); expect(screen.getByText('Shorter months use their last day.')).toBeVisible(); }
    fireEvent.click(screen.getByRole('button', { name: 'Save research program' }));
    await waitFor(() => expect(handlers.api.saveResearchProgram).toHaveBeenCalledOnce());
    expect(handlers.api.saveResearchProgram.mock.calls[0][0]).toMatchObject({
      schedule: { frequency, enabled: false, time: '08:30', timeZone: 'America/New_York', lookbackDays: days, weekday: frequency === 'weekly' ? 3 : 1, dayOfMonth: frequency === 'monthly' ? 31 : 1 },
      window: { startDate: '2026-09-01', endDate: '2026-09-27' },
    });
    expect(handlers.api.startResearchRun).not.toHaveBeenCalled();
  });

  it('defaults to the n8n seven-day window, per-stage models and an opt-in topic filter', async () => {
    const handlers = props(); render(<ContentStudioView {...handlers} initialView="research" />);
    fill('Program name', 'Golden Thread');
    expect(screen.getByRole('radio', { name: /Last few days/ })).toBeChecked();
    expect(screen.getByLabelText('Search the last (days)')).toHaveValue(7);
    expect(screen.queryByRole('checkbox', { name: /Also filter account and community collection/ })).not.toBeInTheDocument();
    fill('Research focus (optional)', 'AI search visibility');
    expect(screen.getByRole('checkbox', { name: /Also filter account and community collection/ })).not.toBeChecked();
    expect(document.getElementById('cs-model-tagging')).toHaveValue('claude-fable-5-1');
    expect(document.getElementById('cs-model-discovery')).toHaveValue('claude-opus-5-5');
    fireEvent.change(document.getElementById('cs-model-tagging'), { target: { value: 'claude-opus-5-5' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Approve themes automatically/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /X accounts/ })); fill('X accounts', '@aleyda');
    fireEvent.click(screen.getByRole('button', { name: 'Save research program' }));
    await waitFor(() => expect(handlers.api.saveResearchProgram).toHaveBeenCalledOnce());
    expect(handlers.api.saveResearchProgram.mock.calls[0][0]).toMatchObject({ window: { startDate: '', endDate: '' }, lookbackDays: 7, topicFiltersTargets: false, autoApproveThemes: true, ai: { models: { tagging: 'claude-opus-5-5', reports: 'claude-fable-5-1' } }, taggingBatchSizes: { x: 50, linkedin: 40, reddit: 50 } });
  });

  it('labels the rolling window and warns before a budget that cannot start a run', async () => {
    const rolling = { ...program, window: { startDate: '', endDate: '' }, lookbackDays: 14, autoApproveThemes: true, budgets: { collectionUsd: 5, aiUsd: 5 } };
    const estimateResearchProgram = vi.fn(async () => ({ ai: { totalUsd: 120, stages: { discovery: 20, synthesis: 2, matching: 1, tagging: 80, reports: 17 }, posts: { total: 9000 }, batches: { discovery: 45, tagging: 200 } }, collection: { worstCaseUsd: 47.22, jobCount: 84 } }));
    const base = props(); const handlers = { ...base, api: { ...base.api, estimateResearchProgram }, state: { contentStudio: fresh({ programs: [rolling] }) } };
    render(<ContentStudioView {...handlers} initialView="research" />);
    expect(screen.getByText('Last 14 days')).toBeVisible();
    expect(screen.getByText(/goes straight from discovery to tagging and reports/)).toBeVisible();
    expect(await screen.findByText(/will not start with this AI budget \(\$5\.00\)\. It needs at least \$60\.00, half of the \$120\.00 for a full unattended run/)).toBeVisible();
    expect(estimateResearchProgram.mock.calls[0][0]).toMatchObject({ lookbackDays: 14, sourceGroups: [{ targets: ['apify'] }] });
  });

  it('only enables a schedule through the explicit checkbox and preserves per-run limits', async () => {
    const handlers = props(); render(<ContentStudioView {...handlers} initialView="research" />);
    fill('Program name', 'Daily listening'); fill('Repeat', 'daily'); fill('Look back (days)', '3');
    fill('Collection budget (USD)', '1.50'); fill('AI budget (USD)', '2.00');
    const enable = screen.getByRole('checkbox', { name: /Enable scheduled runs/ });
    expect(enable.closest('label')).toHaveTextContent('Each run can use up to $1.50 for collection and $2.00 for AI.');
    fireEvent.click(enable);
    expect(screen.getByText(/Saving enables future runs with the limits above/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save research program' }));
    await waitFor(() => expect(handlers.api.saveResearchProgram).toHaveBeenCalledOnce());
    expect(handlers.api.saveResearchProgram.mock.calls[0][0]).toMatchObject({ schedule: { frequency: 'daily', enabled: true, lookbackDays: 3 }, budgets: { collectionUsd: 1.5, aiUsd: 2 } });
    expect(handlers.api.startResearchRun).not.toHaveBeenCalled();
  });

  it('restores fixed dates and turns off recurrence when switching back to manual runs', async () => {
    const scheduledProgram = { ...program, schedule: { frequency: 'weekly', enabled: true, time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1, lookbackDays: 7 } };
    const handlers = props({ state: { contentStudio: fresh({ programs: [scheduledProgram] }) } });
    render(<ContentStudioView {...handlers} initialView="research" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit program' })); fill('Repeat', 'manual');
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('End date')).toHaveValue('2026-09-27');
    expect(screen.queryByRole('checkbox', { name: /Enable scheduled runs/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save research program' }));
    await waitFor(() => expect(handlers.api.saveResearchProgram).toHaveBeenCalledOnce());
    expect(handlers.api.saveResearchProgram.mock.calls[0][0]).toMatchObject({ schedule: { frequency: 'manual', enabled: false }, window: program.window });
  });

  it('shows the saved next run in its time zone and pauses or resumes without losing the brief', async () => {
    const scheduledProgram = { ...program, schedule: { frequency: 'weekly', enabled: true, time: '09:00', timeZone: 'America/New_York', weekday: 1, dayOfMonth: 1, lookbackDays: 7, nextRunAt: '2026-09-28T13:00:00.000Z' } };
    const handlers = props({ state: { contentStudio: fresh({ programs: [scheduledProgram] }) } });
    const { rerender } = render(<ContentStudioView {...handlers} initialView="research" />);
    const schedule = screen.getByRole('region', { name: 'Program schedule' });
    expect(schedule).toHaveTextContent('Schedule is on');
    expect(schedule).toHaveTextContent(/Next run:.*Sep 28.*9:00/);
    expect(schedule).toHaveTextContent('Every Monday at 09:00 · America/New_York');
    expect(screen.getByText('Previous 7 complete UTC days')).toBeVisible();
    expect(screen.queryByText(/2026-09-01 → 2026-09-27/)).not.toBeInTheDocument();
    fireEvent.click(within(schedule).getByRole('button', { name: 'Pause schedule' }));
    await waitFor(() => expect(handlers.api.saveResearchProgram).toHaveBeenCalledWith({ ...scheduledProgram, schedule: { ...scheduledProgram.schedule, enabled: false } }));
    const paused = { ...scheduledProgram, schedule: { ...scheduledProgram.schedule, enabled: false, nextRunAt: '' } };
    rerender(<ContentStudioView {...handlers} state={{ contentStudio: fresh({ programs: [paused] }) }} initialView="research" />);
    expect(screen.getByRole('region', { name: 'Program schedule' })).toHaveTextContent('Schedule is paused');
    expect(screen.queryByText('Next run:')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
    await waitFor(() => expect(handlers.api.saveResearchProgram).toHaveBeenLastCalledWith({ ...paused, schedule: { ...paused.schedule, enabled: true } }));
    expect(handlers.api.startResearchRun).not.toHaveBeenCalled();
  });

  it('only offers scoped datasets and sends the explicit selected evidence collection', async () => {
    const handlers = props({ state: { datasets: [{ id: 'global', name: 'Global hidden collection' }], contentStudio: fresh({ programs: [program], availableDatasets: [{ id: 'd1', name: 'Saved posts', itemCount: 15, platform: 'x' }, { id: 'foreign', workspaceId: 'semrush', name: 'Other client data' }] }) } });
    render(<ContentStudioView {...handlers} initialView="research" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Use saved collections' }));
    expect(screen.queryByText('Other client data')).not.toBeInTheDocument(); expect(screen.queryByText('Global hidden collection')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Saved posts/ })); fireEvent.click(screen.getByRole('button', { name: 'Start research' }));
    await waitFor(() => expect(handlers.api.startResearchRun).toHaveBeenCalledWith({ programId: 'p1', datasetIds: ['d1'] }));
  });

  it('preserves theme identity and evidence when approving editorial changes before continuation', async () => {
    const run = { id: 'r1', workspaceId: 'general', programId: 'p1', status: 'awaiting-review', title: 'Weekly pulse', themes: [{ id: 't1', name: 'Manual reporting', description: 'Repeated reporting friction.', evidenceIds: ['e1'], evidenceCount: 1 }], counts: { retained: 12 }, discoveryProgress: { completed: 2, total: 2 } };
    const handlers = props({ state: { contentStudio: fresh({ programs: [program], researchRuns: [run] }) } });
    render(<ContentStudioView {...handlers} initialView="research" />); fill('Theme name', 'Reviewed reporting friction');
    fireEvent.click(screen.getByRole('button', { name: 'Approve themes & build reports' }));
    await waitFor(() => expect(handlers.api.continueResearchRun).toHaveBeenCalledWith({ runId: 'r1' }));
    expect(handlers.api.approveResearchThemes).toHaveBeenCalledWith({ runId: 'r1', themes: [expect.objectContaining({ id: 't1', name: 'Reviewed reporting friction', evidenceIds: ['e1'] })] });
    expect(handlers.api.approveResearchThemes.mock.invocationCallOrder[0]).toBeLessThan(handlers.api.continueResearchRun.mock.invocationCallOrder[0]);
    expect(screen.getByText('Discovery batches')).toBeVisible();
  });

  it('shows real partial-output progress and requires the chosen retry budget', async () => {
    const run = { id: 'c1', workspaceId: 'general', title: 'Test campaign', status: 'partial', maxBudgetUsd: 5, costUsd: 0.12, reservedUsd: 2, jobs: [{ id: 'evidence-report', label: 'Evidence report', status: 'succeeded' }, { id: 'social', label: 'Social captions', status: 'failed', error: 'Provider unavailable' }] };
    const handlers = props({ state: { contentStudio: fresh({ contentRuns: [run] }) } }); render(<ContentStudioView {...handlers} initialView="create" />);
    fireEvent.click(screen.getByRole('button', { name: /Test campaign.*Partial/ }));
    expect(screen.getByRole('progressbar', { name: 'Completed outputs' })).toHaveAttribute('value', '1');
    fill('Total retry budget (USD)', '9.50'); fireEvent.click(screen.getByRole('button', { name: 'Retry unfinished outputs' }));
    await waitFor(() => expect(handlers.api.retryStudioRun).toHaveBeenCalledWith({ runId: 'c1', maxBudgetUsd: 9.5 }));
  });

  it('publishes to Google Drive only on an explicit action and shows the returned receipt link', async () => {
    const run = { id: 'c1', workspaceId: 'general', title: 'Ready campaign', status: 'succeeded', jobs: [{ id: 'social', label: 'Social captions', status: 'succeeded' }] };
    const handlers = props({ state: { contentStudio: fresh({ capabilities: { imagesConfigured: true, googlePublishConfigured: true }, contentRuns: [run], assets: [{ id: 'a1', workspaceId: 'general', runId: 'c1', kind: 'text', title: 'Saved draft' }] }) } });
    handlers.api.publishStudioRun = vi.fn(async () => ({ status: 'succeeded', folderUrl: 'https://drive.google.com/drive/folders/fixture' }));
    render(<ContentStudioView {...handlers} initialView="create" />);
    fireEvent.click(screen.getByRole('button', { name: /Ready campaign/ }));
    expect(handlers.api.publishStudioRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to Google Drive' }));
    expect(await screen.findByRole('link', { name: 'Open Google Drive folder' })).toHaveAttribute('href', 'https://drive.google.com/drive/folders/fixture');
    expect(handlers.api.publishStudioRun).toHaveBeenCalledWith({ runId: 'c1' });
  });

  it('renders saved image bytes and calls explicit open/export actions', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const asset = { id: 'a1', workspaceId: 'general', runId: 'c1', kind: 'image', title: 'Saved campaign visual', channel: 'Design' };
    const handlers = props({ state: { contentStudio: fresh({ assets: [asset] }) } }); handlers.api.readStudioAsset.mockResolvedValue({ asset: { ...asset, receipt: { model: 'fixture-image-provider', costUsd: 0.04 } }, imageDataUrl: png });
    render(<ContentStudioView {...handlers} initialView="library" />);
    expect(await screen.findByRole('img', { name: 'Saved campaign visual' })).toHaveAttribute('src', png);
    expect(screen.getByText('Generation receipt')).toBeInTheDocument();
    expect(screen.getByText('fixture-image-provider')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open file' })); await waitFor(() => expect(handlers.api.openStudioAsset).toHaveBeenCalledWith({ assetId: 'a1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export pack' })); await waitFor(() => expect(handlers.api.exportStudioRun).toHaveBeenCalledWith({ runId: 'c1' }));
  });

  it('renders saved Markdown safely without remote image requests or raw HTML', async () => {
    const handlers = props({ state: { contentStudio: fresh({ assets: [{ id: 'a1', workspaceId: 'general', runId: 'c1', kind: 'text', title: 'Safe preview' }] }) } });
    handlers.api.readStudioAsset.mockResolvedValue({ markdown: '# Source-linked draft\n\n<img src="https://example.com/tracker">\n\n![tracker](https://example.com/tracker.png)\n\n<script>alert(1)</script>' });
    const { container } = render(<ContentStudioView {...handlers} initialView="library" />);
    expect(await screen.findByRole('heading', { name: 'Source-linked draft' })).toBeVisible(); expect(container.querySelector('script')).toBeNull(); expect(container.querySelector('img')).toBeNull();
  });

  it('shows saved products as summary rows, opens new ones, and opens unnamed ones on save', async () => {
    const products = [{ id: 'seo', name: 'SEO Toolkit', url: 'https://www.semrush.com/seo/', segment: 'self-serve', affiliateEligible: true, description: 'Keyword research.', capabilities: [], tools: ['Keyword Magic Tool', 'Position Tracking'] }, { id: 'ent', name: 'Enterprise SEO', url: 'https://enterprise.semrush.com/', segment: 'enterprise', capabilities: ['Custom reporting'], tools: [] }];
    const handlers = props({ state: { contentStudio: fresh({ workspaces: [{ ...workspace, products }, { id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }] }) } });
    const { container } = render(<ContentStudioView {...handlers} initialView="knowledge" />);
    const rows = () => [...container.querySelectorAll('details.cs-product-record')];
    expect(rows().map((row) => [row.open, row.querySelector('summary').textContent])).toEqual([[false, 'SEO ToolkitSelf-serve / PLG · semrush.com · 2 toolsAffiliate'], [false, 'Enterprise SEOEnterprise · enterprise.semrush.com · 1 capability']]);
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    expect(rows()).toHaveLength(3); expect(rows()[2].open).toBe(true); expect(rows()[2].querySelector('summary')).toHaveTextContent('New product');
    // Collapse the new row, then save: the unnamed product reopens with the error.
    rows()[2].open = false; fireEvent(rows()[2], new Event('toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'Save brand knowledge' }));
    expect(await screen.findByText('Name every product, or remove unfinished records.')).toBeVisible();
    expect(rows()[2].open).toBe(true); expect(handlers.api.saveContentWorkspace).not.toHaveBeenCalled();
  });
  it('edits approved product facts and saves knowledge without generating anything', async () => {
    const handlers = props(); render(<ContentStudioView {...handlers} initialView="knowledge" />);
    fill('Brand voice', 'Direct, thoughtful, and practical.'); fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    fill('Product name', 'Analytics toolkit'); fill('Approved product URL', 'https://example.com/toolkit'); fill('Product segment', 'self-serve'); fill('Supported capabilities', 'Campaign reporting\nAudience analysis');
    fireEvent.click(screen.getByRole('checkbox', { name: /Approved for affiliate use/ })); fireEvent.click(screen.getByRole('button', { name: 'Save brand knowledge' }));
    await waitFor(() => expect(handlers.api.saveContentWorkspace).toHaveBeenCalledOnce());
    expect(handlers.api.saveContentWorkspace.mock.calls[0][0]).toMatchObject({ id: 'general', knowledge: { voice: 'Direct, thoughtful, and practical.' }, products: [expect.objectContaining({ name: 'Analytics toolkit', segment: 'self-serve', affiliateEligible: true, capabilities: ['Campaign reporting', 'Audience analysis'] })] });
    expect(handlers.api.createContentRun).not.toHaveBeenCalled();
  });
});
