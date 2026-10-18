import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// Reading a model's JSON reply (src/shared/json-reply.js): JSON.parse first, then, only when lenient, a code fence, a
// balanced object inside prose (the longest that parses), and that object repaired. Nothing is ever made up: a repair only
// escapes raw control characters inside strings and drops trailing commas, so anything else still fails.
const require = createRequire(import.meta.url);
const { parseJsonReply, repairJson, objectCandidates, readJsonField, clipText, schemaAccept } = require('../src/shared/json-reply.js');
const lenient = (text) => parseJsonReply(text, { lenient: true });

describe('parseJsonReply', () => {
  it('is JSON.parse for valid JSON, lenient or not, and keeps a value that isn’t an object for the caller to refuse', () => {
    expect(parseJsonReply('{"answer":"Hi","followUps":[]}')).toEqual({ value: { answer: 'Hi', followUps: [] }, repaired: 'none' });
    expect(lenient(' {"answer":"Hi"}\n')).toEqual({ value: { answer: 'Hi' }, repaired: 'none' });
    expect(lenient('["pong"]')).toEqual({ value: ['pong'], repaired: 'none' });
    expect(() => parseJsonReply('```json\n{"answer":"Hi"}\n```')).toThrow('not valid JSON');
    expect(() => parseJsonReply(null, { lenient: true })).toThrow('not text');
  });

  it('reads the object inside a code fence, alone or with prose around it', () => {
    expect(lenient('```json\n{"answer":"Fenced"}\n```')).toEqual({ value: { answer: 'Fenced' }, repaired: 'fence' });
    expect(lenient('```\n{"answer":"Bare fence"}\n```')).toEqual({ value: { answer: 'Bare fence' }, repaired: 'fence' });
    expect(lenient('Here is the answer:\n```json\n{"answer":"In the middle"}\n```\nLet me know if that helps.')).toEqual({ value: { answer: 'In the middle' }, repaired: 'fence' });
  });

  it('extracts the object from prose, past braces and an unclosed brace before it', () => {
    expect(lenient('Sure! {"answer":"Wrapped"} Hope this helps.')).toEqual({ value: { answer: 'Wrapped' }, repaired: 'extracted' });
    const braces = lenient('Use {name} placeholders, like {this}. {"answer":"Real","cards":[{"type":"metric","items":["a"]}]}');
    expect(braces).toEqual({ value: { answer: 'Real', cards: [{ type: 'metric', items: ['a'] }] }, repaired: 'extracted' });
    expect(lenient('Press { to open a group. {"answer":"After an open brace"}')).toEqual({ value: { answer: 'After an open brace' }, repaired: 'extracted' });
    // Braces and quotes inside strings don't end the object early.
    expect(lenient('Note: {"answer":"Type } or { or \\" freely","followUps":["Why?"]} done')).toEqual({ value: { answer: 'Type } or { or " freely', followUps: ['Why?'] }, repaired: 'extracted' });
  });

  it('takes the longest of two objects that both parse, and the first when they are the same length', () => {
    expect(lenient('{"answer":"Draft"}\n{"answer":"The final, longer answer","followUps":[]}').value).toEqual({ answer: 'The final, longer answer', followUps: [] });
    expect(lenient('{"answer":"One"}{"answer":"Two"}').value).toEqual({ answer: 'One' });
    // A short valid object never beats a longer one that only needed a repair.
    expect(lenient('{"a":1}\n{"answer":"Line one\nLine two","followUps":[]}')).toEqual({ value: { answer: 'Line one\nLine two', followUps: [] }, repaired: 'repaired' });
  });

  it('repairs raw line breaks, tabs and other control characters inside strings, and trailing commas', () => {
    expect(lenient('{"answer":"Line one\nLine two\r\n\tIndented\u0001"}')).toEqual({ value: { answer: 'Line one\nLine two\r\n\tIndented\u0001' }, repaired: 'repaired' });
    expect(lenient('{"answer":"Done","followUps":["One?","Two?",],}')).toEqual({ value: { answer: 'Done', followUps: ['One?', 'Two?'] }, repaired: 'repaired' });
    expect(lenient('Here you go:\n{\n  "answer": "Both\nat once",\n  "followUps": [],\n}\nThanks!')).toEqual({ value: { answer: 'Both\nat once', followUps: [] }, repaired: 'repaired' });
  });

  it('fails rather than guess: an unescaped quote, a cut-off object, no object at all', () => {
    expect(() => lenient('{"answer":"Press "Run" to start","followUps":[]}')).toThrow('No JSON object');
    expect(() => lenient('{"answer":"Cut off mid-sent')).toThrow('No JSON object');
    expect(() => lenient('I can’t help with that.')).toThrow('No JSON object');
    expect(() => lenient('')).toThrow('No JSON object');
  });

  it('never takes an object nested inside the reply’s own broken object as the answer', () => {
    // One unescaped quote: the outer object never closes, so its image and scan objects mustn't stand in for it.
    expect(() => lenient('{"answer":"A 13" laptop","image":{"create":false,"title":""},"scan":{"topic":"","depth":"lite"}}')).toThrow('No JSON object');
    expect(() => lenient('{\n  "answer": "Press \"Run on the scan card",\n  "pages": [{"page":"research","label":"Open"}, {"page":"board","label":"Board"}],\n  "show": {"autoStart": false, "steps": []}\n}')).toThrow('No JSON object');
    // Cut off, or missing its last brace.
    expect(() => lenient('{"answer":"cut off","pages":[{"page":"research","label":"Open"}')).toThrow('No JSON object');
    expect(() => lenient('{"answer":"No last brace","image":{"create":false,"title":""},"show":{"autoStart":false,"steps":[]}')).toThrow('No JSON object');
    // An array of objects in prose still gives up an object for the caller to check.
    expect(lenient('Here you go: [{"answer":"In a list"}]').value).toEqual({ answer: 'In a list' });
  });

  it('takes only an object the caller accepts from a fence or the text, never from a plain JSON.parse', () => {
    // schemaAccept: the object holds at least half of the schema's required keys; one nested in the answer holds few or none.
    const small = schemaAccept({ required: ['answer', 'followUps'] });
    const echoed = 'The schema is:\n{"type":"object","additionalProperties":false,"required":["answer"],"properties":{"answer":{"type":"string"},"followUps":{"type":"array","items":{"type":"string"}}}}\n\nMy answer:\n{"answer":"Hi","followUps":[]}';
    expect(parseJsonReply(echoed, { lenient: true, accept: small })).toEqual({ value: { answer: 'Hi', followUps: [] }, repaired: 'extracted' });
    // A quoted brace closes the object early: neither that stub nor the image object after it is the answer.
    const ask = schemaAccept({ required: ['answer', 'pages', 'followUps', 'image', 'scan', 'show'] });
    expect(() => parseJsonReply('{"answer":"Type "}" to close","image":{"create":false,"title":"","prompt":"","size":"1024x1024","family":"none"}}', { lenient: true, accept: ask })).toThrow('No JSON object');
    expect(() => parseJsonReply('```json\n{"url":"https://example.com"}\n```', { lenient: true, accept: ask })).toThrow('No JSON object');
    expect(parseJsonReply('Here: {"answer":"Most keys","pages":[],"followUps":[]}', { lenient: true, accept: ask }).value).toEqual({ answer: 'Most keys', pages: [], followUps: [] });
    expect(parseJsonReply('{"other":1}', { lenient: true, accept: ask })).toEqual({ value: { other: 1 }, repaired: 'none' });
    expect(schemaAccept({ type: 'object' })({ any: 1 })).toBe(true);
    expect(schemaAccept(null)({})).toBe(true);
  });

  it('reads past a code fence inside the answer’s own text', () => {
    expect(lenient('{"answer":"Send an empty filter:\n```json\n{}\n```\nThat’s all.","followUps":[]}')).toEqual({ value: { answer: 'Send an empty filter:\n```json\n{}\n```\nThat’s all.', followUps: [] }, repaired: 'repaired' });
  });

  it('stays quick on a fence with a long run of spaces or line breaks', () => {
    const started = Date.now();
    expect(() => lenient(`\`\`\`${' '.repeat(5000)}x`)).toThrow('No JSON object');
    expect(() => lenient(`\`\`\`${' '.repeat(200000)}`)).toThrow('No JSON object');
    expect(lenient(`\`\`\`json${'\n'.repeat(20000)}{"answer":"Late"}\n\`\`\`\nThanks!`).value).toEqual({ answer: 'Late' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('stays quick on a long reply full of braces', () => {
    const started = Date.now();
    expect(() => lenient('{'.repeat(200000))).toThrow('No JSON object');
    expect(lenient(`${'{ '.repeat(20)}{"answer":"x"}`).value).toEqual({ answer: 'x' });
    expect(lenient(`${'Fill in {name}. '.repeat(500)}{"answer":"After many placeholders"}`).value).toEqual({ answer: 'After many placeholders' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('repairJson and the helpers', () => {
  it('changes only how the same characters are written', () => {
    expect(repairJson('{"a":"x\ny","b":[1,2,],}')).toBe('{"a":"x\\ny","b":[1,2]}');
    expect(repairJson('{"a":"keep ,} and ,] inside","b":"\\"quoted\\""}')).toBe('{"a":"keep ,} and ,] inside","b":"\\"quoted\\""}');
    // A backslash before a raw line break stays a backslash (a shell line continuation), and the line break stays one.
    expect(JSON.parse(repairJson('{"a":"curl x \\\n  -H a"}'))).toEqual({ a: 'curl x \\\n  -H a' });
    expect(JSON.parse(repairJson('{"a":"x\\\ny"}'))).toEqual({ a: 'x\\\ny' });
    expect(repairJson('{"a":"\u001f"}')).toBe('{"a":"\\u001f"}');
    // An escape JSON doesn't have: \\' is the apostrophe it was meant as; any other keeps its backslash.
    expect(JSON.parse(repairJson('{"a":"Here\\\'s what I can do"}'))).toEqual({ a: 'Here\'s what I can do' });
    expect(JSON.parse(repairJson('{"a":"Match \\\\d+ in C:\\\\users, or \\d+ in C:\\users"}'))).toEqual({ a: 'Match \\d+ in C:\\users, or \\d+ in C:\\users' });
    expect(lenient('{"answer":"Here\\\'s what I can help with.","pages":[{"page":"research","label":"Open"}]}')).toEqual({ value: { answer: 'Here\'s what I can help with.', pages: [{ page: 'research', label: 'Open' }] }, repaired: 'repaired' });
  });

  it('lists balanced top-level objects in order', () => {
    expect(objectCandidates('a {b} c {"d":{"e":[1]}} f { g')).toEqual(['{b}', '{"d":{"e":[1]}}']);
    expect(objectCandidates('{ [ } ]')).toEqual([]);
  });

  it('reads one object or array field from a reply that doesn’t parse', () => {
    const broken = '{"answer":"Press "Run" now","followUps":["What next?","How much?",],"cards":[{"type":"x"}]}';
    expect(readJsonField(broken, 'followUps')).toEqual(['What next?', 'How much?']);
    expect(readJsonField(broken, 'cards')).toEqual([{ type: 'x' }]);
    expect(readJsonField(broken, 'actions')).toBeUndefined();
    expect(readJsonField('{"followUps":["open', 'followUps')).toBeUndefined();
    expect(readJsonField('{"followUps":"not a list","x":{"followUps":["nested"]}}', 'followUps')).toEqual(['nested']);
  });

  it('clips to a byte budget without splitting a character', () => {
    expect(clipText('abcdef', 4)).toBe('abcd');
    expect(clipText('ééé', 5)).toBe('éé');
    expect(clipText('😀😀', 6)).toBe('😀');
    expect(clipText('short', 100)).toBe('short');
    expect(Buffer.byteLength(clipText('界'.repeat(100000), 200 * 1024))).toBeLessThanOrEqual(200 * 1024);
  });
});
