const fs = require('node:fs/promises');
const path = require('node:path');
const { SaxesParser } = require('saxes');
const unzipper = require('unzipper');
const { MAX_SOURCE_CHARS } = require('../shared/content-studio');
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_GOOGLE_RESPONSE_BYTES = 8 * 1024 * 1024;
const WORD_NS = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
function fail(field, message) { const error = new Error(message); error.field = field; throw error; }
function finishText(value) {
  const text = value.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/\n[\t ]+\n/g, '\n\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (!text) fail('source', 'This document has no readable text. Use a text-based document; image-only documents need transcription.');
  if (text.length > MAX_SOURCE_CHARS) fail('source', `Document text exceeds ${MAX_SOURCE_CHARS.toLocaleString()} characters. Split the document; no text was silently shortened.`);
  return text;
}
function textCollector() {
  const chunks = []; let characters = 0;
  return { append(value) { if (typeof value !== 'string' || !value) return; characters += value.length; if (characters > MAX_SOURCE_CHARS + 5000) fail('source', 'Document text exceeds the 250,000-character budget. Split the document; no text was silently shortened.'); chunks.push(value); }, text() { return finishText(chunks.join('')); } };
}
function publicLink(value) {
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /^(token|api[-_]?key|access[-_]?token|secret|password|signature)$/i.test(key))) return url.href; } catch (_) { /* Not a usable link. */ }
  return '';
}
function xmlParser() {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => fail('file', 'Documents with XML entity declarations are not supported.'));
  parser.on('error', () => fail('file', 'The DOCX contains invalid XML. Export a fresh copy and try again.'));
  return parser;
}
function parseRelationships(xml) {
  const relationships = new Map(); if (!xml) return relationships;
  const parser = xmlParser(); let nodes = 0;
  parser.on('opentag', node => {
    if (++nodes > 10000) fail('file', 'The DOCX contains too many link relationships.');
    if (node.local !== 'Relationship') return;
    const attrs = Object.fromEntries(Object.values(node.attributes).map(attribute => [attribute.local, attribute.value]));
    if (attrs.Type?.endsWith('/hyperlink') && attrs.TargetMode === 'External') { const url = publicLink(attrs.Target); if (url) relationships.set(attrs.Id, url); }
  });
  parser.write(xml).close(); return relationships;
}
// Table rows become one line each, cells joined with " | " and paragraphs inside a cell with " / "
// (the n8n v6.1 registry extractor format), so tool tables survive as "Tool | Function | Tags".
function extractWordXml(xml, relationships = new Map()) {
  const output = textCollector(); const parser = xmlParser(); const stack = []; let captureText = 0; let nodes = 0; let isWord = false;
  const rows = []; const cells = [];
  const append = value => { const cell = cells.at(-1); if (cell) cell.current += value; else output.append(value); };
  parser.on('opentag', node => {
    if (++nodes > 100000 || stack.length > 100) fail('file', 'The DOCX XML is too complex to import safely.');
    const word = WORD_NS.has(node.uri); if (word) isWord = true;
    const current = { name: word ? node.local : '', link: '' }; stack.push(current);
    if (!word) return;
    if (node.local === 't') captureText += 1;
    if (node.local === 'tab') append(cells.length ? ' ' : '\t');
    if (['br', 'cr'].includes(node.local)) append(cells.length ? ' ' : '\n');
    if (node.local === 'tr') rows.push([]);
    if (node.local === 'tc') cells.push({ parts: [], current: '' });
    if (node.local === 'hyperlink') { const id = Object.values(node.attributes).find(attribute => attribute.local === 'id')?.value; current.link = relationships.get(id) || ''; }
  });
  parser.on('text', value => { if (captureText) append(value); });
  parser.on('cdata', value => { if (captureText) append(value); });
  parser.on('closetag', () => {
    const current = stack.pop(); if (!current) return;
    if (current.name === 't') captureText -= 1;
    if (current.name === 'hyperlink' && current.link) append(` (${current.link})`);
    if (current.name === 'p') { const cell = cells.at(-1); if (cell) { const part = cell.current.replace(/\s+/g, ' ').trim(); if (part) cell.parts.push(part); cell.current = ''; } else output.append('\n'); }
    if (current.name === 'tc') { const cell = cells.pop(); const tail = cell.current.replace(/\s+/g, ' ').trim(); if (tail) cell.parts.push(tail); rows.at(-1)?.push(cell.parts.join(' / ')); }
    if (current.name === 'tr') { const row = rows.pop() || []; const line = row.join(' | '); const parent = cells.at(-1); if (parent) { if (line) parent.parts.push(line); } else output.append(`${line}\n`); }
  });
  parser.write(xml).close(); if (!isWord) fail('file', 'The DOCX does not contain a supported Word document body.');
  return output.text();
}
async function entryText(entry) {
  if (entry.flags & 1) fail('file', 'Encrypted DOCX files are not supported. Save an unencrypted copy.');
  if (![0, 8].includes(entry.compressionMethod) || entry.uncompressedSize > MAX_XML_BYTES) fail('file', 'A DOCX text component exceeds the 4 MB import limit or uses unsupported compression.');
  const stream = entry.stream(); const chunks = []; let size = 0;
  try { for await (const chunk of stream) { size += chunk.length; if (size > MAX_XML_BYTES) { stream.destroy(); fail('file', 'A DOCX text component exceeds the 4 MB import limit.'); } chunks.push(chunk); } }
  catch (error) { if (error.field) throw error; fail('file', 'The DOCX text could not be decompressed. Export a fresh copy.'); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch (_) { fail('file', 'The DOCX contains an unsupported text encoding.'); }
}
async function extractDocumentText({ buffer, fileName } = {}) {
  if (!Buffer.isBuffer(buffer)) fail('file', 'Provide the document bytes to import.');
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES) fail('file', 'Use a nonempty document no larger than 20 MB.');
  const name = path.basename(String(fileName || '')); const extension = path.extname(name).toLowerCase();
  const title = path.basename(name, extension) || 'Imported document';
  if (['.txt', '.md', '.markdown'].includes(extension)) {
    let decoded; try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (_) { fail('file', 'Save this text document as UTF-8 and try again.'); }
    if (decoded.includes('\u0000')) fail('file', 'This appears to be a binary file. Choose a UTF-8 text, Markdown, or DOCX document.');
    const text = finishText(decoded); return { title, text, kind: 'upload', fileName: name, format: extension === '.txt' ? 'text' : 'markdown', characters: text.length, warnings: [] };
  }
  if (extension !== '.docx') fail('file', 'Choose a TXT, Markdown, or DOCX file. PDF and legacy DOC require conversion first.');
  let directory; try { directory = await unzipper.Open.buffer(buffer); } catch (_) { fail('file', 'This DOCX is not a readable Word document. Export a fresh DOCX copy.'); }
  if (directory.files.length > 5000) fail('file', 'This DOCX contains too many embedded components. Export a simpler copy.');
  const mainEntries = directory.files.filter(entry => entry.path === 'word/document.xml');
  if (mainEntries.length !== 1) fail('file', 'A DOCX must contain exactly one Word document body.');
  const relationEntries = directory.files.filter(entry => entry.path === 'word/_rels/document.xml.rels');
  if (relationEntries.length > 1) fail('file', 'This DOCX contains duplicate link definitions.');
  const relationships = relationEntries.length ? parseRelationships(await entryText(relationEntries[0])) : new Map();
  const pieces = [extractWordXml(await entryText(mainEntries[0]), relationships)];
  const warnings = ['Imported readable paragraphs and tables. Images, layout, comments, headers and footers are not analyzed.'];
  for (const [part, label] of [['word/footnotes.xml', 'Footnotes'], ['word/endnotes.xml', 'Endnotes']]) {
    const entries = directory.files.filter(entry => entry.path === part);
    if (entries.length > 1) fail('file', 'This DOCX contains duplicate note components.');
    if (entries.length) { const xml = await entryText(entries[0]); try { pieces.push(`${label}\n${extractWordXml(xml)}`); } catch (error) { if (!error.message.includes('no readable text')) throw error; } }
  }
  const text = finishText(pieces.join('\n\n')); return { title, text, kind: 'upload', fileName: name, format: 'docx', characters: text.length, warnings };
}
async function readDocumentFile({ filePath } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) fail('filePath', 'Choose a local document file.');
  let handle;
  try { handle = await fs.open(filePath, 'r'); const stat = await handle.stat(); if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) fail('file', 'Choose a regular document file no larger than 20 MB.'); const buffer = Buffer.alloc(stat.size + 1); let offset = 0; while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead; } if (offset > stat.size) fail('file', 'The document changed while being read. Retry the import.'); return await extractDocumentText({ buffer: buffer.subarray(0, offset), fileName: path.basename(filePath) }); }
  catch (error) { if (error.field) throw error; fail('file', 'The selected document could not be read. Check access and try again.'); }
  finally { await handle?.close(); }
}
function parseGoogleDocUrl(value) {
  let url; try { url = new URL(value); } catch (_) { fail('googleDocUrl', 'Paste a Google Docs document URL.'); }
  const match = url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,200})(?:\/(?:edit|view|preview|mobilebasic))?\/?$/);
  if (url.origin !== 'https://docs.google.com' || url.username || url.password || !match) fail('googleDocUrl', 'Use an HTTPS docs.google.com/document/d/... document URL.');
  return { documentId: match[1], url: `https://docs.google.com/document/d/${match[1]}/edit` };
}
// Paragraphs inside a Google Docs table cell, joined with " / " (nested tables become "a | b").
function cellText(elements, depth = 0) {
  if (depth > 15) fail('googleDoc', 'This Google document is nested too deeply to import.');
  const parts = [];
  for (const element of Array.isArray(elements) ? elements : []) {
    if (element.paragraph) { const value = (element.paragraph.elements || []).map(run => (typeof run.textRun?.content === 'string' ? run.textRun.content : '')).join('').replace(/\s+/g, ' ').trim(); if (value) parts.push(value); }
    if (element.table) for (const row of element.table.tableRows || []) parts.push((row.tableCells || []).map(cell => cellText(cell.content, depth + 1)).join(' | '));
  }
  return parts.join(' / ');
}
function extractGoogleDocumentText(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) fail('googleDoc', 'Google Docs returned an invalid document.');
  const output = textCollector(); let visited = 0; let hasBodyText = false;
  function content(elements, depth = 0) {
    if (depth > 15) fail('googleDoc', 'This Google document is nested too deeply to import.');
    for (const element of Array.isArray(elements) ? elements : []) {
      if (++visited > 100000) fail('googleDoc', 'This Google document is too complex to import.');
      if (element.paragraph) {
        for (const run of element.paragraph.elements || []) {
          if (++visited > 100000) fail('googleDoc', 'This Google document is too complex to import.');
          if (run.textRun && typeof run.textRun.content === 'string') { if (run.textRun.content.trim()) hasBodyText = true; output.append(run.textRun.content); const url = publicLink(run.textRun.textStyle?.link?.url); if (url && !run.textRun.content.includes(url)) output.append(` (${url})`); }
        }
        output.append('\n');
      }
      if (element.table) for (const row of element.table.tableRows || []) { const line = (row.tableCells || []).map(cell => cellText(cell.content, depth + 1)).join(' | '); if (line.replace(/[|\s]/g, '')) hasBodyText = true; output.append(`${line}\n`); }
      if (element.tableOfContents) content(element.tableOfContents.content, depth + 1);
    }
  }
  function tabs(values, depth = 0) {
    if (depth > 15) fail('googleDoc', 'This Google document has too many nested tabs.');
    for (const tab of values) { if (++visited > 100000) fail('googleDoc', 'This Google document is too complex to import.'); if (tab.tabProperties?.title) output.append(`${tab.tabProperties.title}\n`); content(tab.documentTab?.body?.content); if (Array.isArray(tab.childTabs)) tabs(tab.childTabs, depth + 1); }
  }
  if (Array.isArray(document.tabs) && document.tabs.length) tabs(document.tabs); else content(document.body?.content);
  if (!hasBodyText) fail('source', 'This Google document has no readable body text. Image-only documents need transcription.');
  return output.text();
}
async function boundedResponseText(response) {
  const declared = Number(response.headers?.get('content-length'));
  if (declared > MAX_GOOGLE_RESPONSE_BYTES) fail('googleDoc', 'The Google document response exceeds the 8 MB import limit.');
  if (!response.body || typeof response.body.getReader !== 'function') fail('googleDoc', 'Google Docs returned an unreadable response.');
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_GOOGLE_RESPONSE_BYTES) { await reader.cancel(); fail('googleDoc', 'The Google document response exceeds the 8 MB import limit.'); } chunks.push(Buffer.from(value)); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
async function readGoogleDocument({ url, accessToken, fetchImpl = globalThis.fetch } = {}) {
  const target = parseGoogleDocUrl(url);
  if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 12000 || /[\r\n]/.test(accessToken)) fail('googleDocsConnection', 'Connect Google Docs before importing a private document.');
  if (typeof fetchImpl !== 'function') fail('googleDocsConnection', 'This runtime cannot connect to Google Docs.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(`https://docs.googleapis.com/v1/documents/${target.documentId}?includeTabsContent=true`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken.trim()}`, Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
    if (!response.ok) { if ([401, 403].includes(response.status)) fail('googleDocsConnection', 'Google Docs denied access. Reconnect or choose a document this account can read.'); if (response.status === 404) fail('googleDocUrl', 'This Google document was not found or is not shared with the connected account.'); fail('googleDoc', `Google Docs import failed with status ${response.status}. Try again.`); }
    let document; try { document = JSON.parse(await boundedResponseText(response)); } catch (error) { if (error.field) throw error; fail('googleDoc', 'Google Docs returned invalid document data.'); }
    const text = extractGoogleDocumentText(document);
    return { title: typeof document.title === 'string' ? document.title.slice(0, 240) : 'Google document', text, kind: 'upload', format: 'google-doc', url: target.url, characters: text.length, warnings: ['Imported readable text across document tabs and tables. Images, comments, headers and footers are not analyzed.'] };
  } catch (error) { if (error.field) throw error; if (controller.signal.aborted) fail('googleDoc', 'Google Docs import timed out. Try again.'); fail('googleDoc', 'Google Docs could not be reached. Check the connection and retry.'); }
  finally { clearTimeout(timer); }
}
module.exports = { MAX_DOCUMENT_BYTES, MAX_XML_BYTES, MAX_GOOGLE_RESPONSE_BYTES, extractDocumentText, readDocumentFile, parseGoogleDocUrl, extractGoogleDocumentText, readGoogleDocument };
