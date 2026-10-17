import { describe, expect, it, vi } from 'vitest';
import { copyForGoogleDocs, docHtml, markdownToHtml, outlineOf, slackSummary, slideOutline } from '../src/renderer/src/report-handoff.js';

const REPORT = `# AI Overviews eat clicks

Clicks fell for informational queries. Teams want proof.

## What changed

- CTR fell 34% ([study](https://example.com/study))
- **Brands** cited in answers gained

## What to do next

Track citations weekly. Report the gap to leadership.`;

describe('report handoff', () => {
  it('turns the Markdown into safe HTML a Google Doc keeps', () => {
    const html = markdownToHtml(`${REPORT}\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1)) | a |\n\n| Platform | Posts |\n| --- | --- |\n| X | 180 |`);
    expect(html).toContain('<h1>AI Overviews eat clicks</h1>');
    expect(html).toContain('<li>CTR fell 34% (<a href="https://example.com/study">study</a>)</li>');
    expect(html).toContain('<li><strong>Brands</strong> cited in answers gained</li>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<table><thead><tr><th>Platform</th><th>Posts</th></tr></thead><tbody><tr><td>X</td><td>180</td></tr></tbody></table>');
    expect(docHtml('Body only.', 'My report')).toBe('<meta charset="utf-8"><div><h1>My report</h1>\n<p>Body only.</p></div>');
  });

  it('copies rich text when the browser allows it, and plain text otherwise', async () => {
    class Item { constructor(parts) { this.parts = parts; } }
    const rich = { write: vi.fn(async () => {}), writeText: vi.fn(async () => {}) };
    expect(await copyForGoogleDocs(REPORT, 'AI Overviews', { clipboard: rich, Item })).toEqual({ ok: true, rich: true });
    expect(Object.keys(rich.write.mock.calls[0][0][0].parts)).toEqual(['text/html', 'text/plain']);
    const plain = { write: vi.fn(async () => { throw new Error('denied'); }), writeText: vi.fn(async () => {}) };
    // jsdom has no rich copy command, so the plain Markdown goes on the clipboard instead.
    const result = await copyForGoogleDocs(REPORT, '', { clipboard: plain, Item });
    expect(result.ok).toBe(true);
    expect(plain.writeText).toHaveBeenCalledWith(REPORT);
  });

  it('outlines the report as slides and a Slack summary', () => {
    expect(outlineOf(REPORT)).toEqual({ title: 'AI Overviews eat clicks', summary: 'Clicks fell for informational queries. Teams want proof.', sections: [{ heading: 'What changed', points: ['CTR fell 34% (study)', 'Brands cited in answers gained'] }, { heading: 'What to do next', points: ['Track citations weekly.', 'Report the gap to leadership.'] }] });
    expect(slideOutline(REPORT)).toBe('Slide 1 (title): AI Overviews eat clicks\nClicks fell for informational queries. Teams want proof.\n\nSlide 2: What changed\n- CTR fell 34% (study)\n- Brands cited in answers gained\n\nSlide 3: What to do next\n- Track citations weekly.\n- Report the gap to leadership.\n');
    expect(slackSummary(REPORT, { link: 'https://studio.example.com/#/report/asset-1' })).toBe('*AI Overviews eat clicks*\nClicks fell for informational queries. Teams want proof.\n• What changed: CTR fell 34% (study)\n• What to do next: Track citations weekly.\nOpen in the studio: https://studio.example.com/#/report/asset-1');
  });
});
