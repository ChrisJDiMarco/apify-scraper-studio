// Markdown helpers for Ask AI's streamed answers. While an answer is being written its Markdown is incomplete at the
// end (an open code fence, half a table row, a bold marker without its pair), and re-parsing the whole answer on every
// frame makes earlier lines jump. So the text is split into finished blocks, which never change and render once, and
// the block still being written, which is made safe to render on its own. Pure functions, no React.

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

// Splits on blank lines outside code fences. A blank line inside a list that goes on (the next line is another item or
// is indented under one) keeps the list in one block, so a loose list renders as one list while it streams and after.
// → { stable: [finished blocks], tail: the block still being written ('' when there is none) }.
export function splitBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = []; let current = []; let fence = ''; let gap = false;
  for (const line of lines) {
    if (fence) { current.push(line); if (line.trim().startsWith(fence)) fence = ''; continue; }
    if (!line.trim()) { if (current.length) gap = true; continue; }
    if (gap) {
      const goesOn = LIST_ITEM.test(current[0]) && (LIST_ITEM.test(line) || /^\s{2,}\S/.test(line));
      if (goesOn) current.push('');
      else { blocks.push(current.join('\n')); current = []; }
      gap = false;
    }
    current.push(line);
    const open = FENCE_OPEN.exec(line); if (open) fence = open[1];
  }
  return { stable: blocks, tail: current.join('\n') };
}

// Counts a marker on one line outside inline code.
function countOutsideCode(line, marker) {
  let count = 0; let inCode = false;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '`') { inCode = !inCode; continue; }
    if (!inCode && line.startsWith(marker, index)) { count++; index += marker.length - 1; }
  }
  return count;
}

// The block still being written, made safe to render: an open fence is closed; a half-written [[Title]], [label](…) or
// [label is shown as its words; an odd **, __ or ` on the last line is closed; a table waits for its separator row and
// hides a half-written row; a line that is only a heading or list marker waits for its words.
export function stabilizeTail(tail) {
  let text = String(tail ?? '');
  if (!text) return '';
  const lines = text.split('\n');
  // An open code fence: close it so the code renders as code, not as a paragraph.
  let fence = '';
  for (const line of lines) { if (fence) { if (line.trim().startsWith(fence)) fence = ''; } else { const open = FENCE_OPEN.exec(line); if (open) fence = open[1]; } }
  if (fence) return `${text}\n${fence}`;
  // A table: nothing until the separator row is complete, then never a half-written last row.
  if (/^\s*\|/.test(lines[0])) {
    if (!lines.slice(1).some((line) => TABLE_SEPARATOR.test(line))) return '';
    if (lines.length > 2 && /^\s*\|/.test(lines[lines.length - 1]) && !/\|\s*$/.test(lines[lines.length - 1])) lines.pop();
    return lines.join('\n');
  }
  let last = lines[lines.length - 1];
  // A line that is only a heading or list marker so far.
  if (/^\s{0,3}#{1,6}\s*$/.test(last) || /^\s*(?:[-*+]|\d{1,9}[.)])\s*$/.test(last)) { lines.pop(); return lines.join('\n').trimEnd(); }
  // Links still being written show their words.
  last = last.replace(/\[\[([^\]\n]*)\]?$/, (all, words) => (words.trim() ? `**${words}**` : '')).replace(/\[([^\]\n]*)\]\([^)\s]*$/, '$1').replace(/\[([^\]\n]*)$/, '$1');
  // Emphasis and inline code opened on this line and not yet closed.
  if ((last.match(/`/g) || []).length % 2) last += '`';
  if (countOutsideCode(last, '**') % 2) last += '**';
  if (countOutsideCode(last, '__') % 2) last += '__';
  const singles = last.replace(/^\s*\*\s+/, '').replace(/\*\*/g, '').split('').filter((char) => char === '*').length;
  if (singles % 2) last += '*';
  lines[lines.length - 1] = last;
  return lines.join('\n');
}

// How the raw streamed text shows while it is written, so the switch to the finished answer looks the same: [[Title]]
// and studio links (which become buttons under the answer) are bold words, and web links are their words until the
// answer is finished and its links checked.
export function streamDisplay(raw) {
  return String(raw ?? '')
    .replace(/\[\[([^[\]\n]{1,160})\]\]/g, '**$1**')
    .replace(/\[([^\]\n]{1,160})\]\(studio:[^)\s]*\)/g, '**$1**')
    .replace(/\[([^\]\n]*)\]\((?:https?:\/\/)[^)\s]*\)/g, '$1');
}

// The line the server adds under an answer whose reply couldn't be read as JSON (src/main/help-assistant.js SALVAGE_NOTE;
// test/ask-reply.test.jsx keeps the two the same). The answer shows it as a quiet note with an icon, not as text, and
// Copy answer leaves it out.
export const SALVAGE_NOTE = 'Some extras (cards and buttons) couldn’t be read this time.';
// → { text: the answer without the note, salvaged: whether it ended with it }.
export function splitSalvage(content) {
  const text = String(content ?? '');
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith(SALVAGE_NOTE)) return { text, salvaged: false };
  return { text: trimmed.slice(0, -SALVAGE_NOTE.length).trimEnd(), salvaged: true };
}

// The answer as people copy it: studio links become their plain titles (they only work inside the studio).
export function copyableMarkdown(content) {
  return String(content ?? '').replace(/\[([^\]\n]{1,160})\]\(studio:[^)\s]*\)/g, '$1').replace(/\[\[([^[\]\n]{1,160})\]\]/g, '$1').trim();
}

// The first sentence of an answer, for the screen-reader announcement ("Answer ready. …"), at most `max` characters.
export function firstSentence(content, max = 160) {
  const plain = copyableMarkdown(content).replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|~]+/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  const sentence = (/^(.+?[.!?])(\s|$)/.exec(plain)?.[1] || plain);
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

// In-app links in an answer, [label](studio:<kind>/<id>) (the server writes them from [[Exact title]] and drops any it
// can't find): the words stay in the text, in bold, and each link becomes a button under the answer (at most six).
const STUDIO_LINK = /\[([^\]\n]{1,160})\]\(studio:(report|trend|folder|run|prompt|program|page)\/([A-Za-z0-9][A-Za-z0-9_.:~-]{0,299})\)/g;
export function studioLinks(content) {
  const links = []; const seen = new Set();
  const text = String(content || '').replace(STUDIO_LINK, (all, label, kind, id) => {
    const key = `${kind}:${id}`;
    if (!seen.has(key) && links.length < 6) { seen.add(key); links.push({ label: label.replace(/\*/g, ''), kind, id }); }
    return `**${label.replace(/\*/g, '')}**`;
  });
  return { text, links };
}
