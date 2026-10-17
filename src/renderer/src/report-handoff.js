// Handing a report to the tools a marketing team lives in: a Google Doc (rich text on the clipboard), a slide outline
// and a Slack summary. Pure helpers plus one clipboard call; no network and no AI. The Markdown is the studio's own
// (written reports and edits), and every piece of it is escaped on the way into HTML.

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeUrl = (value) => { const url = String(value || '').trim(); return /^(https?:\/\/|mailto:)/i.test(url) && !/[\s"'<>]/.test(url) ? url : ''; };
// Inline Markdown: code, links, bold, italics. Code spans are cut out first so their contents stay literal.
function inline(text) {
  const codes = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => { codes.push(code); return `\u0000${codes.length - 1}\u0000`; });
  // Pictures keep their description; a Google Doc can't load the studio's own image files.
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt) => (alt ? `[${alt}]` : ''));
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => { const href = safeUrl(url.replace(/&amp;/g, '&')); return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label; });
  html = html.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
}
// Markdown with its formatting taken out, for plain text, slides and Slack.
export function plainInline(text) {
  return String(text || '').replace(/`([^`]+)`/g, '$1').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1').replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => a || b).replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2').replace(/(^|[^_\w])_([^_\n]+)_/g, '$1$2').trim();
}
const tableCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

// Markdown → HTML for a Google Doc paste: headings, paragraphs, lists, quotes, rules, fenced code and simple tables.
export function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const out = []; let paragraph = []; let listType = ''; let index = 0;
  const flush = () => { if (paragraph.length) { out.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; } };
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = ''; } };
  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^\s*```/);
    if (fence) {
      flush(); closeList(); const code = []; index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) { code.push(lines[index]); index += 1; }
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); index += 1; continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { flush(); closeList(); out.push(`<h${heading[1].length}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${heading[1].length}>`); index += 1; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); closeList(); out.push('<hr>'); index += 1; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[index + 1] || '')) {
      flush(); closeList();
      const head = tableCells(line); index += 2; const rows = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) { rows.push(tableCells(lines[index])); index += 1; }
      out.push(`<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/); const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flush(); const type = bullet ? 'ul' : 'ol';
      if (listType !== type) { closeList(); out.push(`<${type}>`); listType = type; }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`); index += 1; continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { flush(); closeList(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`); index += 1; continue; }
    if (!line.trim()) { flush(); closeList(); index += 1; continue; }
    closeList(); paragraph.push(line.trim()); index += 1;
  }
  flush(); closeList();
  return out.join('\n');
}

// The report as one HTML document, titled, the way a Google Doc keeps it.
export function docHtml(markdown, title = '') {
  const body = markdownToHtml(markdown);
  const titled = title && !/^\s*#\s/.test(String(markdown || '')) ? `<h1>${escapeHtml(title)}</h1>\n${body}` : body;
  return `<meta charset="utf-8"><div>${titled}</div>`;
}

// Copies with formatting (text/html plus text/plain) so a paste into Google Docs keeps headings, lists and links.
// Falls back to the plain Markdown when the browser refuses rich clipboard writes. → { ok, rich }
export async function copyForGoogleDocs(markdown, title = '', { clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null, Item = typeof ClipboardItem !== 'undefined' ? ClipboardItem : null } = {}) {
  const html = docHtml(markdown, title); const text = String(markdown || '');
  if (clipboard?.write && Item) {
    try { await clipboard.write([new Item({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); return { ok: true, rich: true }; } catch { /* plain text below */ }
  }
  // An older Electron or a refused permission: select a rendered copy so the system clipboard still gets formatting.
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    const active = document.activeElement; const holder = document.createElement('div');
    try {
      holder.contentEditable = 'true'; holder.style.position = 'fixed'; holder.style.opacity = '0'; holder.style.pointerEvents = 'none'; holder.innerHTML = html;
      document.body.appendChild(holder); const range = document.createRange(); range.selectNodeContents(holder);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      const done = document.execCommand('copy'); selection?.removeAllRanges(); holder.remove(); active?.focus?.({ preventScroll: true });
      if (done) return { ok: true, rich: true };
    } catch { holder.remove(); active?.focus?.({ preventScroll: true }); }
  }
  if (clipboard?.writeText) { try { await clipboard.writeText(text); return { ok: true, rich: false }; } catch { /* nothing more to try */ } }
  return { ok: false, rich: false };
}

// The report's outline: its title, opening paragraph and each section (H2) with its points.
export function outlineOf(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const doc = { title: '', summary: '', sections: [] }; let section = null; let paragraph = []; let inCode = false;
  const sentences = (text) => plainInline(text).split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/).map((part) => part.trim()).filter(Boolean);
  const endParagraph = () => {
    if (!paragraph.length) return; const text = paragraph.join(' '); paragraph = [];
    if (section) { if (section.points.length < 5) section.paragraphs.push(...sentences(text)); }
    else if (!doc.summary) doc.summary = sentences(text).slice(0, 2).join(' ');
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      endParagraph(); const text = plainInline(heading[2]);
      if (heading[1].length === 1 && !doc.title) doc.title = text;
      else if (heading[1].length <= 2) { section = { heading: text, points: [], paragraphs: [] }; doc.sections.push(section); }
      else if (section && section.points.length < 5) section.points.push(text);
      continue;
    }
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) { endParagraph(); if (section) section.points.push(plainInline(item[1])); else if (!doc.summary) doc.summary = plainInline(item[1]); continue; }
    if (!line.trim()) { endParagraph(); continue; }
    if (!/^\s*\|/.test(line) && !/^\s*>/.test(line) && plainInline(line)) paragraph.push(line.trim());
  }
  endParagraph();
  for (const entry of doc.sections) { entry.points = [...entry.points, ...entry.paragraphs].slice(0, 5).map((point) => (point.length > 160 ? `${point.slice(0, 157).trim()}…` : point)); delete entry.paragraphs; }
  return doc;
}

// "Copy as slide outline": the H1 is the title slide, each H2 a slide with up to five bullets.
export function slideOutline(markdown, title = '') {
  const doc = outlineOf(markdown); const name = doc.title || title || 'Untitled report';
  const slides = [`Slide 1 (title): ${name}${doc.summary ? `\n${doc.summary}` : ''}`];
  doc.sections.forEach((section, index) => slides.push([`Slide ${index + 2}: ${section.heading}`, ...section.points.map((point) => `- ${point}`)].join('\n')));
  return `${slides.join('\n\n')}\n`;
}

// Five bullets for Slack (its own Markdown: *bold*, • bullets), with the link when there is one.
export function slackSummary(markdown, { title = '', link = '' } = {}) {
  const doc = outlineOf(markdown); const name = doc.title || title || 'Report';
  const bullets = doc.sections.map((section) => (section.points[0] ? `${section.heading}: ${section.points[0]}` : section.heading)).filter(Boolean).slice(0, 5);
  return [`*${name.replace(/\*/g, '')}*`, doc.summary, ...bullets.map((line) => `• ${line}`), link ? `Open in the studio: ${link}` : ''].filter(Boolean).join('\n');
}
