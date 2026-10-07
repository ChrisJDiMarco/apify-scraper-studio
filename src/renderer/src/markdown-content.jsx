import { useState } from 'react';
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

export function MarkdownContent({ children, className = '', onOpenSourceUrl, allowedSourceUrls }) {
  const allowed = Array.isArray(allowedSourceUrls) ? new Set(allowedSourceUrls.map(safeMarkdownUrl).filter(Boolean)) : null;
  function transformUrl(url, key) {
    const safe = key === 'href' ? safeMarkdownUrl(url) : '';
    return safe && (!allowed || allowed.has(safe)) ? safe : '';
  }
  return <div className={`markdown-content ${className}`.trim()}>
    <ReactMarkdown remarkPlugins={plugins} skipHtml urlTransform={transformUrl} components={{
      a: ({ href, children: label }) => <MarkdownLink href={href} onOpenSourceUrl={onOpenSourceUrl}>{label}</MarkdownLink>,
      img: () => null,
      table: ({ children: rows }) => <div className="markdown-table-wrap"><table>{rows}</table></div>,
    }}>{typeof children === 'string' ? children : ''}</ReactMarkdown>
  </div>;
}
