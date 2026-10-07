// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownContent } from '../src/renderer/src/markdown-content.jsx';
import { ReportsView } from '../src/renderer/src/dataset-report-views.jsx';

afterEach(() => { cleanup(); delete window.apifyStudio; });

describe('safe formatted Markdown', () => {
  it('renders headings, emphasis, lists, code and GFM tables as readable elements', () => {
    const { container } = render(<MarkdownContent>{'## Findings\n\n**Clear reporting** matters.\n\n- First action\n- Second action\n\n`sample code`\n\n| Source | Theme |\n| --- | --- |\n| Public page | Reporting |'}</MarkdownContent>);
    expect(screen.getByRole('heading', { name: 'Findings', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Clear reporting').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toHaveTextContent('Public page');
    expect(container.querySelector('code')).toHaveTextContent('sample code');
    expect(container.textContent).not.toContain('**');
  });

  it('does not render raw HTML, remote images, or executable/private links', () => {
    const { container } = render(<MarkdownContent>{'<script>alert(1)</script>\n\n<img src="https://tracking.example/pixel">\n\n![Tracking pixel](https://tracking.example/image.png)\n\n[Unsafe](javascript:alert%281%29) [Private file](file:///tmp/private) [Credentials](https://user:secret@example.com) [Relative](/settings)\n\nSafe words.'}</MarkdownContent>);
    expect(container.querySelector('script, img, iframe')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Safe words.')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('tracking.example');
  });

  it('routes safe links through the desktop bridge and preserves a safe href for ordinary browsers', async () => {
    window.apifyStudio = { openSourceUrl: vi.fn().mockResolvedValue(undefined) };
    render(<MarkdownContent>{'[Read the source](https://example.com/evidence)'}</MarkdownContent>);
    const link = screen.getByRole('link', { name: 'Read the source' });
    expect(link).toHaveAttribute('href', 'https://example.com/evidence');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => link.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(window.apifyStudio.openSourceUrl).toHaveBeenCalledWith('https://example.com/evidence');
  });

  it('shows link failures without losing content and can retry', async () => {
    const open = vi.fn().mockRejectedValueOnce(new Error('Browser unavailable')).mockResolvedValueOnce(undefined);
    render(<MarkdownContent onOpenSourceUrl={open}>{'[Source](https://example.com)'}</MarkdownContent>);
    await act(async () => fireEvent.click(screen.getByRole('link')));
    expect(screen.getByRole('alert')).toHaveTextContent('Browser unavailable');
    await act(async () => fireEvent.click(screen.getByRole('link')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('report Markdown integration', () => {
  it('formats saved report content rather than showing raw Markdown syntax', async () => {
    const state = { datasets: [{ id: 'd1', name: 'Evidence', itemCount: 2 }], analyses: [{ id: 'a1', datasetId: 'd1', kind: 'report', status: 'succeeded', reportPath: '/tmp/report.md' }], settings: {} };
    const read = vi.fn().mockResolvedValue({ markdown: '## Report finding\n\n**Reporting** is the theme.\n\n| Source | Count |\n| --- | --- |\n| Web | 2 |' });
    await act(async () => render(<ReportsView state={state} selectedDatasetId="d1" onReadAnalysis={read} />));
    expect(screen.getByRole('heading', { name: 'Report finding', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Web');
    expect(screen.getByText('Reporting').tagName).toBe('STRONG');
  });
});

describe('validated chat source allowlist', () => {
  it('keeps invented answer URLs inert when validated source links are supplied', () => {
    render(<MarkdownContent allowedSourceUrls={['https://example.com/evidence']}>{'[Known source](https://example.com/evidence) and [Invented source](https://invented.example/report)'}</MarkdownContent>);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveTextContent('Known source');
    expect(screen.getByText('Invented source').tagName).toBe('SPAN');
  });
});
