// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportDataView } from '../src/renderer/src/import-data-view.jsx';
import { CompareView } from '../src/renderer/src/compare-view.jsx';

afterEach(() => { cleanup(); delete window.apifyStudio; });
const preview = { ready: true, inputRows: 2, importedRows: 1, duplicateRows: 1, warnings: ['1 exact duplicate record excluded.'], columns: ['feedback', 'link'], mapping: { text: 'feedback', url: 'link' }, preview: [{ id: 'row1', text: '<script>not executable</script>', url: 'https://example.com' }] };
const importProps = (overrides = {}) => ({ onPreview: vi.fn(async () => ({ summary: preview })), onImport: vi.fn(async () => ({ dataset: { id: 'imported', name: 'New research' }, summary: preview })), onNavigate: vi.fn(), ...overrides });
const datasets = [{ id: 'current', name: 'Current pages', recipeId: 'recipe', platform: 'web', createdAt: '2026-09-27T12:00:00Z' }, { id: 'baseline', name: 'Earlier pages', recipeId: 'recipe', platform: 'web', createdAt: '2026-09-20T12:00:00Z' }];
const compareResult = { scopeStatus: 'compatible', summary: { changed: 1, new: 0, unavailable: 1, unchanged: 0 }, changes: [{ url: 'https://example.com/changed', status: 'changed', beforeExcerpt: 'Price $10', afterExcerpt: 'Price $15', beforeCollectedAt: '2026-09-20T12:00:00Z', afterCollectedAt: '2026-09-27T12:00:00Z' }, { url: 'https://example.com/missing', status: 'unavailable', beforeExcerpt: 'Old copy', afterExcerpt: '', reason: 'No current capture; not a confirmed removal.' }], warnings: ['Unavailable does not mean removed.'], comparisonDataset: { id: 'derived-comparison', itemCount: 2 } };

