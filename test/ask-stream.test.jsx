// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAskStreamStore, reduceAskProgress, emptyProgress, useSmoothText } from '../src/renderer/src/ask-stream.js';

// The window side of streamed answers (src/renderer/src/ask-stream.js): events folded into one progress per request,
// a request read back whenever events may have been missed, and text revealed smoothly (or at once with reduced motion).
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const progress = (seq, body) => ({ type: 'progress', requestId: 'r1', conversationId: 'ask-1', seq, progress: body });
const delta = (seq, at, text) => ({ type: 'delta', requestId: 'r1', conversationId: 'ask-1', seq, at, text });

describe('folding events into progress', () => {
  it('adds text at its offset, ignores stale events, upserts steps and ends with the reply', () => {
    let state = emptyProgress('r1', { question: 'Q' });
    state = reduceAskProgress(state, progress(1, { status: 'starting', steps: [], textLength: 0 }));
    state = reduceAskProgress(state, delta(2, 0, 'Two trends'));
    state = reduceAskProgress(state, delta(3, 10, ' moved.'));
    expect(state).toMatchObject({ status: 'writing', text: 'Two trends moved.', seq: 3, gap: false });
    expect(reduceAskProgress(state, delta(2, 0, 'stale'))).toBe(state);
    state = reduceAskProgress(state, progress(4, { status: 'writing', steps: [{ id: 'a', label: 'Read “X”', status: 'done' }], textLength: 17 }));
    expect(state.steps).toEqual([{ id: 'a', label: 'Read “X”', status: 'done' }]);
    state = reduceAskProgress(state, progress(5, { status: 'done', steps: [], textLength: 17, final: { message: { id: 'm' } } }));
    expect(state).toMatchObject({ status: 'done', final: { message: { id: 'm' } } });
  });

  it('withdraws text on a shorter textLength and flags a gap when events were missed', () => {
    let state = reduceAskProgress(emptyProgress('r1'), progress(1, { status: 'starting', textLength: 0 }));
    state = reduceAskProgress(state, delta(2, 0, 'Let me check.'));
    state = reduceAskProgress(state, progress(3, { status: 'reading', textLength: 0 }));
    expect(state.text).toBe('');
    expect(reduceAskProgress(state, delta(5, 0, 'x')).gap).toBe(true); // seq 4 never arrived
    expect(reduceAskProgress(state, delta(4, 9, 'x')).gap).toBe(true); // text from beyond what arrived
    expect(reduceAskProgress(emptyProgress('r9'), { ...delta(30, 0, 'x'), requestId: 'r9' }).gap).toBe(true); // joined midway (another tab)
  });
});

describe('the stream store', () => {
  it('reads a request back when events were missed, adopting only a snapshot that is newer', async () => {
    let send = null;
    const api = { onAskStream: (fn) => { send = fn; return () => { send = null; }; }, readAskProgress: vi.fn(async () => ({ progress: { requestId: 'r1', status: 'writing', text: 'Two trends moved up.', steps: [], seq: 9 } })) };
    const store = createAskStreamStore(api, { pollMs: 0 });
    store.track('r1', { question: 'Q' });
    const heard = vi.fn(); store.subscribe('r1', heard);
    send(progress(1, { status: 'starting', textLength: 0 }));
    send(delta(4, 0, 'Two')); // seq 2 and 3 missed
    await vi.waitFor(() => expect(store.get('r1').text).toBe('Two trends moved up.'));
    expect(api.readAskProgress).toHaveBeenCalledWith({ requestId: 'r1' });
    expect(store.get('r1')).toMatchObject({ seq: 9, gap: false });
    store.adopt({ requestId: 'r1', status: 'writing', text: 'old', seq: 3 });
    expect(store.get('r1').text).toBe('Two trends moved up.');
    expect(heard).toHaveBeenCalled();
    store.dispose(); expect(send).toBeNull();
  });

  it('resyncs every live request when the stream asks, hands follow-ups to onAny, and settles a request its call finished', async () => {
    let send = null;
    const api = { onAskStream: (fn) => { send = fn; return () => {}; }, readAskProgress: vi.fn(async ({ requestId }) => ({ progress: { requestId, status: 'done', text: 'Done.', steps: [], seq: 12, final: { message: { id: 'm' } } } })) };
    const store = createAskStreamStore(api, { pollMs: 0 });
    store.track('r1'); store.track('r2'); store.settle('r2', 'done', { message: { id: 'x' } });
    const any = vi.fn(); store.onAny(any);
    send({ type: 'followup', conversationId: 'ask-1', messageId: 'msg-1' });
    expect(any).toHaveBeenCalledWith({ type: 'followup', conversationId: 'ask-1', messageId: 'msg-1' }, null);
    send({ type: 'resync' });
    await vi.waitFor(() => expect(store.get('r1').status).toBe('done'));
    expect(api.readAskProgress.mock.calls.map(([payload]) => payload.requestId)).toEqual(['r1']); // r2 was already final
    expect(store.get('r2')).toMatchObject({ status: 'done', final: { message: { id: 'x' } } });
  });

  it('polls a live request that has heard nothing, which covers a dropped stream', async () => {
    vi.useFakeTimers();
    let clock = 0;
    const api = { onAskStream: () => () => {}, readAskProgress: vi.fn(async () => ({ progress: null })) };
    const store = createAskStreamStore(api, { pollMs: 4000, now: () => clock });
    store.track('r1');
    clock = 4500; await vi.advanceTimersByTimeAsync(2000);
    expect(api.readAskProgress).toHaveBeenCalledWith({ requestId: 'r1' });
    store.dispose();
  });
});

function Reveal({ target, live, reduced }) {
  const { text, done } = useSmoothText(target, { live, reduced });
  return <p data-testid="shown" data-done={String(done)}>{text}</p>;
}
describe('smooth text', () => {
  it('shows everything at once with reduced motion', () => {
    const { rerender } = render(<Reveal target="" live reduced />);
    rerender(<Reveal target="Two trends moved up this week." live reduced />);
    expect(screen.getByTestId('shown')).toHaveTextContent('Two trends moved up this week.');
    expect(screen.getByTestId('shown').dataset.done).toBe('true');
  });

  it('reveals new text over a few frames, whole words at a time, and snaps back when text is withdrawn', async () => {
    let frames = [];
    vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const run = (time) => act(() => { const queued = frames; frames = []; queued.forEach((fn) => fn(time)); });
    const { rerender } = render(<Reveal target="" live />);
    rerender(<Reveal target="Two trends moved up this week, and one more." live />);
    expect(screen.getByTestId('shown').textContent).toBe('');
    run(16);
    const first = screen.getByTestId('shown').textContent;
    expect(first.length).toBeGreaterThan(0);
    expect('Two trends moved up this week, and one more.'.startsWith(first)).toBe(true);
    expect(/\s$|^\S+$|[,.]$/.test(first) || first.endsWith(' ') || 'Two trends moved up this week, and one more.'[first.length] === ' ').toBe(true);
    for (let time = 32; time < 2000; time += 16) run(time);
    expect(screen.getByTestId('shown').textContent).toBe('Two trends moved up this week, and one more.');
    rerender(<Reveal target="Two trends" live />);
    expect(screen.getByTestId('shown').textContent).toBe('Two trends');
    vi.unstubAllGlobals();
  });
});
