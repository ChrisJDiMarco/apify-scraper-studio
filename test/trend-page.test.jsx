// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TrendPage, docOf, tabBlocked, tabOfDoc } from '../src/renderer/src/trend-page.jsx';
import { stageOf } from '../src/renderer/src/trend-stage.js';
import { hashForRoute, parseHash, parseRoute } from '../src/renderer/src/deep-links.js';

afterEach(cleanup);
const yes = () => true;
const base = { key: 'run:t', runId: 'run', themeId: 't', name: 'Zero click search', description: 'Fewer clicks reach publishers.', evidenceCount: 12, platforms: ['x', 'linkedin'], priorityTier: 'STRONG', programName: 'AI search pulse', discoveredAt: '2026-10-14T10:00:00.000Z', keywords: ['zero click'], detectionCount: 3 };
const waiting = { ...base, stage: 'potential', decision: 'pending', canDecide: true };
const ready = { ...base, stage: 'ready', decision: 'approved', canDecide: false, assetCount: 0, reportAssets: [{ id: 'a-kit', title: 'Toolkit', deliverableId: 'editorial-toolkit' }, { id: 'a-report', title: 'Report', deliverableId: 'evidence-report' }] };
const page = (card, props = {}) => render(<TrendPage card={card} stage={stageOf(card, { can: yes })} renderDoc={(id) => <p>Document {id}</p>} renderAssets={(id) => <p>Assets of {id}</p>} {...props} />);

describe('TrendPage', () => {
  it('shows a waiting trend with its stage, Approve and Skip, and no documents yet', () => {
    const onSkip = vi.fn();
    page(waiting, { yes: <button type="button">Yes, use it</button>, onSkip });
    expect(screen.getByRole('heading', { level: 1, name: 'Zero click search' })).toBeInTheDocument();
    expect(screen.getByText('Needs your OK')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, use it' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip Zero click search' }));
    expect(onSkip).toHaveBeenCalled();
    for (const name of ['Trends report', 'Editorial toolkit', 'Channel assets']) expect(screen.getByRole('tab', { name })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Trends report' })).toHaveAttribute('title', 'Reports are written after a trend is approved.');
    expect(screen.getByText('Fewer clicks reach publishers.')).toBeInTheDocument();
    expect(screen.getByText('3 research runs')).toBeInTheDocument();
  });
  it('offers the one next step for a trend whose report is ready', () => {
    const onNext = vi.fn();
    page(ready, { onNext });
    expect(screen.getByText('Report ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make channel assets' }));
    expect(onNext).toHaveBeenCalledWith({ id: 'make-assets', assetId: 'a-report', label: 'Make channel assets' });
    expect(screen.queryByRole('button', { name: /^Skip/ })).toBeNull();
  });
  it('reads the report, the toolkit and the assets on their tabs', () => {
    const onTab = vi.fn();
    const { rerender } = page(ready, { onTab, tab: 'report' });
    expect(screen.getByText('Document a-report')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Editorial toolkit' }));
    expect(onTab).toHaveBeenCalledWith('toolkit');
    rerender(<TrendPage card={ready} stage={stageOf(ready, { can: yes })} tab="toolkit" renderDoc={(id) => <p>Document {id}</p>} />);
    expect(screen.getByText('Document a-kit')).toBeInTheDocument();
    rerender(<TrendPage card={ready} stage={stageOf(ready, { can: yes })} tab="assets" renderAssets={(id) => <p>Assets of {id}</p>} />);
    expect(screen.getByText('Assets of a-report')).toBeInTheDocument();
  });
  it('falls back to the overview when the tab asked for has nothing yet', () => {
    page(waiting, { tab: 'report' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(/^Document a-/)).toBeNull();
  });
  it('lets a recurring trend switch research runs', () => {
    const onRun = vi.fn();
    page(ready, { runs: [ready, { ...waiting, runId: 'newer', discoveredAt: '2026-10-21T10:00:00.000Z' }], onRun });
    fireEvent.change(screen.getByRole('combobox', { name: 'Research run' }), { target: { value: 'newer' } });
    expect(onRun).toHaveBeenCalledWith('newer');
  });
  it('lists the channels using it', () => {
    page(ready, { uses: [{ channelId: 'blog', name: 'Semrush Blog', link: 'https://example.com/post' }, { channelId: 'social', name: 'Social', link: '' }] });
    expect(screen.getByText('Semrush Blog')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open link/ })).toHaveAttribute('href', 'https://example.com/post');
    expect(screen.getByText('No link yet')).toBeInTheDocument();
  });
});

describe('trend page helpers', () => {
  it('maps documents to tabs and back', () => {
    expect(docOf(ready, 'report').id).toBe('a-report');
    expect(docOf(ready, 'toolkit').id).toBe('a-kit');
    expect(tabOfDoc({ deliverableId: 'editorial-toolkit' })).toBe('toolkit');
    expect(tabOfDoc({ deliverableId: 'evidence-report' })).toBe('report');
  });
  it('says why a tab is empty', () => {
    expect(tabBlocked(ready, 'assets')).toBe('');
    expect(tabBlocked({ ...waiting, stage: 'passed' }, 'report')).toMatch(/skipped/);
    expect(tabBlocked({ ...waiting, stage: 'production' }, 'toolkit')).toMatch(/still being written/);
  });
});

describe('trend addresses', () => {
  it('reads a tab and a run from the address', () => {
    expect(parseHash('#/trend/theme-1/overview')).toEqual({ kind: 'trend', id: 'theme-1', tab: 'overview' });
    expect(parseHash('#/trend/theme-1/assets?run=research-2')).toEqual({ kind: 'trend', id: 'theme-1', tab: 'assets', run: 'research-2' });
    expect(parseRoute('#/trend/theme-1/toolkit')).toEqual({ kind: 'trend', id: 'theme-1', tab: 'toolkit' });
  });
  it('keeps the share link people already have', () => {
    expect(parseHash('#/trend/theme-1')).toEqual({ kind: 'trend', id: 'theme-1' });
  });
  it('refuses a tab it does not know', () => {
    expect(parseHash('#/trend/theme-1/settings')).toBeNull();
  });
  it('writes the address of an open trend page', () => {
    expect(hashForRoute({ kind: 'trend', id: 'theme-1', tab: 'overview' })).toBe('#/trend/theme-1/overview');
    expect(hashForRoute({ kind: 'trend', id: 'theme-1', tab: 'report', run: 'research-2' })).toBe('#/trend/theme-1/report?run=research-2');
    expect(hashForRoute({ kind: 'trend', id: 'theme-1' })).toBe('#/trend/theme-1');
  });
});
