// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { ActionQueue } from '../src/renderer/src/App.jsx';
import { DatasetsView } from '../src/renderer/src/dataset-report-views.jsx';
import { CommandPalette, MissionCommandCenter } from '../src/renderer/src/mission-command.jsx';
import { AssetsView } from '../src/renderer/src/pipeline-view.jsx';
import { Empty, StatusBanner } from '../src/renderer/src/ui.jsx';

afterEach(() => cleanup());

describe('renderer safety states', () => {
  it('renders a clear fallback when the Electron preload bridge is missing', () => {
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('Desktop bridge unavailable');
  });

  it('announces errors and notices through status components', () => {
    const { rerender } = render(<StatusBanner error="No token" />);
    expect(screen.getByRole('alert')).toHaveTextContent('No token');

    rerender(<StatusBanner notice="Saved" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('keeps empty-state actions reachable as native buttons', async () => {
    const onAction = vi.fn();
    render(<Empty title="No datasets" detail="Run a recipe." action="Create recipe" onAction={onAction} />);
    screen.getByRole('button', { name: 'Create recipe' }).click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('shows a useful empty dataset action instead of a blank table', () => {
    const onNavigate = vi.fn();
    render(
      <DatasetsView
        state={{ datasets: [{ id: 'ds-empty', name: 'Empty run', platform: 'reddit', itemCount: 0 }] }}
        selectedDatasetId="ds-empty"
        onDatasetSelect={vi.fn()}
        payload={{ items: [], rawItems: [] }}
        busy={false}
        onAnalyze={vi.fn()}
        onExportDataset={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText('Dataset is empty')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Open recipes' }).click();
    expect(onNavigate).toHaveBeenCalledWith('automation');
  });

  it('runs next-best actions with exact action payloads', () => {
    const action = {
      id: 'generate-report',
      label: 'Generate report',
      detail: 'Turn rows into intelligence.',
      view: 'reports',
      action: 'analyze-dataset',
      args: { datasetId: 'ds-1', kind: 'report', reportPresetId: 'lead-list' },
    };
    const onRunAction = vi.fn();
    render(<ActionQueue actions={[action]} busy={false} onRunAction={onRunAction} onNavigate={vi.fn()} />);

    screen.getByRole('button', { name: /Generate report/ }).click();
    expect(onRunAction).toHaveBeenCalledWith(action);
  });

  it('preserves next-best navigation args', () => {
    const action = {
      id: 'inspect-dataset-health',
      label: 'Inspect dataset quality',
      detail: 'Missing useful fields.',
      view: 'datasets',
      action: 'navigate',
      args: { datasetId: 'ds-2' },
    };
    const onNavigate = vi.fn();
    render(<ActionQueue actions={[action]} busy={false} onRunAction={vi.fn()} onNavigate={onNavigate} />);

    screen.getByRole('button', { name: /Inspect dataset quality/ }).click();
    expect(onNavigate).toHaveBeenCalledWith('datasets', { datasetId: 'ds-2' });
  });

  it('renders V5 mission command with evidence, jobs, artifacts, and release diagnostics', () => {
    const state = {
      recipes: [{ id: 'recipe-1', name: 'Lead recipe' }],
      datasets: [{ id: 'dataset-1', name: 'Lead dataset', itemCount: 12 }],
      analyses: [],
      cards: [],
      assets: [{ id: 'asset-1', title: 'LinkedIn Post', status: 'done', channel: 'LinkedIn' }],
      v5: {
        activeMissionId: 'mission-1',
        missions: [{ id: 'mission-1', name: 'Lead Mission', goal: 'Find sourced leads', recipeIds: ['recipe-1'], datasetIds: ['dataset-1'] }],
        jobs: [{ id: 'job-1', title: 'Build report', kind: 'codex', status: 'failed', attempts: 2 }],
        evidenceSummary: { total: 2, sample: [{ id: 'evidence-1', text: 'Acme needs automation', sourceUrl: 'https://example.com' }] },
        observability: { totalRuns: 3, failureRate: 0, totalItems: 42, avgItemsPerRun: 14 },
        release: { notarization: { status: 'missing-credentials' }, signing: { status: 'configured' }, update: { status: 'disabled' } },
        missionPresets: [{ id: 'lead-sheet' }],
        schedules: {},
      },
    };

    render(
      <MissionCommandCenter
        state={state}
        selectedDataset={state.datasets[0]}
        busy={false}
        onRunMission={vi.fn()}
        onRunActionGraph={vi.fn()}
        onPauseMission={vi.fn()}
        onScheduleMission={vi.fn()}
        onExportMissionBundle={vi.fn()}
        onSearchEvidence={vi.fn()}
        onRetryJob={vi.fn()}
        onReadJobLog={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText('V5 Mission Command')).toBeInTheDocument();
    expect(screen.getByText('Lead Mission')).toBeInTheDocument();
    expect(screen.getByText('Evidence graph')).toBeInTheDocument();
    expect(screen.getByText('Durable jobs')).toBeInTheDocument();
    expect(screen.getByText('Artifact studio')).toBeInTheDocument();
  });

  it('runs edited V5 action graphs and exposes retryable job logs', async () => {
    const onRunActionGraph = vi.fn();
    const onRetryJob = vi.fn();
    const onReadJobLog = vi.fn(async () => 'Mission failed\nretry me');
    const state = {
      recipes: [{ id: 'recipe-1', name: 'Lead recipe' }],
      datasets: [{ id: 'dataset-1', name: 'Lead dataset', itemCount: 12 }],
      assets: [],
      v5: {
        activeMissionId: 'mission-1',
        missions: [{ id: 'mission-1', name: 'Lead Mission', goal: 'make me a lead sheet', recipeIds: ['recipe-1'], datasetIds: ['dataset-1'] }],
        jobs: [{ id: 'job-1', title: 'Build report', kind: 'mission', status: 'failed', attempts: 1 }],
        evidenceSummary: { total: 0, sample: [] },
        observability: {},
        release: { notarization: {}, signing: {}, update: {} },
        missionPresets: [],
        schedules: {},
        evals: { passed: 0, total: 0, avgScore: 0 },
        onboarding: { done: 1, total: 4, next: { label: 'Save a recipe' } },
      },
    };

    render(
      <MissionCommandCenter
        state={state}
        selectedDataset={state.datasets[0]}
        busy={false}
        onRunMission={vi.fn()}
        onRunActionGraph={onRunActionGraph}
        onPauseMission={vi.fn()}
        onScheduleMission={vi.fn()}
        onExportMissionBundle={vi.fn()}
        onSearchEvidence={vi.fn()}
        onRetryJob={onRetryJob}
        onReadJobLog={onReadJobLog}
        onNavigate={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('analyze-dataset label'), { target: { value: 'Build sourced report' } });
    screen.getByRole('button', { name: /Run edited graph/ }).click();
    expect(onRunActionGraph).toHaveBeenCalledWith(expect.objectContaining({
      steps: expect.arrayContaining([expect.objectContaining({ label: 'Build sourced report' })]),
    }));

    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetryJob).toHaveBeenCalledWith('job-1');
    screen.getByRole('button', { name: 'Log' }).click();
    expect(await screen.findByText(/retry me/)).toBeInTheDocument();
  });

  it('runs command palette items through the provided action handler', () => {
    const onRun = vi.fn();
    render(<CommandPalette open items={[{ id: 'run', label: 'Run active mission', shortcut: 'Cmd+Enter' }]} onClose={vi.fn()} onRun={onRun} />);

    screen.getByRole('button', { name: /Run active mission/ }).click();
    expect(onRun).toHaveBeenCalledWith({ id: 'run', label: 'Run active mission', shortcut: 'Cmd+Enter' });
  });

  it('exports filtered asset packs from the asset library', () => {
    const onExportAssetPack = vi.fn();
    render(
      <AssetsView
        state={{ assets: [{ id: 'asset-1', title: 'Launch Post', markdown: 'body', status: 'done', channel: 'LinkedIn' }], v5: { evidenceSummary: { sample: [] } } }}
        onNavigate={vi.fn()}
        onSaveAsset={vi.fn()}
        onCreateCardFromAsset={vi.fn()}
        onExportAssetPack={onExportAssetPack}
        onOpenAssetsFolder={vi.fn()}
        onOpenAsset={vi.fn()}
        onRevealAsset={vi.fn()}
      />,
    );

    screen.getByRole('button', { name: 'Export pack' }).click();
    expect(onExportAssetPack).toHaveBeenCalledWith({ assetIds: ['asset-1'] });
  });
});
