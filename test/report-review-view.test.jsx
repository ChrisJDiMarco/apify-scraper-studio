// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoverageReviewPanel } from '../src/renderer/src/report-review-view.jsx';
import { ReportsView, DatasetsView } from '../src/renderer/src/dataset-report-views.jsx';

afterEach(() => { cleanup(); delete window.apifyStudio; });
const dataset = { id: 'dataset-a', name: 'Brand pages', itemCount: 2 };
const analysis = { id: 'analysis-a', datasetId: dataset.id, kind: 'report', status: 'succeeded', aiReceipt: { provider: 'claude', actualModel: 'verified-model', costUsd: 0 } };
function bundle() { return { fingerprint: 'evidence-fingerprint', analysis, dataset, coverage: { counts: { total: 2, included: 1, usableIncluded: 1 }, requestedScopeKnown: true, requestedUrls: ['https://brand.example/', 'https://brand.example/pricing'], missingUrls: ['https://brand.example/pricing'], blockers: [], warnings: [{ id: 'missing-requested-pages', message: 'One requested page has no match.' }], sourceCounts: { 'brand.example': 2 } }, evidence: [{ id: 'run:1', itemId: 'run:1', url: 'https://brand.example/', author: 'Brand', text: '<script>bad()</script> Plans start at $20.', excerpt: 'Plans start at $20.', includedInAnalysis: true }], review: { status: 'draft', version: 0, actions: [], acknowledgedWarnings: [] }, output: { summary: 'The product offers a monthly plan.' }, collectionReceipt: { status: 'succeeded', usageTotalUsdAtCompletion: null, runLimits: { maxTotalChargeUsd: 2, timeoutSecs: 300 } } }; }
function props(extra = {}) { return { analysis, dataset, reviewBundle: bundle(), onSaveReview: vi.fn(async (payload) => ({ review: { ...payload, version: 1 } })), onExportReview: vi.fn(async () => ({ reviewStatus: 'draft' })), ...extra }; }
function completeChecks() {
  fireEvent.change(screen.getByRole('textbox', { name: /Reviewer name/ }), { target: { value: 'Chris' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'One requested page has no match.' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /I checked the report/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /I accept the listed limits/ }));
}

