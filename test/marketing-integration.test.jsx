// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import recipe from '../src/shared/recipe.js';
import runner from '../src/shared/apify-runner.js';
import codex from '../src/shared/codex-runner.js';
import { ReportsView } from '../src/renderer/src/dataset-report-views.jsx';

const brief = { templateId: 'competitor-positioning', reportPresetId: 'competitor-positioning', templateVersion: 1, brand: 'Acme', decision: 'How should our launch differ?', audience: 'Operations leaders', sourceUrls: ['https://example.com/pricing'] };
const starter = { name: 'Acme positioning', platform: 'web', actorId: 'apify/website-content-crawler', input: { startUrls: [{ url: 'https://example.com/pricing' }] }, marketingBrief: brief, runOptions: { maxTotalChargeUsd: 2, timeoutSecs: 300 } };
afterEach(cleanup);

describe('marketing starter execution contract', () => {
  it('persists context and limits through save and generic recipe edits', () => {
    const saved = recipe.validateRecipe(starter);
    const edited = recipe.validateRecipe({ ...recipe.publicRecipe(saved), name: 'Revised name', inputJson: JSON.stringify(saved.input) }, saved);
    expect(edited.marketingBrief).toEqual(brief);
    expect(edited.runOptions).toEqual({ maxTotalChargeUsd: 2, timeoutSecs: 300 });
  });

  it.each([0, -1, Infinity, NaN, 101])('rejects an invalid run budget: %s', (cap) => {
    expect(() => recipe.validateRecipe({ ...starter, runOptions: { maxTotalChargeUsd: cap, timeoutSecs: 300 } })).toThrow(/budget/);
  });

  it('rejects unsafe source URLs and mismatched presets at the save boundary', () => {
    expect(() => recipe.validateRecipe({ ...starter, marketingBrief: { ...brief, sourceUrls: ['file:///etc/passwd'] } })).toThrow(/HTTP/);
    expect(() => recipe.validateRecipe({ ...starter, marketingBrief: { ...brief, sourceUrls: ['https://user:password@example.com'] } })).toThrow(/credentials/);
    expect(() => recipe.validateRecipe({ ...starter, marketingBrief: { ...brief, reportPresetId: 'lead-list' } })).toThrow(/Unknown/);
  });

  it.each(['start', 'call'])('passes budgets and timeout outside Actor input using %s', async (method) => {
    const invoke = vi.fn(async () => ({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'dataset-1' }));
    class Client {
      actor() { return { [method]: invoke }; }
      dataset() { return { listItems: async () => ({ items: [], total: 0 }) }; }
    }
    await runner.createApifyRunner({ token: 'test', Client }).runRecipe(starter, { maxItems: 10 });
    expect(invoke).toHaveBeenCalledWith(starter.input, { maxItems: 10, maxTotalChargeUsd: 2, timeout: 300 });
    expect(starter.input).not.toHaveProperty('maxTotalChargeUsd');
  });

  it('retains source scope and the decision in analysis context with the matching preset', () => {
    const context = codex.buildAnalysisContext({ dataset: { id: 'ds', marketingBrief: brief, collectionScope: { requestedUrls: brief.sourceUrls, returnedRows: 1 } } });
    expect(context.marketingBrief).toEqual(brief);
    expect(context.run.reportPresetId).toBe('competitor-positioning');
    expect(context.collectionScope.returnedRows).toBe(1);
    expect(codex.buildPrompt('report', '/tmp/items.jsonl', { reportPresetId: 'competitor-positioning' })).toContain('company-by-company');
  });

  it('selects a dataset’s starter report and preserves manual choices until datasets change', () => {
    const onAnalyze = vi.fn();
    const props = { state: { datasets: [{ id: 'ds', name: 'Acme research', itemCount: 3, marketingBrief: brief }, { id: 'other', name: 'Other research', itemCount: 2 }], analyses: [] }, selectedDatasetId: 'ds', onAnalyze, onDatasetSelect: vi.fn(), onReadAnalysis: vi.fn() };
    const { rerender } = render(<ReportsView {...props} />);
    const preset = screen.getByRole('combobox', { name: 'What do you want to learn?' });
    expect(preset).toHaveValue('competitor-positioning');
    expect(screen.getByText(brief.decision)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(onAnalyze).toHaveBeenCalledWith('ds', 'report', { reportPresetId: 'competitor-positioning' });
    fireEvent.change(preset, { target: { value: 'launch-research' } });
    rerender(<ReportsView {...props} busy={true} />);
    expect(preset).toHaveValue('launch-research');
    rerender(<ReportsView {...props} selectedDatasetId="other" />);
    expect(preset).toHaveValue('market-scan');
    expect(screen.queryByText(brief.decision)).not.toBeInTheDocument();
  });
});
