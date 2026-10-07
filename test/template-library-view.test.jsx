// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplateLibraryView } from '../src/renderer/src/template-library-view.jsx';
import { HomeView } from '../src/renderer/src/home-view.jsx';

afterEach(cleanup);
describe('outcome-based playbook library', () => {
  it('offers eight evidence-scoped playbooks with outcome and input search', () => {
    render(<TemplateLibraryView state={{}} onChooseTemplate={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getAllByRole('article')).toHaveLength(8);
    expect(screen.getByText(/Page-only collections cannot establish/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search playbooks' }), { target: { value: 'support export' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Voice of customer brief' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search playbooks' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Competitive', exact: true }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'ABM account research' })).not.toBeInTheDocument();
  });

  it('hands off the matching playbook and keeps imports and explicit-page collection reachable', () => {
    const onChooseTemplate = vi.fn(), onNavigate = vi.fn();
    render(<TemplateLibraryView state={{ datasets: [{ id: 'dataset-1' }] }} onChooseTemplate={onChooseTemplate} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose a dataset: Voice of customer brief' }));
    expect(onChooseTemplate).toHaveBeenCalledWith('voice-of-customer');
    fireEvent.click(screen.getByRole('button', { name: 'Compare snapshots: Weekly competitor changes' }));
    expect(onChooseTemplate).toHaveBeenCalledWith('weekly-competitor-changes');
    const card = screen.getByRole('heading', { name: 'Content and SERP opportunities' }).closest('article');
    fireEvent.click(within(card).getByRole('button', { name: 'Import data' }));
    expect(onNavigate).toHaveBeenCalledWith('imports', { templateId: 'content-opportunity', reportPresetId: 'content-opportunity' });
    fireEvent.click(within(card).getByRole('button', { name: 'Collect page URLs' }));
    expect(onNavigate).toHaveBeenCalledWith('marketing-template', { templateId: 'content-opportunity' });
  });

  it('shows the saved workspace context without automatically applying it', () => {
    const onNavigate = vi.fn(), onChooseTemplate = vi.fn();
    render(<TemplateLibraryView state={{ brandProfiles: [{ id: 'brand-1', name: 'Acme' }], settings: { selectedBrandProfileId: 'brand-1' } }} onChooseTemplate={onChooseTemplate} onNavigate={onNavigate} />);
    expect(screen.getByText('Workspace context: Acme')).toBeInTheDocument();
    expect(onChooseTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Manage context' }));
    expect(onNavigate).toHaveBeenCalledWith('brands');
  });
});

describe('home follow-up work', () => {
  const state = { datasets: [], recipes: [], analyses: [{ id: 'report-1', datasetId: 'dataset-1', kind: 'report', status: 'succeeded' }], settings: {} };
  it('links to the full library and shows only genuine open actions and due manual source checks', () => {
    const onNavigate = vi.fn();
    render(<HomeView state={{ ...state, researchReviews: [{ analysisId: 'report-1', actions: [{ id: 'open', title: 'Update the launch claim', status: 'todo', owner: 'Jordan', dueDate: '2026-09-29' }, { id: 'done', title: 'Finished action', status: 'done' }, { id: 'dismissed', title: 'Dismissed action', status: 'dismissed' }] }], monitors: [{ id: 'due', name: 'Pricing page check', nextCheckAt: '2020-01-01T00:00:00Z' }, { id: 'future', name: 'Future check', nextCheckAt: '2100-01-01T00:00:00Z' }] }} onNavigate={onNavigate} />);
    expect(screen.getByText('1 open action · 1 source check due')).toBeInTheDocument();
    expect(screen.queryByText('Finished action')).not.toBeInTheDocument();
    expect(screen.queryByText('Dismissed action')).not.toBeInTheDocument();
    expect(screen.queryByText('Future check')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Update the launch claim/ }));
    expect(onNavigate).toHaveBeenCalledWith('reports', { analysisId: 'report-1', datasetId: 'dataset-1' });
    fireEvent.click(screen.getByRole('button', { name: /Pricing page check/ }));
    expect(onNavigate).toHaveBeenCalledWith('compare');
    fireEvent.click(screen.getByRole('button', { name: /Explore all 8 playbooks/ }));
    expect(onNavigate).toHaveBeenCalledWith('templates');
  });
  it('does not manufacture follow-up work for a new workspace', () => {
    render(<HomeView state={state} onNavigate={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Keep the research moving.' })).not.toBeInTheDocument();
  });
});
