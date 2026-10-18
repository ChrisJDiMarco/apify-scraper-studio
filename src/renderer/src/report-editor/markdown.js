import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { MarkdownManager } from '@tiptap/markdown';

// The report editor's content model and its Markdown conversion. Markdown is the canonical saved form of a report: the
// editor loads it, and every save writes it back (pushReportDocUpdate or editStudioAsset), so channel asset kits,
// exports, the Google Docs handoff, brand check and Ask AI keep reading plain Markdown.
//
// Supported blocks: headings (1–4), paragraphs, bold, italic, strike, inline code, links, bullet and numbered lists
// (nested), quotes, tables, code blocks and dividers. Anything else in a generated report is read as text.

// Bump when the Markdown → document conversion changes: the seed of a report that has no saved live state is derived
// from it (ydoc.js seedClientId), so two versions never seed the same report differently under one id.
export const CONVERTER_VERSION = 1;

const SAFE_LINK = /^(https?:|mailto:)/i;
// A link typed or pasted without a scheme gets https://; anything that isn't http(s) or mailto is refused.
export function safeHref(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (SAFE_LINK.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return '';
  if (/^[\w.-]+@[\w-]+\.[\w.-]+$/.test(text)) return `mailto:${text}`;
  return `https://${text.replace(/^\/+/, '')}`;
}

// The content extensions, shared by the editor (which adds collaboration, placeholder and its own plugins) and the
// converter, so both read and write the same document shape.
export function contentExtensions() {
  return [
    StarterKit.configure({
      undoRedo: false, // Collaboration brings its own undo, per person
      underline: false, // not Markdown
      trailingNode: false, // would add a paragraph on open: a change nobody made
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', isAllowedUri: (url) => SAFE_LINK.test(String(url || '').trim()),HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
    }),
    TableKit.configure({ table: { resizable: false, renderWrapper: true } }),
  ];
}

let manager = null;
let schema = null;
const getManager = () => (manager ||= new MarkdownManager({ extensions: contentExtensions() }));
export const reportSchema = () => (schema ||= getSchema(contentExtensions()));

const EMPTY_DOC = Object.freeze({ type: 'doc', content: [{ type: 'paragraph' }] });

// Markdown → the editor's JSON document. Never throws: unreadable input becomes one paragraph of its text.
export function markdownToJSON(markdown) {
  const text = String(markdown || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return { ...EMPTY_DOC, content: [{ type: 'paragraph' }] };
  try {
    const json = getManager().parse(text);
    return json?.content?.length ? json : { ...EMPTY_DOC, content: [{ type: 'paragraph' }] };
  } catch {
    return { type: 'doc', content: text.split(/\n{2,}/).map((part) => ({ type: 'paragraph', content: part.trim() ? [{ type: 'text', text: part }] : undefined })) };
  }
}

// Blank lines tidied outside code: at most one between blocks, none at the ends. Code blocks keep theirs.
export function normalizeMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const out = []; let fence = ''; let blank = 0;
  for (const line of lines) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1] || '';
    if (fence) { out.push(line); if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = ''; continue; }
    if (marker) { fence = marker; blank = 0; out.push(line.replace(/\s+$/, '')); continue; }
    // A line of only non-breaking spaces is how an empty paragraph serializes: keep it a plain blank line.
    if (!line.replace(/[\s ]|&nbsp;/g, '')) { blank += 1; if (blank === 1) out.push(''); continue; }
    blank = 0; out.push(line.replace(/[ \t]+$/, ''));
  }
  return out.join('\n').trim();
}

// The editor's JSON document → canonical Markdown.
export function jsonToMarkdown(json) {
  if (!json || typeof json !== 'object') return '';
  try { return normalizeMarkdown(getManager().serialize(json)); } catch { return ''; }
}

// Plain text of a JSON document (for counts and searches), blocks separated by blank lines.
export function jsonText(json) {
  const parts = [];
  const walk = (node) => { if (!node) return; if (node.type === 'text') parts.push(node.text || ''); (node.content || []).forEach(walk); if (/^(paragraph|heading|codeBlock|tableCell|tableHeader)$/.test(node.type)) parts.push('\n'); };
  walk(json);
  return parts.join('').replace(/\n{2,}/g, '\n').trim();
}
