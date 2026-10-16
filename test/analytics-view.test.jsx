// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsView, analyticsCsv, cellLabel, csvCell, csvFileName, reminderText } from '../src/renderer/src/analytics-view.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const thisMonth = new Date().toISOString().slice(0, 7);
const ready = `${thisMonth}-02T10:00:00.000Z`;
const channels = [
  { id: 'blog', name: 'Semrush Blog', short: 'Blog', owners: [{ id: 'm-alex', name: 'Alex' }], ownerSince: '2026-08-01T00:00:00.000Z' },
  { id: 'social', name: 'Semrush Social Team', short: 'Social', owners: [], ownerSince: null },
];
const data = (over = {}) => ({
  generatedAt: '2026-10-16T12:00:00.000Z', days: 90, workspace: { id: 'semrush', name: 'Semrush' }, channels,
  totals: { trendsFound: 20, approved: 14, passed: 4, pending: 2, briefsReady: 14, inUse: 6, linksAdded: 4, assetsGenerated: 31 },
  trends: [
    { themeId: 't-1', name: 'AI Overviews', firstDetectedAt: ready, readyAt: ready, decision: 'approved', decidedBy: { name: 'Riley', at: ready }, ready: true, priority: 'top', cells: { blog: { status: 'using', link: 'https://semrush.com/blog/ai', byName: 'Alex', at: '2026-10-12T10:00:00.000Z', assetCount: 2, offered: true }, social: { status: 'none', link: '', byName: '', at: '', assetCount: 0, offered: false } } },
    { themeId: 't-2', name: '=SUM(Zero-click)', firstDetectedAt: ready, readyAt: ready, decision: 'approved', decidedBy: null, ready: true, priority: null, cells: { blog: { status: 'generated', link: '', byName: '', at: '', assetCount: 1, offered: true }, social: { status: 'none', link: '', byName: '', at: '', assetCount: 0, offered: false } } },
    { themeId: 't-3', name: 'Old trend', firstDetectedAt: '2026-07-02T10:00:00.000Z', readyAt: '2026-07-04T10:00:00.000Z', decision: 'approved', decidedBy: { name: 'Jordan', at: '2026-07-03T10:00:00.000Z' }, ready: true, priority: 'watch', cells: { blog: { status: 'not-using', link: '', byName: 'Alex', at: '2026-07-10T10:00:00.000Z', assetCount: 0, offered: true }, social: { status: 'none', link: '', byName: '', at: '', assetCount: 0, offered: false } } },
  ],
  byChannel: [
    { id: 'blog', name: 'Semrush Blog', short: 'Blog', owners: [{ id: 'm-alex', name: 'Alex' }], offered: 14, using: 6, notUsing: 3, generatedOnly: 2, noAnswer: 3, assets: 9, lastActivityAt: '2026-10-12T10:00:00.000Z' },
    { id: 'social', name: 'Semrush Social Team', short: 'Social', owners: [], offered: 0, using: 0, notUsing: 0, generatedOnly: 0, noAnswer: null, assets: 0, lastActivityAt: '' },
  ],
  recent: [{ at: '2026-10-12T10:00:00.000Z', byName: 'Alex', kind: 'adoption', text: 'Alex marked “AI Overviews” as used for Semrush Blog' }],
  ...over,
});
const api = (over = {}) => ({ getTrendAnalytics: vi.fn(async () => data()), setTrendAdoption: vi.fn(async () => ({ adoption: null })), openSourceUrl: vi.fn(async () => ({})), ...over });
const admin = { id: 'local', name: 'Chris', role: 'admin', realRole: 'admin', preview: false };

