// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetsView, KanbanView } from '../src/renderer/src/pipeline-view.jsx';
import workflow from '../src/shared/asset-workflow.json';

afterEach(cleanup);

function board(state, props = {}) {
  return render(<KanbanView state={{ cards: [], datasets: [], assets: [], ...state }} busy={false} onMoveCard={vi.fn()} onSaveCard={vi.fn()} onGenerateAssets={vi.fn()} onNavigate={vi.fn()} {...props} />);
}

describe('real content board', () => {
  it('starts empty with a collection action and a labelled manual-card form', () => {
    const onNavigate = vi.fn();
    board({}, { onNavigate });
    expect(screen.getByText('Your content board is empty')).toBeInTheDocument();
    for (const example of workflow.initialCards) expect(screen.queryByText(example.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collect data' }));
    expect(onNavigate).toHaveBeenCalledWith('automation');
    expect(screen.getByRole('textbox', { name: 'Card title' })).toBeRequired();
  });

  it('preserves saved cards including prior example IDs and merges each dataset card only once', () => {
    const { container } = board({
      datasets: [{ id: 'ds-1', name: 'Source dataset', platform: 'web', itemCount: 3 }],
      cards: [
        { id: 'dataset-ds-1', title: 'My moved source', datasetId: 'ds-1', column: 'approved', tags: [] },
        { id: 'listen-1', title: 'My saved idea', column: 'detected', tags: [] },
      ],
    });
    expect(container.querySelectorAll('.kanban-card')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /My moved source/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My saved idea/ })).toBeInTheDocument();
    expect(screen.queryByText('Source dataset')).not.toBeInTheDocument();
    expect(screen.getAllByText('not generated').length).toBeGreaterThan(0);
  });

  it('labels sampled keyword scores without claiming factual verification', () => {
    render(<AssetsView state={{ assets: [{ id: 'a', title: 'Draft', markdown: 'A sourced claim needs a human to check it.', evidenceIds: ['outside-preview'], status: 'draft' }], v5: { evidenceSummary: { sample: [] } } }} onNavigate={vi.fn()} onSaveAsset={vi.fn()} onCreateCardFromAsset={vi.fn()} onExportAssetPack={vi.fn()} onOpenAssetsFolder={vi.fn()} onOpenAsset={vi.fn()} onRevealAsset={vi.fn()} />);
    expect(screen.getByText(/\/100 · heuristic/)).toBeInTheDocument();
    expect(screen.getByText(/outside the loaded preview/)).toBeInTheDocument();
    expect(screen.getByText(/does not verify factual accuracy/)).toBeInTheDocument();
    expect(screen.queryByText(/Unsupported claim count/)).not.toBeInTheDocument();
  });
});
