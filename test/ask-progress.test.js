import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

// Ask AI's progress hub (src/main/ask-progress.js): text framed into one event per frame, every other event sent at
// once after the text waiting before it, a seq that only grows, money stripped by the asker's projection, and records
// that only their own person can read back.
const require = createRequire(import.meta.url);
const { createAskProgress } = require('../src/main/ask-progress.js');
const { stripMoney } = require('../src/main/roles.js');

afterEach(() => { vi.useRealTimers(); });
function hub(options = {}) {
  const sent = []; let clock = Date.parse('2026-10-17T12:00:00Z');
  const progress = createAskProgress({ send: (target, event) => sent.push({ target, event }), now: () => clock, ...options });
  return { progress, sent, events: () => sent.map((row) => row.event), tick: (ms) => { clock += ms; } };
}

describe('Ask AI progress hub', () => {
  it('frames text into one delta per 50 ms and sends other events at once, text first', () => {
    vi.useFakeTimers();
    const { progress, events } = hub();
    const handle = progress.begin({ requestId: 'req-00000001', identityId: 'local', question: 'What changed?' });
    expect(events()).toEqual([expect.objectContaining({ type: 'progress', seq: 1, progress: expect.objectContaining({ status: 'starting', question: 'What changed?', textLength: 0 }) })]);
    handle.text('Two '); handle.text('trends '); handle.text('moved');
    // The first piece changed the status to writing (sent at once); the text waits for its frame.
    expect(events().map((event) => event.type)).toEqual(['progress', 'progress']);
    expect(events()[1].progress.status).toBe('writing');
    vi.advanceTimersByTime(50);
    expect(events()[2]).toMatchObject({ type: 'delta', seq: 3, at: 0, text: 'Two trends moved' });
    handle.text(' up.');
    handle.step({ id: 'cards', kind: 'cards', label: 'Adding 1 card', status: 'running' });
    // The step flushed the waiting text before itself, so the order holds.
    expect(events().slice(3).map((event) => [event.type, event.seq])).toEqual([['delta', 4], ['progress', 5]]);
    expect(events()[3]).toMatchObject({ at: 16, text: ' up.' });
    expect(handle.textSoFar()).toBe('Two trends moved up.');
    const seqs = events().map((event) => event.seq); expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('withdraws text with a reset, updates a step in place, and ends with the reply', () => {
    vi.useFakeTimers();
    const { progress, events } = hub();
    const handle = progress.begin({ requestId: 'req-00000002', identityId: 'local', question: 'Read it' });
    handle.text('Let me check the report.'); handle.reset();
    expect(events().at(-1)).toMatchObject({ type: 'progress', progress: { textLength: 0 } });
    handle.step({ id: 'lookup-0', kind: 'report', label: 'Reading “Zero-click”', status: 'running' });
    handle.step({ id: 'lookup-0', kind: 'report', label: 'Read “Zero-click”', status: 'done' });
    expect(events().at(-1).progress.steps).toEqual([{ id: 'lookup-0', kind: 'report', label: 'Read “Zero-click”', status: 'done' }]);
    handle.text('The answer.');
    const reply = { conversation: { id: 'ask-1' }, userMessage: { id: 'msg-u' }, message: { id: 'msg-a', content: 'The answer.', receipt: { costUsd: 0.08 } } };
    handle.done(reply);
    const last = events().at(-1);
    expect(last).toMatchObject({ type: 'progress', conversationId: 'ask-1', progress: { status: 'done', final: reply, textLength: 11 } });
    expect(events().at(-2)).toMatchObject({ type: 'delta', at: 0, text: 'The answer.' });
    handle.text('late'); handle.step({ id: 'x', label: 'late' });
    expect(events().at(-1)).toBe(last); // finished: nothing more is sent
  });

  it('shapes every event and snapshot with the asker’s projection, so a role without See costs never receives money', () => {
    const { progress, events } = hub();
    const handle = progress.begin({ requestId: 'req-00000003', identityId: 'editor-1', question: 'Cost?', project: (event) => stripMoney(event) });
    handle.done({ conversation: { id: 'ask-2' }, message: { id: 'msg-a', content: 'Done.', receipt: { costUsd: 0.12, model: 'claude-opus-5-5' } } });
    expect(JSON.stringify(events())).not.toMatch(/costUsd|receipt/);
    expect(JSON.stringify(progress.snapshot('editor-1', 'req-00000003'))).not.toMatch(/costUsd|receipt/);
    const failed = progress.begin({ requestId: 'req-00000004', identityId: 'editor-1', project: (event) => stripMoney(event) });
    failed.failed({ message: 'The AI budget ($2.00) is below the estimate of $3.40.' });
    expect(events().at(-1).progress.error.message).not.toMatch(/\$/);
  });

  it('reads back only the caller’s own answers, running or finished in the last minute', () => {
    const { progress, tick } = hub();
    const mine = progress.begin({ requestId: 'req-00000005', identityId: 'person-a', question: 'Mine' });
    progress.begin({ requestId: 'req-00000006', identityId: 'person-b', question: 'Theirs' });
    mine.text('Partial');
    expect(progress.snapshot('person-a', 'req-00000005')).toMatchObject({ requestId: 'req-00000005', question: 'Mine', status: 'writing', text: 'Partial' });
    expect(progress.snapshot('person-b', 'req-00000005')).toBeNull();
    expect(progress.active('person-a').map((row) => row.requestId)).toEqual(['req-00000005']);
    mine.failed({ message: 'Stopped.', stopped: true, reply: { conversation: { id: 'ask-3' }, message: { id: 'm', content: 'Partial', stopped: true } } });
    expect(progress.snapshot('person-a', 'req-00000005')).toMatchObject({ status: 'stopped', final: { message: { stopped: true } }, error: { message: 'Stopped.' } });
    tick(61000);
    expect(progress.active('person-a')).toEqual([]);
    expect(progress.snapshot('person-a', 'req-00000005')).not.toBeNull(); // still readable until keepMs
  });

  it('reads back a channel owner’s answers only in the space they were asked from', () => {
    const { progress } = hub();
    // Riley asked as an editor (no space), then from Blog's channel role.
    progress.begin({ requestId: 'req-editor01', identityId: 'riley', question: 'Studio-wide' }).text('Studio-wide answer');
    progress.begin({ requestId: 'req-blog0001', identityId: 'riley', question: 'For Blog', space: 'blog' }).text('Blog answer');
    // As Blog's owner: only Blog's answer, by id or in the list.
    expect(progress.snapshot('riley', 'req-editor01', { space: 'blog' })).toBeNull();
    expect(progress.snapshot('riley', 'req-blog0001', { space: 'blog' })).toMatchObject({ text: 'Blog answer' });
    expect(progress.active('riley', { space: 'blog' }).map((row) => row.requestId)).toEqual(['req-blog0001']);
    // Moved on to Social: neither.
    expect(progress.snapshot('riley', 'req-blog0001', { space: 'social' })).toBeNull();
    expect(progress.active('riley', { space: 'social' })).toEqual([]);
    // As an editor again (no space): everything Riley has.
    expect(progress.active('riley').map((row) => row.requestId).sort()).toEqual(['req-blog0001', 'req-editor01']);
    expect(progress.snapshot('riley', 'req-editor01', { space: undefined })).toMatchObject({ text: 'Studio-wide answer' });
  });

  it('forgets finished answers after keepMs and keeps each person to their cap, never dropping one that is running', () => {
    const { progress, tick } = hub({ keepMs: 1000, maxPerPerson: 2 });
    const running = progress.begin({ requestId: 'req-run00001', identityId: 'p' });
    for (const id of ['req-done0001', 'req-done0002', 'req-done0003']) progress.begin({ requestId: id, identityId: 'p' }).done({});
    expect(progress.snapshot('p', 'req-run00001')).not.toBeNull();
    expect(progress.snapshot('p', 'req-done0001')).toBeNull(); // the oldest finished one gave way
    tick(1500); progress.begin({ requestId: 'req-new00001', identityId: 'p' });
    expect(progress.snapshot('p', 'req-done0003')).toBeNull();
    expect(progress.snapshot('p', 'req-run00001')).not.toBeNull();
    expect(running.finished()).toBe(false);
  });

  it('joins a running request and replaces a finished one under the same id', () => {
    const { progress } = hub();
    const first = progress.begin({ requestId: 'req-00000007', identityId: 'p', question: 'One' });
    const again = progress.begin({ requestId: 'req-00000007', identityId: 'p', question: 'Two' });
    again.title('Named');
    expect(progress.snapshot('p', 'req-00000007')).toMatchObject({ question: 'One', title: 'Named' });
    first.done({});
    progress.begin({ requestId: 'req-00000007', identityId: 'p', question: 'Three' });
    expect(progress.snapshot('p', 'req-00000007')).toMatchObject({ question: 'Three', status: 'starting', seq: 1 });
  });

  it('never lets a failing window stop the answer', () => {
    const progress = createAskProgress({ send: () => { throw new Error('window gone'); } });
    const handle = progress.begin({ requestId: 'req-00000008', identityId: 'p' });
    expect(() => { handle.step({ id: 'a', label: 'A' }); handle.done({}); }).not.toThrow();
  });
});
