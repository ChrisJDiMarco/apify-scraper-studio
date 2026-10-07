// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetsView, ReportsView } from '../src/renderer/src/dataset-report-views.jsx';

afterEach(cleanup);

function datasetProps(count = 100) {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `run:${index}`,
    text: `Record ${String(index).padStart(3, '0')}`,
    author: `Author ${index}`,
    type: index < 100 ? 'post' : 'comment',
  }));
  return {
    state: { datasets: [{ id: 'dataset-a', name: 'Collected posts', platform: 'reddit', itemCount: count }] },
    selectedDatasetId: 'dataset-a',
    onDatasetSelect: vi.fn(),
    payload: { items, rawItems: items.map((_, index) => ({ id: String(index), text: `Original source ${index}` })) },
    busy: false,
    onAnalyze: vi.fn(),
    onExportDataset: vi.fn(),
    onNavigate: vi.fn(),
    onSearchEvidence: vi.fn(),
  };
}

function openAdvanced() {
  fireEvent.click(screen.getByText('View options & advanced tools'));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function dataRows() {
  return screen.getAllByRole('row').slice(1);
}

describe('dataset browsing regressions', () => {
  it.each([91, 100, 180, 181])('visits %i rows once across non-overlapping pages', (count) => {
    render(<DatasetsView {...datasetProps(count)} />);
    const visited = [];
    let page = 0;
    while (true) {
      const first = page * 90;
      const end = Math.min(first + 90, count);
      const rows = dataRows();
      expect(rows).toHaveLength(end - first);
      expect(screen.getByText(`${first + 1}–${end} of ${count} rows`)).toBeInTheDocument();
      rows.forEach((row) => visited.push(within(row).getByText(/^Record \d+$/).textContent));
      const next = screen.getByRole('button', { name: 'Next' });
      if (end === count) {
        expect(next).toBeDisabled();
        break;
      }
      fireEvent.click(next);
      page += 1;
    }
    expect(visited).toHaveLength(count);
    expect(new Set(visited).size).toBe(count);
    expect(visited[0]).toBe('Record 000');
    expect(visited.at(-1)).toBe(`Record ${String(count - 1).padStart(3, '0')}`);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText(`Record ${String((page - 1) * 90).padStart(3, '0')}`)).toBeInTheDocument();
  });

  it.each(['prefixed', 'missing', 'duplicate'])('keeps the correct raw source when filtered row IDs are %s', (idMode) => {
    const props = datasetProps();
    props.payload.items = props.payload.items.map((item, index) => ({
      ...item,
      id: idMode === 'prefixed' ? item.id : idMode === 'duplicate' ? 'duplicate-id' : undefined,
      text: index === 7 || index === 95 ? `Target row ${index}` : item.text,
    }));
    const { container } = render(<DatasetsView {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search dataset rows' }), { target: { value: 'Target row' } });
    expect(dataRows()).toHaveLength(2);
    fireEvent.keyDown(dataRows()[1], { key: 'Enter' });
    expect(dataRows()[1]).toHaveAttribute('aria-selected', 'true');
    openAdvanced();
    fireEvent.click(screen.getByRole('button', { name: 'Compare raw' }));
    const compared = container.querySelectorAll('.dataset-compare pre');
    expect(compared).toHaveLength(2);
    expect(JSON.parse(compared[0].textContent).text).toBe('Target row 95');
    expect(JSON.parse(compared[1].textContent)).toEqual(props.payload.rawItems[95]);
  });

  it('resets the page and selection when filters or the dataset change', () => {
    const props = datasetProps(191);
    const { rerender } = render(<DatasetsView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(dataRows()[8]);
    expect(dataRows()[8]).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by type' }), { target: { value: 'comment' } });
    expect(screen.getByText('1–90 of 91 rows')).toBeInTheDocument();
    expect(dataRows()[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(dataRows()[0]).getByText('Record 100')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search dataset rows' }), { target: { value: 'Record 189' } });
    expect(screen.getByText('1–1 of 1 rows')).toBeInTheDocument();
    const nextProps = datasetProps(101);
    nextProps.state.datasets[0].id = 'dataset-b';
    nextProps.selectedDatasetId = 'dataset-b';
    rerender(<DatasetsView {...nextProps} />);
    expect(screen.getByRole('textbox', { name: 'Search dataset rows' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Filter by type' })).toHaveValue('all');
    expect(screen.getByText('1–90 of 101 rows')).toBeInTheDocument();
    expect(dataRows()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('provides a working reset when a search has no matching rows', () => {
    const { container } = render(<DatasetsView {...datasetProps(3)} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search dataset rows' }), { target: { value: 'No such row' } });
    expect(screen.getByText('No matching rows')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.querySelector('.dataset-window-tools')).toBeNull();
    expect(container.querySelector('.data-row-detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('1–3 of 3 rows')).toBeInTheDocument();
    expect(dataRows()).toHaveLength(3);
  });
});

describe('cross-run evidence search', () => {
  it('handles a failed search and allows a successful retry', async () => {
    const props = datasetProps(3);
    props.onSearchEvidence.mockRejectedValueOnce(new Error('Evidence service unavailable')).mockResolvedValueOnce([{ id: 'match', text: 'Useful evidence' }]);
    render(<DatasetsView {...props} />);
    openAdvanced();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search dataset rows' }), { target: { value: 'Record' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search all runs' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence service unavailable');
    expect(screen.getByRole('button', { name: 'Search all runs' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Search all runs' }));
    expect(await screen.findByText('Useful evidence')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(props.onSearchEvidence).toHaveBeenLastCalledWith({ query: 'Record', limit: 12 });
  });

  it.each(['resolve', 'reject'])('ignores a stale search that later %ss after the current search finishes', async (settle) => {
    const older = deferred();
    const newer = deferred();
    const props = datasetProps(3);
    props.onSearchEvidence.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render(<DatasetsView {...props} />);
    openAdvanced();
    const search = screen.getByRole('textbox', { name: 'Search dataset rows' });
    fireEvent.change(search, { target: { value: 'Older query' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search all runs' }));
    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled();
    fireEvent.change(search, { target: { value: 'Current query' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search all runs' }));
    await act(async () => newer.resolve([{ id: 'current', text: 'Current evidence' }]));
    expect(screen.getByRole('status')).toHaveTextContent('Current evidence');
    await act(async () => {
      if (settle === 'resolve') older.resolve([{ id: 'stale', text: 'Outdated evidence' }]);
      else older.reject(new Error('Outdated search failure'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Current evidence');
    expect(screen.queryByText('Outdated evidence')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('discards evidence from a dataset that is no longer selected', async () => {
    const pending = deferred();
    const props = datasetProps(3);
    props.onSearchEvidence.mockReturnValue(pending.promise);
    const { rerender } = render(<DatasetsView {...props} />);
    openAdvanced();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search dataset rows' }), { target: { value: 'Record' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search all runs' }));
    const nextProps = datasetProps(2);
    nextProps.state.datasets[0].id = 'dataset-b';
    nextProps.selectedDatasetId = 'dataset-b';
    rerender(<DatasetsView {...nextProps} />);
    await act(async () => pending.resolve([{ id: 'old-dataset', text: 'Previous dataset evidence' }]));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous dataset evidence')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search dataset rows' })).toHaveValue('');
  });
});

describe('report first-run guidance', () => {
  it('takes users with no datasets to the scraper workspace', () => {
    const onNavigate = vi.fn();
    render(<ReportsView state={{ datasets: [], analyses: [] }} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a scraper' }));
    expect(onNavigate).toHaveBeenCalledWith('automation');
    expect(screen.queryByRole('button', { name: 'Generate report' })).not.toBeInTheDocument();
  });
});
