import { describe, expect, it, vi } from 'vitest';
const { createFieldStream, fieldStreamer } = require('../src/shared/structured-stream.js');

// Ask AI shows its answer field while the model writes the JSON; these pieces arrive at any boundary.
const pieces = (text, size) => Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, (index + 1) * size));

describe('createFieldStream', () => {
  it('returns only the newly decoded characters of the top-level answer, at any split', () => {
    const answer = 'Line one\nwith "quotes", a tab\t, a backslash \\ and é ☃ 😀';
    const json = JSON.stringify({ cards: [{ answer: 'nested is ignored', note: 'a "}" inside' }], score: 1.5, ok: true, nothing: null, answer, after: ['x'] });
    for (const size of [1, 2, 3, 7, 64]) {
      const stream = createFieldStream('answer');
      const out = pieces(json, size).map((piece) => stream.push(piece)).join('');
      expect(out, `size ${size}`).toBe(answer);
      expect(stream.text()).toBe(answer); expect(stream.complete).toBe(true);
    }
  });
  it('decodes unicode escapes split across pieces, surrogate pairs included', () => {
    const json = '{"answer":"caf\\u00e9 \\ud83d\\ude00 done"}';
    const stream = createFieldStream();
    expect(pieces(json, 1).map((piece) => stream.push(piece)).join('')).toBe('café 😀 done');
  });
  it('skips a code fence before the object and ignores a non-string answer', () => {
    const fenced = createFieldStream('answer');
    expect(fenced.push('```json\n{"answer": "Hi"}\n```')).toBe('Hi');
    const odd = createFieldStream('answer');
    expect(odd.push('{"answer": null, "other": "x"}')).toBe('');
    expect(odd.found).toBe(false);
  });
  it('streams a field with another name', () => {
    expect(createFieldStream('summary').push('{"answer":"no","summary":"yes"}')).toBe('yes');
    expect(() => createFieldStream('')).toThrow();
  });
});

describe('fieldStreamer (the runner side of the streaming contract)', () => {
  it('sends text deltas, status lines, and the whole field once when nothing streamed', () => {
    const events = []; const onStream = (event) => events.push(event);
    const live = fieldStreamer(onStream);
    live.status('Writing with Claude Opus 5.5'); live.push('{"answer":"Hel'); live.push('lo"}'); live.flush({ answer: 'Hello' });
    expect(events).toEqual([{ type: 'status', text: 'Writing with Claude Opus 5.5' }, { type: 'text', delta: 'Hel' }, { type: 'text', delta: 'lo' }]);
    const final = []; const once = fieldStreamer((event) => final.push(event));
    once.flush({ answer: 'All at once' });
    expect(final).toEqual([{ type: 'text', delta: 'All at once' }]);
    const empty = []; fieldStreamer((event) => empty.push(event)).flush({});
    expect(empty).toEqual([{ type: 'text', delta: '' }]);
  });
  it('never lets a failing listener stop the call', () => {
    const live = fieldStreamer(vi.fn(() => { throw new Error('display gone'); }));
    expect(() => { live.push('{"answer":"x"}'); live.status('s'); live.flush({ answer: 'x' }); }).not.toThrow();
    expect(fieldStreamer(null)).toBeNull();
  });
});