describe('AnalyticsView', () => {
  it('loads the last 90 days and shows the funnel from found to linked', async () => {
    const services = api();
    render(<AnalyticsView api={services} viewer={admin} />);
    expect(screen.getByRole('status', { name: 'Loading analytics' })).toBeInTheDocument();
    const funnel = await screen.findByRole('list', { name: 'From trend to use' });
    expect(services.getTrendAnalytics).toHaveBeenCalledWith({ days: 90, includeAll: false });
    const tiles = within(funnel).getAllByRole('listitem').map((tile) => tile.textContent);
    expect(tiles[0]).toMatch(/^20Trends found/);
    expect(tiles[1]).toMatch(/14Approved4 passed · 2 not decided/);
    expect(tiles[2]).toMatch(/14Briefs ready/);
    expect(tiles[3]).toMatch(/6 of 14In use by a channel43% of ready briefs/);
    expect(tiles[4]).toMatch(/4Links added/);
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(services.getTrendAnalytics).toHaveBeenLastCalledWith({ days: 30, includeAll: false }));
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lists every channel with owners, a labelled stacked bar and a reminder to copy', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<AnalyticsView api={api()} viewer={admin} web />);
    const [table] = await screen.findAllByRole('table');
    const blog = within(table).getByRole('row', { name: /Semrush Blog/ });
    expect(within(blog).getByText('Alex')).toBeInTheDocument();
    expect(within(blog).getByRole('img', { name: 'Using 6, Drafts made 2, Not for us 3, No answer 3' })).toBeInTheDocument();
    expect(within(blog).getByText('6 of 14 used')).toBeInTheDocument();
    const social = within(table).getByRole('row', { name: /Semrush Social Team/ });
    expect(within(social).getByText('No owner yet')).toBeInTheDocument();
    expect(within(social).getByRole('button', { name: /Copy reminder/ })).toBeDisabled();
    fireEvent.click(within(blog).getByRole('button', { name: 'Copy reminder for Semrush Blog' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`1 trend is waiting for Semrush Blog: “=SUM(Zero-click)”. ${location.origin}`));
    expect(await screen.findByText('Reminder for Semrush Blog copied. Paste it into Slack or an email.')).toBeInTheDocument();
  });

  it('makes the matrix a real table: headers with full names, rows by month, and cells that say what they mean', async () => {
    render(<AnalyticsView api={api()} viewer={admin} />);
    const region = await screen.findByRole('region', { name: 'Trends × channels' });
    const matrix = within(region).getByRole('table');
    expect(within(matrix).getByRole('columnheader', { name: 'Semrush Blog' })).toHaveAttribute('title', 'Semrush Blog');
    expect(within(matrix).getByRole('columnheader', { name: 'Semrush Social Team' })).toHaveTextContent('Social');
    expect(within(matrix).getByRole('rowheader', { name: /AI Overviews/ })).toHaveTextContent(`by Riley · ${day(ready)}`);
    expect(within(matrix).getByRole('rowheader', { name: /=SUM/ })).toHaveTextContent('Decided by: Not recorded');
    expect(within(matrix).getByRole('button', { name: `Semrush Blog: using, link added, by Alex, ${day('2026-10-12T10:00:00.000Z')}` })).toBeInTheDocument();
    expect(within(matrix).getByRole('button', { name: 'Semrush Blog: drafts made, no answer yet' })).toBeInTheDocument();
    expect(within(matrix).getAllByRole('button', { name: 'Semrush Social Team: no owner yet' })).toHaveLength(2);
    // Older months stay collapsed until asked for.
    expect(within(matrix).queryByRole('rowheader', { name: /Old trend/ })).not.toBeInTheDocument();
    fireEvent.click(within(matrix).getByRole('button', { name: /July 2026/ }));
    expect(within(matrix).getByRole('rowheader', { name: /Old trend/ })).toBeInTheDocument();
  });

  it('opens a cell’s detail on click, and lets an admin change the answer for that channel', async () => {
    const services = api();
    render(<AnalyticsView api={services} viewer={admin} />);
    const cell = await screen.findByRole('button', { name: /^Semrush Blog: using, link added/ });
    fireEvent.click(cell);
    const popover = screen.getByRole('dialog', { name: 'AI Overviews' });
    expect(cell).toHaveAttribute('aria-expanded', 'true');
    expect(within(popover).getByText(`Answered by Alex · ${day('2026-10-12T10:00:00.000Z')}`)).toBeInTheDocument();
    fireEvent.click(within(popover).getByRole('button', { name: /semrush\.com\/blog\/ai/ }));
    expect(services.openSourceUrl).toHaveBeenCalledWith('https://semrush.com/blog/ai');
    fireEvent.click(within(popover).getByRole('radio', { name: 'Not for us' }));
    fireEvent.click(within(popover).getByRole('button', { name: 'Save answer' }));
    await waitFor(() => expect(services.setTrendAdoption).toHaveBeenCalledWith({ themeId: 't-1', channelId: 'blog', status: 'not-using', link: '', note: '' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(cell).toHaveFocus();
    await waitFor(() => expect(services.getTrendAnalytics).toHaveBeenCalledTimes(2));
  });

  it('closes the detail on Esc and gives focus back; non-admins (and previews) can’t change answers', async () => {
    render(<AnalyticsView api={api()} viewer={{ ...admin, preview: true, role: 'editor' }} />);
    const cell = await screen.findByRole('button', { name: /^Semrush Blog: drafts made/ });
    fireEvent.click(cell);
    const popover = screen.getByRole('dialog', { name: '=SUM(Zero-click)' });
    expect(within(popover).queryByText('Change answer')).not.toBeInTheDocument();
    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cell).toHaveFocus();
  });

  it('refetches with passed and pending trends when asked', async () => {
    const services = api();
    render(<AnalyticsView api={services} viewer={admin} />);
    const chip = await screen.findByRole('button', { name: 'Show passed and pending' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    await waitFor(() => expect(services.getTrendAnalytics).toHaveBeenLastCalledWith({ days: 90, includeAll: true }));
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('says so when the range is empty, and offers a retry when loading fails', async () => {
    const empty = api({ getTrendAnalytics: vi.fn(async () => data({ trends: [] })) });
    render(<AnalyticsView api={empty} viewer={admin} />);
    expect(await screen.findByText('No trends in this range yet.')).toBeInTheDocument();
    cleanup();
    const failing = api({ getTrendAnalytics: vi.fn().mockRejectedValueOnce(new Error('Only an admin can do that.')).mockResolvedValue(data()) });
    render(<AnalyticsView api={failing} viewer={admin} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin can do that.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'From trend to use' })).toBeInTheDocument();
  });

  it('downloads a CSV named after the workspace', async () => {
    const createObjectURL = vi.fn(() => 'blob:csv'); const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<AnalyticsView api={api()} viewer={admin} />);
    fireEvent.click(await screen.findByRole('button', { name: /Download CSV/ }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(csvFileName(data())).toBe('Semrush trend analytics 2026-10-16.csv');
  });
});

describe('analytics helpers', () => {
  it('escapes CSV cells that a spreadsheet would read as formulas, and quotes commas and quotes', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tTab')).toBe("'\tTab");
    expect(csvCell('\rCR')).toBe("\"'\rCR\"");
    expect(csvCell('Alex, Pat')).toBe('"Alex, Pat"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell(null)).toBe('');
    const csv = analyticsCsv(data());
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Trend,Decision,Decided by,Decided at,Brief ready,Channel,Answer,Link,Answered by,Answered at,Drafts made,Offered to the channel');
    expect(lines).toHaveLength(1 + 3 * 2);
    expect(lines[1]).toBe(`AI Overviews,Approved,Riley,${ready},${ready},Semrush Blog,Using,https://semrush.com/blog/ai,Alex,2026-10-12T10:00:00.000Z,2,Yes`);
    expect(lines[3]).toMatch(/^'=SUM\(Zero-click\),Approved,,/);
  });

  it('labels cells in words and builds the reminder text', () => {
    expect(cellLabel(channels[0], { status: 'using', link: 'https://x.com/a', byName: 'Alex', at: '2026-10-12T10:00:00.000Z', offered: true })).toBe(`Semrush Blog: using, link added, by Alex, ${day('2026-10-12T10:00:00.000Z')}`);
    expect(cellLabel(channels[0], { status: 'none', offered: false })).toBe('Semrush Blog: from before the owner joined');
    expect(cellLabel(channels[1], { status: 'none', offered: false })).toBe('Semrush Social Team: no owner yet');
    expect(reminderText(data(), channels[0])).toBe('1 trend is waiting for Semrush Blog: “=SUM(Zero-click)”.');
    expect(reminderText(data(), channels[1])).toBe('');
  });
});
