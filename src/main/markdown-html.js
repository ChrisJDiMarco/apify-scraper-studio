'use strict';
// Markdown → HTML for reports edited in the studio. Deliberately small: headings, paragraphs, lists, bold and italic,
// https links, code, blockquotes and rules. Everything else is escaped, so an edit can never add markup or scripts, and
// the result stays inside what Google Docs delivery accepts (google-delivery.js safeGoogleDocHtml takes https links only,
// so an http:// address stays plain text and the edited report can still be saved to Drive).
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const SECRET_PARAM = /^(token|api[-_]?key|access[-_]?token|secret|password|signature)$/i;
const WORD = /[A-Za-z0-9]/;

// Only https links without credentials or secret-looking query parameters become links; anything else stays text.
function safeHref(raw) {
  let url; try { url = new URL(String(raw || '').trim()); } catch (_) { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password || [...url.searchParams.keys()].some((key) => SECRET_PARAM.test(key))) return '';
  return url.href;
}
const link = (href, label) => (href ? `<a href="${escape(href)}">${label}</a>` : label);
// [label](http://…) keeps its address as text after the label, so the reader still sees where it pointed.
function plainHttp(raw) {
  let url; try { url = new URL(String(raw || '').trim()); } catch (_) { return ''; }
  return url.protocol === 'http:' && !url.username && !url.password && ![...url.searchParams.keys()].some((key) => SECRET_PARAM.test(key)) ? url.href : '';
}
const labelled = (raw, label) => { const href = safeHref(raw); if (href) return link(href, label); const http = plainHttp(raw); return http ? `${label} (${escape(http)})` : label; };

// Inline Markdown, left to right. Code spans first so nothing inside them is formatted.
function inline(text) {
  let rest = String(text ?? ''); let out = ''; let previous = '';
  const emit = (html, consumed) => { out += html; previous = consumed.slice(-1); rest = rest.slice(consumed.length); };
  while (rest) {
    let match;
    if ((match = /^\\([\\`*_{}[\]()#+\-.!>|~])/.exec(rest))) { emit(escape(match[1]), match[0]); continue; }
    if ((match = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))) { emit(`<code>${escape(match[2].trim())}</code>`, match[0]); continue; }
    if ((match = /^\[([^\]\n]+)\]\(\s*<?([^()\s<>]+)>?(?:\s+"[^"\n]*")?\s*\)/.exec(rest))) { emit(labelled(match[2], inline(match[1])), match[0]); continue; }
    if ((match = /^<(https?:\/\/[^\s<>]+)>/i.exec(rest))) { emit(link(safeHref(match[1]), escape(match[1])), match[0]); continue; }
    if (!WORD.test(previous) && (match = /^https?:\/\/[^\s<>"]+/i.exec(rest))) {
      const url = match[0].replace(/[.,:;!?'")\]]+$/, '');
      emit(link(safeHref(url), escape(url)), url); continue;
    }
    if ((match = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest)) && (match[1] === '**' || !WORD.test(previous))) { emit(`<strong>${inline(match[2])}</strong>`, match[0]); continue; }
    if ((match = /^(\*|_)(?=[^\s*_])([\s\S]*?[^\s\\])\1(?![*_])/.exec(rest)) && (match[1] === '*' || (!WORD.test(previous) && !WORD.test(rest.charAt(match[0].length))))) { emit(`<em>${inline(match[2])}</em>`, match[0]); continue; }
    // Plain text up to the next character that could start something; one character at a time past a false start.
    match = /^[^\\`[<*_h]+/.exec(rest) || [rest.charAt(0)];
    emit(escape(match[0]), match[0]);
  }
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const indentOf = (line) => line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);
// Single line breaks inside a paragraph are kept, as the generated reports' HTML keeps them.
const paragraph = (lines) => `<p>${lines.map((line) => inline(line.trim())).join('<br>')}</p>`;

function blocks(lines) {
  const out = []; let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    let match;
    if ((match = FENCE.exec(line))) {
      const fence = match[1]; const body = []; index++;
      while (index < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(lines[index])) body.push(lines[index++]);
      index++; out.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`); continue;
    }
    if ((match = HEADING.exec(line))) { const level = match[1].length; out.push(`<h${level}>${inline(match[2] || '')}</h${level}>`); index++; continue; }
    if (RULE.test(line)) { out.push('<hr>'); index++; continue; }
    if (QUOTE.test(line)) {
      const body = [];
      while (index < lines.length && lines[index].trim() && (QUOTE.test(lines[index]) || !startsBlock(lines[index]))) body.push(lines[index++].replace(QUOTE, ''));
      out.push(`<blockquote>${blocks(body)}</blockquote>`); continue;
    }
    if ((match = ITEM.exec(line))) { index = list(lines, index, out); continue; }
    const body = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) body.push(lines[index++]);
    out.push(paragraph(body));
  }
  return out.join('');
}

// One list: every item at the first item's indent and of its kind (bulleted or numbered). An item owns the lines
// indented under it, including nested lists, and plain lines that continue it.
function list(lines, start, out) {
  const first = ITEM.exec(lines[start]); const base = indentOf(first[1]); const ordered = /\d/.test(first[2]);
  const items = []; let index = start;
  const sameList = (line) => { const match = ITEM.exec(line || ''); return Boolean(match) && indentOf(match[1]) === base && /\d/.test(match[2]) === ordered; };
  while (index < lines.length) {
    if (!lines[index].trim()) { // a blank line between two items keeps one list
      let next = index; while (next < lines.length && !lines[next].trim()) next++;
      if (items.length && sameList(lines[next])) { index = next; continue; }
      break;
    }
    const match = ITEM.exec(lines[index]);
    if (!sameList(lines[index])) break;
    const contentIndent = base + match[2].length + Math.max(1, Math.min(4, match[3].replace(/\t/g, '    ').length));
    const body = [match[4]]; index++;
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim()) {
        const following = lines.slice(index + 1).find((entry) => entry.trim());
        if (following !== undefined && indentOf(following) >= contentIndent) { body.push(''); index++; continue; }
        break;
      }
      const nested = ITEM.exec(next);
      if (indentOf(next) >= contentIndent || (nested && indentOf(nested[1]) > base)) { body.push(next.slice(Math.min(indentOf(next), contentIndent))); index++; continue; }
      if (!startsBlock(next)) { body.push(next.trim()); index++; continue; }
      break;
    }
    const html = blocks(body);
    items.push(`<li>${/^<p>[\s\S]*<\/p>$/.test(html) && html.indexOf('<p>', 1) === -1 ? html.slice(3, -4) : html}</li>`);
  }
  const startAt = ordered ? Number.parseInt(first[2], 10) : 1;
  out.push(ordered ? `<ol${startAt !== 1 ? ` start="${startAt}"` : ''}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
  return index;
}

function markdownToHtml(markdown) {
  return blocks(String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n'));
}
// A leading "# Title" line becomes the page title; the rest is the body.
function splitTitle(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim());
  const match = first >= 0 ? /^ {0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[first]) : null;
  if (!match) return { title: '', body: lines.join('\n') };
  const title = match[1].replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1').replace(/\*\*|__|`/g, '').trim();
  return { title, body: lines.slice(first + 1).join('\n') };
}

module.exports = { markdownToHtml, splitTitle, inline, safeHref };