describe('report evidence review', () => {
  it('starts as a draft and requires every review check before offering approval', async () => {
    const p = props(); render(<CoverageReviewPanel {...p} />);
    expect(screen.getByText('Draft · not approved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve locally' })).toBeDisabled();
    completeChecks();
    expect(screen.getByRole('button', { name: 'Approve locally' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export Markdown' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve locally' }));
    expect(await screen.findByText('Approved locally')).toBeInTheDocument();
    expect(p.onSaveReview).toHaveBeenCalledWith(expect.objectContaining({ analysisId: 'analysis-a', reviewer: 'Chris', status: 'approved', evidenceChecked: true, limitationsAccepted: true, acknowledgedWarnings: ['missing-requested-pages'], expectedVersion: 0, expectedFingerprint: 'evidence-fingerprint' }));
  });

  it('does not allow review checks to override hard provenance blockers', () => {
    const p = props(); p.reviewBundle.coverage.blockers = [{ id: 'unknown-analysis-sample', message: 'Historical sample is unknown.' }];
    render(<CoverageReviewPanel {...p} />); completeChecks();
    expect(screen.getByText('Historical sample is unknown.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve locally' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  it('preserves notes after a save failure and retries with the same expected version', async () => {
    const p = props(); p.onSaveReview.mockRejectedValueOnce(new Error('Disk unavailable'));
    render(<CoverageReviewPanel {...p} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Review notes' }), { target: { value: 'Check the pricing claim.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable');
    expect(screen.getByRole('textbox', { name: 'Review notes' })).toHaveValue('Check the pricing claim.');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
    expect(p.onSaveReview).toHaveBeenLastCalledWith(expect.objectContaining({ notes: 'Check the pricing claim.', expectedVersion: 0, expectedFingerprint: 'evidence-fingerprint' }));
  });

  it('opens saved source text inline and uses the explicit source bridge for safe external links', async () => {
    window.apifyStudio = { openSourceUrl: vi.fn().mockResolvedValue(undefined) };
    const { container } = render(<CoverageReviewPanel {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect evidence (1)' }));
    const source = screen.getByRole('article', { name: 'Selected evidence' });
    expect(within(source).getByText('<script>bad()</script> Plans start at $20.')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(/no structured claim-to-source map/)).toBeInTheDocument();
    fireEvent.click(within(source).getByRole('link'));
    await act(async () => {});
    expect(window.apifyStudio.openSourceUrl).toHaveBeenCalledWith('https://brand.example/');
  });

  it('distinguishes zero CLI-reported cost, missing collection usage and configured caps', () => {
    render(<CoverageReviewPanel {...props()} />);
    fireEvent.click(screen.getByText('Collection & AI receipts'));
    expect(screen.getByText('$0.0000')).toBeInTheDocument();
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText(/Run charge cap: \$2.0000/)).toBeInTheDocument();
    expect(screen.getByText(/may differ from subscription billing/)).toBeInTheDocument();
  });

  it('keeps an observation action unapprovable until it has an owner and linked evidence', () => {
    render(<CoverageReviewPanel {...props()} />); completeChecks();
    fireEvent.click(screen.getByText('Action plan (0)'));
    fireEvent.click(screen.getByRole('button', { name: 'Add an action' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Next step' }), { target: { value: 'Review the observed price' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Evidence classification' }), { target: { value: 'observation' } });
    expect(screen.getByRole('button', { name: 'Approve locally' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Owner' }), { target: { value: 'Pat' } });
    expect(screen.getByRole('button', { name: 'Approve locally' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /Linked source IDs/ }), { target: { value: 'run:1' } });
    expect(screen.getByRole('button', { name: 'Approve locally' })).toBeEnabled();
  });

  it('exports a saved draft with its explicit status and preserves unsaved edits on an external update', async () => {
    const p = props(); const { rerender } = render(<CoverageReviewPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Exported draft');
    fireEvent.change(screen.getByRole('textbox', { name: 'Review notes' }), { target: { value: 'Unsaved note' } });
    rerender(<CoverageReviewPanel {...p} reviewBundle={{ ...p.reviewBundle, review: { status: 'draft', version: 2, notes: 'External note' } }} />);
    expect(screen.getByRole('textbox', { name: 'Review notes' })).toHaveValue('Unsaved note');
    expect(screen.getByRole('alert')).toHaveTextContent('changed while you were editing');
  });
});

describe('report workspace integration', () => {
  function reportProps() {
    return { state: { datasets: [dataset], analyses: [analysis, { ...analysis, id: 'older-report', reportPresetName: 'Older report' }] }, selectedDatasetId: dataset.id, onReadAnalysis: vi.fn(async () => ({ markdown: '# Report text' })), onReadResearchReview: vi.fn(async (id) => ({ ...bundle(), analysis: { ...analysis, id } })), onSaveResearchReview: vi.fn(), onExportResearchReview: vi.fn(), onNavigate: vi.fn(), onAnalyze: vi.fn() };
  }
  it('loads the requested report only within the selected dataset and keeps report output visible if review fails', async () => {
    const p = reportProps(); p.onReadResearchReview.mockRejectedValue(new Error('Evidence missing'));
    render(<ReportsView {...p} initialAnalysisId="older-report" />);
    expect(await screen.findByRole('heading', { name: 'Report text' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Coverage review unavailable: Evidence missing');
    expect(p.onReadResearchReview).toHaveBeenLastCalledWith('older-report');
    expect(screen.getByRole('button', { name: 'Reload coverage' })).toBeEnabled();
  });

  it('uses a library preset without selecting a report from another dataset', async () => {
    const p = reportProps(); p.state.analyses.push({ ...analysis, id: 'foreign-report', datasetId: 'dataset-b' });
    render(<ReportsView {...p} initialAnalysisId="foreign-report" initialReportPresetId="competitor-positioning" />);
    await screen.findByText('Ready to use this research?');
    expect(p.onReadResearchReview).toHaveBeenLastCalledWith('analysis-a');
    expect(screen.getByRole('combobox', { name: 'What do you want to learn?' })).toHaveValue('competitor-positioning');
  });

  it('takes the empty dataset explorer to imports', () => {
    const onNavigate = vi.fn();
    render(<DatasetsView state={{ datasets: [] }} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import data' }));
    expect(onNavigate).toHaveBeenCalledWith('imports');
  });
});

describe('review fingerprint changes', () => {
  it('clears every approval check when evidence changes without a review version change', async () => {
    const p = props(); const { rerender } = render(<CoverageReviewPanel {...p} />);
    completeChecks();
    fireEvent.change(screen.getByRole('textbox', { name: 'Review notes' }), { target: { value: 'Keep this note' } });
    expect(screen.getByRole('button', { name: 'Approve locally' })).toBeEnabled();
    rerender(<CoverageReviewPanel {...p} reviewBundle={{ ...p.reviewBundle, fingerprint: 'new-evidence-fingerprint' }} />);
    expect(screen.getByRole('checkbox', { name: /I checked the report/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /I accept the listed limits/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'One requested page has no match.' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Approve locally' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Review notes' })).toHaveValue('Keep this note');
    expect(screen.getByRole('alert')).toHaveTextContent('report or evidence changed');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved.');
    expect(p.onSaveReview).toHaveBeenLastCalledWith(expect.objectContaining({ expectedFingerprint: 'new-evidence-fingerprint', evidenceChecked: false, limitationsAccepted: false, acknowledgedWarnings: [], notes: 'Keep this note' }));
  });
});
