import { describe, expect, it } from 'vitest';
import { copyableMarkdown, firstSentence, splitBlocks, stabilizeTail, streamDisplay, studioLinks } from '../src/renderer/src/ask-markdown.js';
import { matchSlash, parseSlash, slashAction, slashCommandsFor, ASK_SHORTCUTS, readStudioRef, studioRefDragProps, STUDIO_REF_TYPE } from '../src/renderer/src/ask-slash.js';
import { smartStarters, DEFAULT_STARTERS } from '../src/renderer/src/ask-starters.js';

// The pieces of Ask AI's streaming chat that are plain functions: Markdown that stays still while it is written, the /
// commands, and the suggestions built from the studio's state.
describe('streaming Markdown', () => {
  it('splits finished blocks from the one being written, keeping code fences and loose lists whole', () => {
    expect(splitBlocks('One.\n\nTwo\n\nThr')).toEqual({ stable: ['One.', 'Two'], tail: 'Thr' });
    const code = 'Intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter';
    expect(splitBlocks(code)).toEqual({ stable: ['Intro', '```js\nconst a = 1;\n\nconst b = 2;\n```'], tail: 'After' });
    expect(splitBlocks('- one\n\n- two\n\nNext para')).toEqual({ stable: ['- one\n\n- two'], tail: 'Next para' });
    expect(splitBlocks('Open fence\n\n```\ncode\n\nmore')).toEqual({ stable: ['Open fence'], tail: '```\ncode\n\nmore' });
  });

  it('makes the block being written safe to render', () => {
    expect(stabilizeTail('```js\nconst a')).toBe('```js\nconst a\n```');
    expect(stabilizeTail('Read [[Zero-cli')).toBe('Read **Zero-cli**');
    expect(stabilizeTail('See [[')).toBe('See ');
    expect(stabilizeTail('See [the guide](https://docs.exa')).toBe('See the guide');
    expect(stabilizeTail('See [the gui')).toBe('See the gui');
    expect(stabilizeTail('This is **bold')).toBe('This is **bold**');
    expect(stabilizeTail('Run `npm')).toBe('Run `npm`');
    expect(stabilizeTail('An *aside')).toBe('An *aside*');
    expect(stabilizeTail('- first\n- ')).toBe('- first');
    expect(stabilizeTail('Heading next\n##')).toBe('Heading next');
    expect(stabilizeTail('| Trend | Posts |\n| --')).toBe('');
    expect(stabilizeTail('| Trend | Posts |\n| --- | --- |\n| AI | 12 |\n| Zero')).toBe('| Trend | Posts |\n| --- | --- |\n| AI | 12 |');
    expect(stabilizeTail('* list item with **bold** done')).toBe('* list item with **bold** done');
  });

  it('shows links while streaming the way the finished answer will', () => {
    expect(streamDisplay('Read [[Zero-click]] and [the report](studio:report/a-1), see [docs](https://x.io/a).')).toBe('Read **Zero-click** and **the report**, see docs.');
    expect(studioLinks('Read [the report](studio:report/a-1).').text).toBe(streamDisplay('Read [the report](studio:report/a-1).'));
    expect(copyableMarkdown('Open [the report](studio:report/a-1) or [[Trend A]], then [docs](https://x.io).')).toBe('Open the report or Trend A, then [docs](https://x.io).');
    expect(firstSentence('**Two trends** moved. Then more.')).toBe('Two trends moved.');
    expect(firstSentence('x'.repeat(300)).length).toBe(160);
  });
});

