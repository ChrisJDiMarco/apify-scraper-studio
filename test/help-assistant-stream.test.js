import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// askHelp's streaming (src/main/help-assistant.js): the route's onStream events ({ type:'text', delta } for the answer,
// { type:'status', text }) become what the person sees through the progress handle. A round that asks to read
// something first never shows its "checking" line; lookups are steps in plain words; a route that can't stream shows
// its whole answer when the round ends; a stop keeps what was shown, with its links cleaned like an answer's.
const require = createRequire(import.meta.url);
const help = require('../src/main/help-assistant.js');

function recorder() {
  const log = []; let text = '';
  const progress = {
    step: (step) => log.push(['step', step.id, step.label, step.status]),
    text: (delta) => { text += delta; log.push(['text', delta]); },
    reset: () => { text = ''; log.push(['reset']); },
    title: (title) => log.push(['title', title]),
    status: (status) => log.push(['status', status]),
  };
  return { progress, log, text: () => text };
}
const base = (extra = {}) => ({ context: () => ({ layout: 'simple', role: 'admin' }), guide: 'Guide text https://docs.example.com/guide', ...extra });
const output = (answer, extra = {}) => ({ answer, pages: [], followUps: [], actions: [], cards: [], lookups: [], title: '', ...extra });

describe('Ask AI streaming', () => {
  it('streams a direct answer in pieces and ends at finishing with the title', async () => {
    const { progress, log, text } = recorder();
    const reply = await help.askHelp({ question: 'How do budgets work?' }, base({
      progress,
      generate: async ({ onStream, round }) => {
        expect(round).toBe(0);
        // A long first line is clearly the answer: it shows as soon as it passes the hold.
        const answer = `Budgets cap each run. ${'Every stage spends from the AI budget and stops when it runs out. '.repeat(3)}`;
        for (let at = 0; at < answer.length; at += 20) onStream({ type: 'text', delta: answer.slice(at, at + 20) });
        return { output: output(answer.trim(), { title: 'Budgets' }), receipt: {} };
      },
    }));
    expect(reply.answer).toMatch(/^Budgets cap each run\./);
    expect(text().trim()).toBe(reply.answer);
    const statuses = log.filter((row) => row[0] === 'status').map((row) => row[1]);
    expect(statuses).toEqual(['thinking', 'finishing']);
    expect(log).toContainEqual(['title', 'Budgets']);
    expect(log.filter((row) => row[0] === 'text').length).toBeGreaterThan(1);
    expect(log).toContainEqual(['step', 'think-0', 'Thinking', 'done']);
  });

  it('never shows a reading round’s checking line, and reads lookups as plain-language steps', async () => {
    const { progress, log, text } = recorder(); const reads = [];
    await help.askHelp({ question: 'What does the Zero-click report say?' }, base({
      progress,
      readLookup: (lookup) => { reads.push(lookup); return lookup.kind === 'report' ? { ...lookup, found: true, title: 'Zero-click report' } : { ...lookup, found: false }; },
      generate: async ({ onStream, round }) => {
        if (round === 0) {
          onStream({ type: 'text', delta: 'Let me check ' }); onStream({ type: 'text', delta: 'the report.' });
          return { output: output('Let me check the report.', { lookups: [{ kind: 'report', target: 'Zero-click report' }, { kind: 'trend', target: 'Missing trend' }] }), receipt: {} };
        }
        onStream({ type: 'text', delta: 'It says clicks fell.' });
        return { output: output('It says clicks fell.'), receipt: {} };
      },
    }));
    expect(reads).toEqual([{ kind: 'report', target: 'Zero-click report' }, { kind: 'trend', target: 'Missing trend' }]);
    expect(log.filter((row) => row[0] === 'text').map((row) => row[1])).toEqual(['It says clicks fell.']);
    expect(log).not.toContainEqual(['reset']); // nothing was shown, so nothing had to be withdrawn
    expect(log).toContainEqual(['step', 'lookup-0', 'Reading “Zero-click report”', 'running']);
    expect(log).toContainEqual(['step', 'lookup-0', 'Read “Zero-click report”', 'done']);
    expect(log).toContainEqual(['step', 'lookup-1', 'Couldn’t find “Missing trend”', 'failed']);
    expect(log.filter((row) => row[0] === 'status').map((row) => row[1])).toEqual(['thinking', 'reading', 'thinking', 'finishing']);
    expect(text()).toBe('It says clicks fell.');
  });

  it('withdraws text the route takes back, and a checking line that got long enough to show', async () => {
    const { progress, log, text } = recorder();
    await help.askHelp({ question: 'Explain' }, base({
      progress, readLookup: (lookup) => ({ ...lookup, found: true }),
      generate: async ({ onStream, round }) => {
        if (round === 0) {
          onStream({ type: 'text', delta: 'First try\n' }); onStream({ type: 'reset' });
          onStream({ type: 'text', delta: `${'A long checking line. '.repeat(10)}` });
          return { output: output('A long checking line.', { lookups: [{ kind: 'find', target: 'zero click' }] }), receipt: {} };
        }
        return { output: output('Final answer.'), receipt: {} }; // a route that never streamed
      },
    }));
    expect(log.filter((row) => row[0] === 'reset')).toHaveLength(2);
    expect(text()).toBe('Final answer.'); // shown whole when the round ended
  });

  it('shows a short answer that was held, once its round ends without lookups', async () => {
    const { progress, log } = recorder();
    await help.askHelp({ question: 'Hi' }, base({ progress, generate: async ({ onStream }) => { onStream({ type: 'text', delta: 'Hello.' }); onStream({ type: 'status', text: 'Waiting for the model' }); return { output: output('Hello.'), receipt: {} }; } }));
    expect(log.filter((row) => row[0] === 'text')).toEqual([['text', 'Hello.']]);
    expect(log).toContainEqual(['step', 'route-0', 'Waiting for the model', 'running']);
    expect(log).toContainEqual(['step', 'route-0', 'Connected', 'done']);
  });

  it('never names the model or connection to a channel owner while it writes', async () => {
    const { progress, log } = recorder();
    await help.askHelp({ question: 'Hi' }, base({ role: 'channel', context: () => ({ layout: 'channel', role: 'channel owner' }), progress, generate: async ({ onStream }) => { onStream({ type: 'status', text: 'Writing with Claude Opus 5.5 · Anthropic API' }); onStream({ type: 'text', delta: 'Hello.' }); return { output: output('Hello.'), receipt: {} }; } }));
    expect(log).toContainEqual(['step', 'route-0', 'Writing the answer', 'running']);
    expect(JSON.stringify(log)).not.toMatch(/Opus|Anthropic|Writing with/);
  });

  it('keeps what was shown when the answer stops, with [[links]] as words and unknown web links made inert', async () => {
    const { progress } = recorder();
    const failure = await help.askHelp({ question: 'Summarize' }, base({
      progress,
      generate: async ({ onStream }) => {
        onStream({ type: 'text', delta: `Read [[Zero-click report]] first.\nSee [the guide](https://docs.example.com/guide) and [a page](https://evil.example.net/x).\n` });
        throw Object.assign(new Error('Job cancelled.'), { code: 'CANCELLED' });
      },
    })).catch((error) => error);
    expect(failure.message).toBe('Job cancelled.');
    expect(failure.partial).toBe('Read Zero-click report first.\nSee [the guide](https://docs.example.com/guide) and a page.');
  });

  it('reads what was attached before the first round, and says so in the prompt only then', async () => {
    const { progress, log } = recorder(); const prompts = []; const reads = [];
    const reply = await help.askHelp({ question: 'What should we post about this?' }, base({
      progress, attached: [{ kind: 'report', ref: 'Zero-click report' }, { kind: 'nonsense', ref: 'x' }],
      readLookup: (lookup) => { reads.push(lookup); return { ...lookup, found: true, title: 'Zero-click report', text: 'Clicks fell.' }; },
      generate: async ({ prompt }) => { prompts.push(prompt); return { output: output('Post about the drop.'), receipt: {} }; },
    }));
    expect(reads).toEqual([{ kind: 'report', target: 'Zero-click report' }]);
    expect(log[0]).toEqual(['status', 'reading']);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('LOOKUP RESULTS below include what they attached to this question.');
    expect(prompts[0]).not.toContain('leave lookups empty');
    expect(reply.read).toEqual([{ kind: 'report', title: 'Zero-click report' }]);
    // Without attachments the prompt is exactly what it was.
    const plain = help.helpPromptParts({ question: 'Q', context: { layout: 'simple' }, lookups: [{ kind: 'report', target: 'X', found: true }] });
    expect(plain.body).toContain('- LOOKUP RESULTS are present below: answer from them and leave lookups empty.');
  });

  it('behaves exactly as before without a progress handle', async () => {
    const reply = await help.askHelp({ question: 'Hi' }, base({ generate: async ({ onStream }) => { onStream({ type: 'text', delta: 'Hello there.' }); return { output: output('Hello there.'), receipt: { costUsd: 0.01, provider: 'claude-api', actualModel: 'claude-opus-5-5' } }; } }));
    expect(reply).toMatchObject({ answer: 'Hello there.', receipt: { costUsd: 0.01, model: 'claude-opus-5-5', route: 'claude-api' } });
  });

  it('words each lookup step plainly, clipping names and never naming an amount', () => {
    expect(help.lookupLabel({ kind: 'asset', target: 'AI Overviews › LinkedIn post' })).toBe('Reading “LinkedIn post”');
    expect(help.lookupLabel({ kind: 'posts', target: 'zero click' }, 'missing')).toBe('No posts match “zero click”');
    expect(help.lookupLabel({ kind: 'find', target: 'x' }, 'found')).toBe('Searched the studio');
    expect(help.lookupLabel({ kind: 'spend', target: 'month' })).toBe('Adding up spending for this month');
    expect(help.lookupLabel({ kind: 'spend', target: 'over $40' })).toBe('Adding up spending for this period');
    expect(help.lookupLabel({ kind: 'report', target: 'A'.repeat(80) }).length).toBeLessThanOrEqual('Reading “”'.length + 60);
  });
});
