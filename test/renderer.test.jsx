// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import { DatasetsView } from '../src/renderer/src/dataset-report-views.jsx';
import { CommandPalette } from '../src/renderer/src/command-palette.jsx';
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
    screen.getByRole('button', { name: 'Open scrapers' }).click();
    expect(onNavigate).toHaveBeenCalledWith('automation');
  });

  it('runs command palette items through the provided action handler', () => {
    const onRun = vi.fn();
    render(<CommandPalette open items={[{ id: 'run', label: 'Run Weekly SEO watch…', shortcut: 'Cmd+Enter' }]} onClose={vi.fn()} onRun={onRun} />);

    screen.getByRole('button', { name: /Run Weekly SEO watch/ }).click();
    expect(onRun).toHaveBeenCalledWith({ id: 'run', label: 'Run Weekly SEO watch…', shortcut: 'Cmd+Enter' });
  });
});