describe('/ commands', () => {
  it('offers only what this role can use, and filters as they type', () => {
    const editor = slashCommandsFor({ can: (method) => method !== 'startQuickScan' && method !== 'createHelpImage', imagesReady: true, memoryOn: true });
    expect(editor.map((row) => row.id)).not.toContain('scan');
    expect(editor.map((row) => row.id)).not.toContain('picture');
    expect(slashCommandsFor({ imagesReady: false, memoryOn: false }).map((row) => row.id)).toEqual(['scan', 'summarize', 'report', 'trend', 'draft', 'new', 'help']);
    expect(matchSlash('/re').map((row) => row.id)).toEqual(['report', 'remember']);
    expect(matchSlash('/scan AI')).toBeNull();
    expect(matchSlash('hello')).toBeNull();
  });

  it('turns a command into a question, an attachment, a memory or a local action, and never into paid work', () => {
    const run = (text, options) => slashAction(parseSlash(text), options);
    expect(run('/scan AI Overviews')).toEqual({ ask: 'Plan a quick scan on AI Overviews' });
    expect(run('/scan')).toEqual({ needs: expect.stringContaining('/scan AI Overviews') });
    expect(run('/draft linkedin about zero click')).toEqual({ ask: 'Draft a LinkedIn post about zero click' });
    expect(run('/draft slack', { attached: 'Zero-click report' })).toEqual({ ask: 'Draft a Slack post about “Zero-click report”' });
    expect(run('/draft fax')).toEqual({ needs: expect.stringContaining('/draft slack') });
    expect(run('/report Zero-click')).toEqual({ attach: { kind: 'report', query: 'Zero-click' } });
    expect(run('/remember Keep posts short')).toEqual({ remember: 'Keep posts short' });
    expect(run('/memory')).toEqual({ open: 'memory' });
    expect(run('/new')).toEqual({ reset: true });
    expect(run('/help')).toEqual({ help: true });
    expect(parseSlash('/nonsense')).toBeNull();
    expect(ASK_SHORTCUTS.map((row) => row.keys)).toEqual(['Enter', '⇧Enter', '↑', 'Esc', '/']);
  });

  it('carries a dragged report as a studio reference', () => {
    const props = studioRefDragProps({ kind: 'report', ref: ' Zero-click report ', id: 'asset-1' });
    const data = {}; const transfer = { setData: (type, value) => { data[type] = value; }, getData: (type) => data[type] || '', types: [] };
    props.onDragStart({ dataTransfer: transfer });
    expect(JSON.parse(data[STUDIO_REF_TYPE])).toEqual({ kind: 'report', ref: 'Zero-click report', id: 'asset-1' });
    expect(transfer.effectAllowed).toBe('copy');
    expect(readStudioRef(transfer)).toEqual({ kind: 'report', ref: 'Zero-click report', id: 'asset-1' });
    props.onDragEnd();
    expect(readStudioRef({ getData: () => JSON.stringify({ kind: 'secret', ref: 'x' }) })).toBeNull();
    expect(studioRefDragProps({ kind: 'report', ref: '' })).toEqual({});
  });
});

describe('suggestions from the studio', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const state = { contentStudio: { activeWorkspaceId: 'w', researchRuns: [
    { id: 'r1', workspaceId: 'w', title: 'Weekly listening', status: 'awaiting-review', createdAt: '2026-10-16T09:00:00Z', discoveredThemes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], decisions: {} },
    { id: 'r2', workspaceId: 'w', title: 'Morning scan', status: 'failed', createdAt: '2026-10-15T09:00:00Z', updatedAt: '2026-10-15T09:00:00Z' },
  ], assets: [{ id: 'x', workspaceId: 'w', kind: 'text', title: 'Zero-click report', createdAt: '2026-10-16T10:00:00Z' }], programs: [{ id: 'p', workspaceId: 'w', name: 'Weekly listening', schedule: { enabled: true, frequency: 'weekly' } }] } };

  it('builds role-gated questions from what is happening, then the usual starters', () => {
    const all = smartStarters({ state, now, imagesReady: true, max: 6 });
    expect(all.slice(0, 5)).toEqual(['What changed in “Weekly listening”?', 'Which of the 2 waiting trends are worth a report?', 'Summarize “Zero-click report” for Slack', 'Why did “Morning scan” stop?', 'When does “Weekly listening” run next?']);
    const reader = smartStarters({ state, now, can: (method) => method === 'readStudioAsset', max: 4 });
    expect(reader[0]).toBe('Summarize “Zero-click report” for Slack');
    expect(reader).not.toContain('Which of the 2 waiting trends are worth a report?');
  });

  it('falls back to the static starters, without picture ones while pictures are off', () => {
    expect(smartStarters({ state: null, imagesReady: true })).toEqual([...DEFAULT_STARTERS]);
    expect(smartStarters({ state: null, imagesReady: false })).not.toContain('Create a hero image for my latest trend');
  });
});
