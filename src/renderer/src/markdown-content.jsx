import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './markdown-content.css';

export function safeMarkdownUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch (_) { return ''; }
}

function MarkdownLink({ href, children, onOpenSourceUrl }) {
  const url = safeMarkdownUrl(href);
  const [error, setError] = useState('');
  if (!url) return <span>{children}</span>;
  async function open(event) {
    const openSource = onOpenSourceUrl || globalThis.window?.apifyStudio?.openSourceUrl;
    if (typeof openSource !== 'function') return;
    event.preventDefault();
    setError('');
    try { await openSource(url); }
    catch (failure) { setError(failure?.message || 'Could not open this source. Try again.'); }
  }
  return <><a href={url} onClick={open} target="_blank" rel="noopener noreferrer">{children}</a>{error && <span className="markdown-link-error" role="alert">{error}</span>}</>;
}

const plugins = [remarkGfm];
const noUrl = () => '';
const table = ({ children: rows }) => <div className="markdown-table-wrap"><table>{rows}</table></div>;
const noImage = () => null;

// `linksOff` renders every link as its words (nothing is clickable while an Ask AI answer is still being written);
// `bare` renders the Markdown without the wrapper, for a caller that supplies its own.
export function MarkdownContent({ children, className = '', onOpenSourceUrl, allowedSourceUrls, linksOff = false, bare = false }) {
  const allowed = Array.isArray(allowedSourceUrls) ? new Set(allowedSourceUrls.map(safeMarkdownUrl).filter(Boolean)) : null;
  function transformUrl(url, key) {
    const safe = key === 'href' ? safeMarkdownUrl(url) : '';
    return safe && (!allowed || allowed.has(safe)) ? safe : '';
  }
  const body = <ReactMarkdown remarkPlugins={plugins} skipHtml urlTransform={linksOff ? noUrl : transformUrl} components={{
    a: ({ href, children: label }) => (linksOff ? <span>{label}</span> : <MarkdownLink href={href} onOpenSourceUrl={onOpenSourceUrl}>{label}</MarkdownLink>),
    img: noImage,
    table,
  }}>{typeof children === 'string' ? children : ''}</ReactMarkdown>;
  return bare ? body : <div className={`markdown-content ${className}`.trim()}>{body}</div>;
}

// One finished block of a streaming answer: parsed once, then left alone while later blocks arrive.
const MarkdownBlock = memo(function MarkdownBlock({ text, linksOff }) {
  return <MarkdownContent bare linksOff={linksOff}>{text}</MarkdownContent>;
});
// A streaming answer as its blocks (ask-markdown.js splitBlocks) inside one .markdown-content wrapper, so it looks the
// same as the finished answer and only the block still being written is parsed again on each frame.
export function MarkdownBlocks({ blocks = [], linksOff = true, className = '' }) {
  return <div className={`markdown-content ${className}`.trim()}>{blocks.map((text, index) => (text ? <MarkdownBlock key={index} text={text} linksOff={linksOff} /> : null))}</div>;
}
