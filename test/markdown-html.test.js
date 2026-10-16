import { describe, expect, it } from 'vitest';
import converter from '../src/main/markdown-html.js';
import content from '../src/shared/content-studio.js';
const { markdownToHtml, splitTitle } = converter;

// Reports edited in the studio become pages through this converter. It renders what marketers write and escapes the rest.
describe('Markdown for edited reports', () => {
  it('renders headings, paragraphs, lists, emphasis, code, quotes and rules', () => {
    expect(markdownToHtml('## Why it matters\n\nLine one\nline two with **bold**, *italic* and `code <b>`.\n\n> A quote\n\n---\n\n```\nconst a = 1 < 2;\n```')).toBe(
      '<h2>Why it matters</h2><p>Line one<br>line two with <strong>bold</strong>, <em>italic</em> and <code>code &lt;b&gt;</code>.</p><blockquote><p>A quote</p></blockquote><hr><pre><code>const a = 1 &lt; 2;</code></pre>');
    expect(markdownToHtml('1. **Label** — text\n   Sources: [1]\n2. Second\n\n3. Third\n\n- a\n  - nested\n- b')).toBe(
      '<ol><li><strong>Label</strong> — text<br>Sources: [1]</li><li>Second</li><li>Third</li></ol><ul><li><p>a</p><ul><li>nested</li></ul></li><li>b</li></ul>');
    expect(markdownToHtml('3. Starts at three')).toBe('<ol start="3"><li>Starts at three</li></ol>');
    expect(markdownToHtml('snake_case_names and 2 * 3 * 4 stay as written')).toBe('<p>snake_case_names and 2 * 3 * 4 stay as written</p>');
  });

  it('keeps http:// addresses as plain text, because Google Drive delivery takes https links only', () => {
    expect(markdownToHtml('[Old study](http://example.com/a) and http://semrush.com/blog/x and <http://example.org>')).toBe(
      '<p>Old study (http://example.com/a) and http://semrush.com/blog/x and http://example.org</p>');
    expect(markdownToHtml('[Old](http://user:pass@example.com) [Key](http://example.com/?token=abc)')).toBe('<p>Old Key</p>');
    expect(markdownToHtml('[New](https://example.com/a)')).toBe('<p><a href="https://example.com/a">New</a></p>');
  });

  it('links only https addresses without credentials, and escapes everything else', () => {
    expect(markdownToHtml('[Study](https://example.com/a?b=1) and https://semrush.com/blog/x. and <https://example.org>')).toBe(
      '<p><a href="https://example.com/a?b=1">Study</a> and <a href="https://semrush.com/blog/x">https://semrush.com/blog/x</a>. and <a href="https://example.org/">https://example.org</a></p>');
    for (const unsafe of ['[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](https://user:pass@example.com)', '[x](https://example.com/?token=abc)']) expect(markdownToHtml(unsafe)).not.toContain('<a ');
    const html = markdownToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> "quotes" & \'apostrophes\'');
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt; &quot;quotes&quot; &amp; &#39;apostrophes&#39;</p>');
  });

  it('takes a leading heading as the page title and wraps the body in the edition’s page', () => {
    expect(splitTitle('\n# Measurement **first**\n\nBody')).toEqual({ title: 'Measurement first', body: '\nBody' });
    expect(splitTitle('## Not a title\n\nBody')).toEqual({ title: '', body: '## Not a title\n\nBody' });
    const page = content.wrapHtml('A & B', markdownToHtml('Body'), 'semrush');
    expect(page).toMatch(/^<!doctype html><html lang="en"><head><meta charset="utf-8">.*<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>A &amp; B<\/title>/s);
    expect(page).toContain('<header><small>Editorial draft · Review before publishing</small><h1>A &amp; B</h1></header><main class="doc"><p>Body</p></main></body></html>');
    // The same edition colours as the generated drafts.
    const generated = content.renderContentExport({ title: 'T', summary: '', sections: [], caveats: [], editionId: 'semrush' }, { format: 'html' });
    expect(page.match(/body\{[^}]+\}/)[0]).toBe(generated.match(/body\{[^}]+\}/)[0]);
  });
});