async function populateImport(handlers) {
  render(<ImportDataView {...handlers} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Or paste your records' }), { target: { value: 'feedback,link\nA need,https://example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview records' }));
  await screen.findByRole('heading', { name: '1 record ready' });
}

describe('research import UI', () => {
  it('previews escaped content and requires authorization before passing the final import payload', async () => {
    const handlers = importProps({ templateId: 'voice-of-customer' });
    await populateImport(handlers);
    expect(handlers.onPreview).toHaveBeenCalledWith(expect.objectContaining({ preview: true, authorized: false, sourceType: 'customer-feedback' }));
    expect(screen.getByText('<script>not executable</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to research' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have permission to use and import this data.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to research' }));
    await screen.findByRole('heading', { name: 'Your evidence is ready to explore.' });
    expect(handlers.onImport).toHaveBeenCalledWith(expect.objectContaining({ preview: false, authorized: true, mapping: { text: 'feedback', url: 'link' }, templateId: 'voice-of-customer', reportPresetId: 'voice-of-customer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create research brief' }));
    expect(handlers.onNavigate).toHaveBeenCalledWith('reports', { datasetId: 'imported', reportPresetId: 'voice-of-customer' });
  });

  it('invalidates an old preview after mapping changes and preserves input after failure', async () => {
    const handlers = importProps({ onPreview: vi.fn().mockResolvedValueOnce({ summary: preview }).mockRejectedValueOnce(new Error('Check your mapping')) });
    await populateImport(handlers);
    fireEvent.click(screen.getByRole('checkbox', { name: /I have permission/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Map Text' }), { target: { value: 'link' } });
    expect(screen.getByRole('button', { name: 'Add to research' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview mapped records' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your mapping');
    expect(screen.getByRole('textbox', { name: 'Or paste your records' })).toHaveValue('feedback,link\nA need,https://example.com');
    expect(handlers.onImport).not.toHaveBeenCalled();
  });

  it('shows the selected workspace brand as editable import context', () => {
    render(<ImportDataView {...importProps()} state={{ brandProfiles: [{ id: 'brand', name: 'Acme', audience: 'Marketing leaders' }], settings: { selectedBrandProfileId: 'brand' } }} />);
    fireEvent.click(screen.getByText('Research context'));
    expect(screen.getByRole('textbox', { name: 'Brand or project' })).toHaveValue('Acme');
    expect(screen.getByRole('textbox', { name: 'Audience' })).toHaveValue('Marketing leaders');
    expect(screen.getByRole('textbox', { name: 'Decision to support' })).toHaveValue('');
  });

  it('accepts native file selection and infers format without importing automatically', async () => {
    const handlers = importProps({ onPickFile: vi.fn(async () => ({ name: 'research.jsonl', content: '{"text":"Evidence"}' })) });
    render(<ImportDataView {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Import format' })).toHaveValue('jsonl'));
    expect(screen.getByRole('textbox', { name: 'Collection name' })).toHaveValue('research');
    expect(screen.getByRole('textbox', { name: 'Or paste your records' })).toHaveValue('{"text":"Evidence"}');
    expect(handlers.onImport).not.toHaveBeenCalled();
  });
});

describe('snapshot comparison UI', () => {
  it('keeps a first snapshot honest and does not call the comparison service', () => {
    const onCompare = vi.fn();
    render(<CompareView state={{ datasets: [datasets[0]] }} onCompare={onCompare} />);
    expect(screen.getByText(/This collection establishes a baseline/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare snapshots' })).toBeDisabled();
    expect(onCompare).not.toHaveBeenCalled();
  });

  it('compares exact selected IDs, displays unavailable evidence, and drafts from the derived comparison dataset', async () => {
    const onCompare = vi.fn(async () => compareResult);
    const onNavigate = vi.fn();
    render(<CompareView state={{ datasets }} onCompare={onCompare} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare snapshots' }));
    await screen.findByRole('heading', { name: '1 source changed' });
    expect(onCompare).toHaveBeenCalledWith({ baselineId: 'baseline', currentId: 'current' });
    expect(screen.getByText('Price $10')).toBeInTheDocument();
    expect(screen.getByText('Price $15')).toBeInTheDocument();
    expect(screen.getByText('Unavailable does not mean removed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Draft change brief' }));
    expect(onNavigate).toHaveBeenCalledWith('reports', { datasetId: 'derived-comparison', reportPresetId: 'weekly-competitor-changes' });
  });

  it('limits rendered change cards and resets the page when changing filters', async () => {
    const changes = Array.from({ length: 65 }, (_, index) => ({ ...compareResult.changes[0], url: `https://example.com/${index}` }));
    render(<CompareView state={{ datasets }} onCompare={async () => ({ ...compareResult, changes, summary: { changed: 65 } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare snapshots' }));
    await screen.findByRole('heading', { name: '65 sources changed' });
    expect(document.querySelectorAll('.snapshot-change')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: /Show next 15 sources/ }));
    expect(document.querySelectorAll('.snapshot-change')).toHaveLength(65);
    fireEvent.click(screen.getByRole('button', { name: '65 Changed' }));
    expect(document.querySelectorAll('.snapshot-change')).toHaveLength(50);
  });

  it('saves a manual check-in with the selected baseline and displays the root nextCheckAt field', async () => {
    const onSaveMonitor = vi.fn(async () => ({ id: 'monitor' }));
    render(<CompareView state={{ datasets, recipes: [{ id: 'recipe', name: 'Competitor pages' }], monitors: [{ id: 'old', name: 'Old check-in', cadence: 'weekly', nextCheckAt: '2026-10-04T12:00:00Z' }] }} onSaveMonitor={onSaveMonitor} />);
    fireEvent.click(screen.getByText('Make this a regular check-in'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Check-in name' }), { target: { value: 'Weekly review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Check-in saved');
    expect(onSaveMonitor).toHaveBeenCalledWith({ name: 'Weekly review', recipeId: 'recipe', baselineDatasetId: 'current', cadence: 'weekly' });
    expect(screen.getByText(/does not schedule paid runs/)).toBeInTheDocument();
    expect(screen.getByText(/Next review/)).toBeInTheDocument();
  });
});
