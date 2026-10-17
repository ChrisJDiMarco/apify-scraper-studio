// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { createRequire } from 'node:module';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptLibrary, PromptDiff, checkBlock, matchPrompt, promptParts, runsOn } from '../src/renderer/src/prompt-library.jsx';
import { ChatCards, PromptChangeCard, cardActionIndexes } from '../src/renderer/src/chat-cards.jsx';
import { useStudioActions } from '../src/renderer/src/studio-actions.js';
import { ViewerContext } from '../src/renderer/src/viewer.js';

// The Prompts page against an api that keeps prompts in memory with the real registry, defaults and checks
// (src/shared/prompt-template.js), so what the page shows is what the server would say.
const require = createRequire(import.meta.url);
const template = require('../src/shared/prompt-template.js');
const EDITION = 'semrush';
const REGISTRY = template.registryFor(EDITION);
const entryOf = (id) => REGISTRY.prompts.find((entry) => entry.id === id);
const ADMIN = { id: 'local', name: 'Alex', role: 'admin', base: 'admin', web: false };
const EDITOR = { id: 'm-sam', name: 'Sam', role: 'editor', base: 'editor', web: true, allowed: ['listPrompts', 'readPrompt', 'previewPrompt', 'diffPromptVersions', 'estimatePromptTest', 'savePromptVersion', 'revertPrompt', 'testPrompt', 'askHelp', 'cancelJob'] };
const READER = { ...EDITOR, allowed: ['listPrompts', 'readPrompt', 'previewPrompt', 'diffPromptVersions'] };

function fakeApi({ locked = {}, saved = {} } = {}) {
  const store = Object.fromEntries(REGISTRY.prompts.map((entry) => [entry.id, { version: 0, blocks: {}, history: [], locked: Boolean(locked[entry.id]), tests: [] }]));
  for (const [id, blocks] of Object.entries(saved)) { store[id].version = 1; store[id].blocks = blocks; store[id].history = [{ version: 1, at: '2026-10-15T14:00:00.000Z', by: { id: 'm-riley', name: 'Riley', role: 'editor' }, source: 'library', note: 'First pass', revertOf: null, conversationId: '', blockIds: Object.keys(blocks) }]; }
  let role = 'admin';
  const row = (entry) => ({ id: entry.id, name: entry.name, group: entry.group, description: entry.description, powers: entry.powers, editable: entry.blocks.some((block) => block.editable), version: store[entry.id].version, custom: Object.keys(store[entry.id].blocks).length > 0, locked: store[entry.id].locked, updatedAt: store[entry.id].history[0]?.at || '', updatedBy: store[entry.id].history[0]?.by || null, defaultChanged: false });
  const read = (id) => {
    const entry = entryOf(id); const doc = store[id]; const defaults = template.defaultsFor(id, EDITION);
    return { prompt: entry, editionId: EDITION, blocks: template.blocksFor(id, EDITION, doc.blocks), defaults, customized: Object.keys(doc.blocks), defaultChanged: [], version: doc.version, locked: doc.locked, lock: doc.locked ? { locked: true, at: '2026-10-14T10:00:00.000Z', by: { name: 'Alex' } } : null, lockedForYou: doc.locked && role !== 'admin', updatedAt: doc.history[0]?.at || '', updatedBy: doc.history[0]?.by || null, history: [...doc.history], tests: [...doc.tests], damaged: false, model: 'claude-opus-5-5', modelLabel: 'Claude Opus 5.5', effort: 'medium', route: 'claude', metered: true, testable: entry.test?.kind === 'text' || entry.test?.kind === 'image' };
  };
  const fail = (message, extra = {}) => Object.assign(new Error(message), extra);
  const api = {
    setRole: (next) => { role = next; },
    store,
    listPrompts: vi.fn(async () => ({ editionId: EDITION, groups: REGISTRY.groups, prompts: REGISTRY.prompts.map(row) })),
    readPrompt: vi.fn(async ({ id }) => read(id)),
    previewPrompt: vi.fn(async ({ id, blocks }) => { const text = `SYSTEM INSTRUCTIONS\n${template.blocksFor(id, EDITION, { ...store[id].blocks, ...(blocks || {}) }).role || 'Prompt text'}\n\nTASK\nPosts go here.`; const end = text.indexOf('\n\nTASK'); return { id, text, segments: [{ start: 20, end, blockId: 'role' }], chars: text.length, tokens: Math.ceil(text.length / 4), estimateUsd: 0.12, sampleLabel: 'Sample data (made-up posts)', sample: 'bundled', problems: blocks ? template.validateBlocks(id, EDITION, blocks) : [], kind: 'text', model: 'claude-opus-5-5', modelLabel: 'Claude Opus 5.5', effort: 'medium', route: 'claude', metered: true }; }),
    diffPromptVersions: vi.fn(async ({ id, from, to, draft }) => {
      const side = (value) => (value === 'draft' ? { ...template.blocksFor(id, EDITION, store[id].blocks), ...draft } : value === 0 ? template.blocksFor(id, EDITION) : template.blocksFor(id, EDITION, value === 'current' || value === store[id].version ? store[id].blocks : {}));
      const a = side(from); const b = side(to);
      return { from, to, blocks: entryOf(id).blocks.filter((block) => block.editable && a[block.id] !== b[block.id]).map((block) => ({ blockId: block.id, label: block.label, lines: template.lineDiff(a[block.id], b[block.id]) })) };
    }),
    savePromptVersion: vi.fn(async ({ id, blocks, expectedVersion, note, source = 'library', conversationId = '' }) => {
      const doc = store[id];
      if (expectedVersion !== doc.version) throw fail(`Riley saved version ${doc.version} of “${entryOf(id).name}” at Oct 15, 2:00 PM EDT, after you opened it. Reopen the prompt to see their change, then try again.`, { status: 409 });
      if (doc.locked && role !== 'admin') throw fail('An admin locked it.', { status: 403 });
      if (!String(note || '').trim()) throw fail('Add a short note saying what you changed and why.', { status: 400 });
      const problems = template.validateBlocks(id, EDITION, blocks);
      if (problems.length) throw fail(problems.length === 1 ? problems[0].message : `This change has ${problems.length} problems to fix first.`, { status: 400 });
      doc.version += 1; doc.blocks = { ...doc.blocks, ...blocks };
      doc.history.unshift({ version: doc.version, at: new Date().toISOString(), by: { id: 'local', name: 'Alex', role }, source, note, revertOf: null, conversationId, blockIds: Object.keys(blocks) });
      return { version: doc.version, changed: true, prompt: row(entryOf(id)), detail: read(id) };
    }),
    revertPrompt: vi.fn(async ({ id, toVersion, expectedVersion }) => { const doc = store[id]; if (expectedVersion !== doc.version) throw fail('Changed.', { status: 409 }); doc.version += 1; doc.blocks = toVersion === 0 ? {} : doc.blocks; doc.history.unshift({ version: doc.version, at: new Date().toISOString(), by: { name: 'Alex' }, source: 'restore', note: toVersion ? `Restored version ${toVersion}` : 'Restored the default', revertOf: toVersion, blockIds: [] }); return { version: doc.version, changed: true, prompt: row(entryOf(id)), detail: read(id) }; }),
    setPromptLock: vi.fn(async ({ id, locked: next }) => { store[id].locked = next; return read(id); }),
    estimatePromptTest: vi.fn(async ({ id }) => ({ id, kind: 'text', available: true, reason: '', sample: 'bundled', sampleLabel: 'Sample data (made-up posts)', problems: [], model: 'claude-opus-5-5', modelLabel: 'Claude Opus 5.5', effort: 'medium', route: 'claude-api', metered: true, chars: 900, tokens: 225, estimateUsd: 0.21, capUsd: 0.63, fingerprint: 'fp-1', note: '' })),
    testPrompt: vi.fn(async () => ({ testId: 'ptest-1', ok: true, status: 'passed', problems: [], output: { candidates: [{ name: 'AI Overviews rollout' }] }, receipt: { costUsd: 0.18, model: 'claude-opus-5-5', route: 'claude-api', metered: true, effort: 'medium' }, chars: 900, durationMs: 4200, sampleLabel: 'Sample data (made-up posts)', test: {} })),
    cancelJob: vi.fn(async () => ({})),
  };
  return api;
}
const STATE = { contentStudio: { activeWorkspaceId: 'semrush', promptChanges: [] }, team: { admins: [{ name: 'Alex' }] }, jobs: [] };
function page({ api = fakeApi(), viewer = ADMIN, state = STATE, ...props } = {}) {
  const confirmed = vi.spyOn(window, 'confirm').mockImplementation(() => true);
  const utils = render(<ViewerContext.Provider value={viewer}><PromptLibrary api={api} state={state} onNotice={props.onNotice || (() => {})} {...props} /></ViewerContext.Provider>);
  return { api, confirmed, ...utils };
}
const openPrompt = async (name) => { fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) })); return screen.findByRole('heading', { level: 2, name }); };

afterEach(() => { cleanup(); vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } });

describe('checks that match the server', () => {
  it('says what the server says for the same edit', () => {
    const entry = entryOf('research.discovery'); const fields = entry.blocks.find((block) => block.id === 'fields');
    const original = template.defaultText('research.discovery', 'fields', EDITION);
    const drafts = ['Return names only.', `${original}\n{{brand}} and {{nope}}`, `${original} {{ stray`, `${original}\nRAW DATA BATCH`, ''];
    for (const draft of drafts) expect(checkBlock(fields, draft, original)).toEqual(template.validateBlocks('research.discovery', EDITION, { fields: draft }).map((problem) => problem.message));
    const variations = entryOf('pictures.variations').blocks[0];
    expect(checkBlock(variations, 'One line only', '')).toEqual(template.validateBlocks('pictures.variations', EDITION, { [variations.id]: 'One line only' }).map((problem) => problem.message));
    expect(checkBlock(fields, original, original)).toEqual([]);
  });
  it('finds prompts by name, use or id, and says what each runs on', () => {
    const row = { id: 'research.discovery', name: 'Find candidate trends', description: 'Reads posts', powers: ['Quick scans'] };
    expect(matchPrompt(row, 'quick candidate')).toBe(true);
    expect(matchPrompt(row, 'research.discovery')).toBe(true);
    expect(matchPrompt(row, 'toolkit')).toBe(false);
    expect(runsOn({ model: 'claude-opus-5-5', modelLabel: 'Claude Opus 5.5', effort: 'medium', route: 'claude' })).toBe('Runs on Claude Opus 5.5 · medium effort');
    expect(runsOn({ model: 'x', route: 'codex' })).toBe('Runs on Codex (not metered)');
    expect(runsOn({ route: 'openai', modelLabel: 'OpenAI gpt-image-2.5-flare' })).toBe('Draws with OpenAI gpt-image-2.5-flare');
    expect(runsOn({ model: '', prompt: { group: 'system' } })).toBe('Sent with the studio’s AI calls');
  });
  it('lays a prompt out in order, with the parts the studio picks case by case after it', () => {
    const { parts, rest } = promptParts(entryOf('data.dataset-report'));
    expect(parts.map((part) => part.kind)).toEqual(['fixed', 'block', 'fixed', 'data']);
    expect(rest.map((block) => block.id)).toContain('preset-market-scan');
  });
  it('draws a diff with words for each change and folds long unchanged runs', () => {
    const lines = [...Array.from({ length: 8 }, (_, index) => ({ op: 'same', text: `line ${index}` })), { op: 'del', text: 'old rule' }, { op: 'add', text: 'new rule' }];
    render(<PromptDiff lines={lines} label="Changes to Critical rules" />);
    expect(screen.getByRole('list', { name: 'Changes to Critical rules: 1 line added, 1 line removed' })).toBeInTheDocument();
    expect(screen.getByText('Removed:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 6 unchanged lines' }));
    expect(screen.getByText('line 0')).toBeInTheDocument();
  });
});

describe('the Prompts page', () => {
  it('lists prompts by group with their badges and finds them by search', async () => {
    const api = fakeApi({ saved: { 'research.matching': { role: 'You match {{subject}} trends.' } }, locked: { 'reports.trends-report': true } });
    page({ api });
    const list = await screen.findByRole('navigation', { name: 'All prompts' });
    expect(within(list).getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual(REGISTRY.groups.map((group) => group.label));
    expect(within(list).getByRole('button', { name: /Match trends you already track.*Customized · v1 · Riley/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Trends report.*Locked/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Claude system prompt.*View only/i })).toBeInTheDocument();
    fireEvent.change(within(list).getByRole('searchbox', { name: 'Search prompts' }), { target: { value: 'nothing like this' } });
    expect(within(list).getByText('No prompt matches “nothing like this”.')).toBeInTheDocument();
  });
  it('shows the prompt in order and saves an edit as a new version with a note', async () => {
    const onNotice = vi.fn();
    const { api } = page({ onNotice });
    await openPrompt('Find candidate trends');
    expect(screen.getByText('Runs on Claude Opus 5.5 · medium effort', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('SYSTEM INSTRUCTIONS')).toBeInTheDocument(); // a fixed part, with its reason
    expect(screen.getAllByText('Data from the run goes here.').length).toBeGreaterThan(0);
    const field = screen.getByRole('textbox', { name: 'What to return for each trend' });
    const original = field.value;
    fireEvent.change(field, { target: { value: 'Return names only.' } });
    expect(await screen.findByText('What to return for each trend must keep {{painPoints}}: the studio fills it in for every run.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as version 1…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Reset this block/ }));
    expect(field.value).toBe(original);
    const empty = screen.getByRole('textbox', { name: 'When nothing qualifies' });
    fireEvent.change(empty, { target: { value: 'Return no candidates unless two posts back a trend.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as version 1…' }));
    const dialog = await screen.findByRole('dialog', { name: /Version 1 of “Find candidate trends”/ });
    expect(await within(dialog).findByRole('list', { name: /Changes to When nothing qualifies: 1 line added, 1 line removed/ })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as version 1' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Add a short note');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note for the history' }), { target: { value: 'Two posts per trend' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as version 1' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Saved version 1 of “Find candidate trends”.'));
    expect(api.savePromptVersion).toHaveBeenCalledWith({ id: 'research.discovery', blocks: { empty: 'Return no candidates unless two posts back a trend.' }, expectedVersion: 0, note: 'Two posts per trend', source: 'library' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('inserts a value where the cursor is', async () => {
    page();
    await openPrompt('Find candidate trends');
    const field = screen.getByRole('textbox', { name: 'Who the AI is' });
    field.setSelectionRange(0, 0);
    fireEvent.click(screen.getAllByRole('button', { name: /^Insert \{\{brand\}\}/ })[0]);
    expect(field.value.startsWith('{{brand}}')).toBe(true);
  });
  it('tells someone a save came after theirs, and keeps their edits', async () => {
    const api = fakeApi();
    page({ api });
    await openPrompt('Find candidate trends');
    api.store['research.discovery'].version = 2; // Riley saved twice meanwhile
    fireEvent.change(screen.getByRole('textbox', { name: 'When nothing qualifies' }), { target: { value: 'Return nothing.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as version 1…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note for the history' }), { target: { value: 'Shorter' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as version 1' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('after you opened it');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload the prompt (your edits stay)' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save as version 3…' })).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'When nothing qualifies' }).value).toBe('Return nothing.');
  });
  it('shows a locked prompt read-only to an editor, and a prompt read-only to a role that can’t edit', async () => {
    const api = fakeApi({ locked: { 'research.discovery': true } }); api.setRole('editor');
    const first = page({ api, viewer: EDITOR });
    await openPrompt('Find candidate trends');
    expect(screen.getByRole('note')).toHaveTextContent('Locked by an admin (Alex, Oct 14). Ask Alex to change it.');
    expect(screen.getByRole('textbox', { name: 'Who the AI is' })).toHaveAttribute('readonly');
    first.unmount();
    page({ api: fakeApi(), viewer: READER });
    await openPrompt('Find candidate trends');
    expect(screen.getByRole('note')).toHaveTextContent('Your role can see prompts but not change them.');
  });
  it('previews the real prompt with the editable part marked, and test-runs it after the price is confirmed', async () => {
    const { api, confirmed } = page();
    await openPrompt('Find candidate trends');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(await screen.findByText(/about \$0\.12 per call/)).toBeInTheDocument();
    expect(document.querySelector('mark.pl-mark')).toHaveAttribute('title', 'Who the AI is');
    fireEvent.click(screen.getByRole('button', { name: 'Test run…' }));
    await waitFor(() => expect(api.testPrompt).toHaveBeenCalledWith({ id: 'research.discovery', sample: 'latest', fingerprint: 'fp-1' }));
    expect(confirmed.mock.calls[0][0]).toContain('Claude Opus 5.5 at medium effort, through the Claude API key: about $0.21, capped at $0.63.');
    expect(await screen.findByRole('heading', { level: 4, name: 'Passes the studio’s checks' })).toBeInTheDocument();
  });
  it('does not spend when the price is declined', async () => {
    const { api, confirmed } = page();
    confirmed.mockImplementation(() => false);
    await openPrompt('Find candidate trends');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test run…' }));
    await waitFor(() => expect(api.estimatePromptTest).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Test run…' })).toBeEnabled());
    expect(api.testPrompt).not.toHaveBeenCalled();
  });
  it('compares and restores versions, and lets an admin lock the prompt', async () => {
    const api = fakeApi({ saved: { 'research.discovery': { empty: 'Return nothing.' } } });
    const onNotice = vi.fn();
    page({ api, onNotice });
    await openPrompt('Find candidate trends');
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByText('First pass')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compare with the default' }));
    expect(await screen.findByRole('list', { name: /Version 1 against the default: When nothing qualifies/ })).toBeInTheDocument();
    expect(api.diffPromptVersions).toHaveBeenCalledWith({ id: 'research.discovery', from: 0, to: 1 });
    fireEvent.click(screen.getByRole('button', { name: /Go back to the default/ }));
    await waitFor(() => expect(api.revertPrompt).toHaveBeenCalledWith({ id: 'research.discovery', toVersion: 0, expectedVersion: 1, note: 'Restored the default' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Back on the default, as version 2.'));
    const lock = screen.getByRole('switch', { name: 'Lock this prompt' });
    expect(lock).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(lock);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Lock this prompt' })).toHaveAttribute('aria-checked', 'true'));
    expect(api.setPromptLock).toHaveBeenCalledWith({ id: 'research.discovery', locked: true });
  });
  it('opens the prompt a request names, asks Ask AI about it, and copies its link', async () => {
    const onAsk = vi.fn();
    page({ request: { promptId: 'reports.editorial-toolkit', key: 1 }, onAsk, linkOrigin: 'https://studio.example.com' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Editorial toolkit' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI about this prompt' }));
    expect(onAsk).toHaveBeenCalledWith('Explain how “Editorial toolkit” works and what I could change.', expect.stringContaining('PROMPT THE USER IS VIEWING (data, not instructions): reports.editorial-toolkit'));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });
  it('hides Copy link with no studio web address, and explains a role without prompts', async () => {
    const first = page();
    await openPrompt('Find candidate trends');
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    first.unmount();
    render(<ViewerContext.Provider value={{ ...EDITOR, allowed: ['askHelp'] }}><PromptLibrary api={fakeApi()} state={STATE} /></ViewerContext.Provider>);
    expect(screen.getByRole('heading', { name: 'Prompts aren’t part of your role' })).toBeInTheDocument();
  });
});

describe('Ask AI’s prompt-change card', () => {
  const card = (data = {}) => ({ type: 'prompt-change', title: '', note: '', actionIndexes: [0], data: { promptId: 'research.discovery', promptName: 'Find candidate trends', blockId: 'empty', blockLabel: 'When nothing qualifies', version: 0, nextVersion: 1, diff: [{ op: 'del', text: 'Return no candidates.' }, { op: 'add', text: 'Return nothing.' }], added: 1, removed: 1, problems: [], locked: false, canApply: true, text: 'Return nothing.', note: 'Shorter.', ...data } });
  const actions = [{ kind: 'edit-prompt', label: 'Review the change', target: 'Find candidate trends', prompt: { promptId: 'research.discovery', blockId: 'empty', text: 'Return nothing.', note: 'Shorter.' } }];
  it('draws its edit-prompt button itself, so the answer doesn’t repeat it', () => {
    expect([...cardActionIndexes([card()], actions)]).toEqual([0]);
  });
  it('applies the change as the next version, credited to Ask AI and the conversation, and records it', async () => {
    const api = { savePromptVersion: vi.fn(async () => ({ version: 1, changed: true })) };
    const onOutcome = vi.fn(); const openPrompt = vi.fn();
    render(<ChatCards cards={[card()]} actions={actions} onOutcome={onOutcome} onNav={{ openPrompt }} api={api} state={STATE} conversationId="ask-123" />);
    expect(screen.getByRole('list', { name: 'Changes to When nothing qualifies: 1 line added, 1 line removed' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply as version 1' }));
    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith(0, { status: 'done', text: 'Saved as version 1 of “Find candidate trends”.' }));
    expect(api.savePromptVersion).toHaveBeenCalledWith({ id: 'research.discovery', blocks: { empty: 'Return nothing.' }, expectedVersion: 0, note: 'Shorter.', source: 'ask-ai', conversationId: 'ask-123' });
    fireEvent.click(screen.getByRole('button', { name: 'Open in Prompts' }));
    expect(openPrompt).toHaveBeenCalledWith('research.discovery');
  });
  it('can’t be applied with problems, when locked for this person, or after a newer save', () => {
    const api = { savePromptVersion: vi.fn() };
    const { unmount } = render(<PromptChangeCard card={card({ canApply: false, problems: ['When nothing qualifies must keep {{x}}.'] })} actions={actions} actionState={{}} onNav={{}} api={api} state={STATE} />);
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
    expect(screen.getByRole('list', { name: 'Why it can’t be applied yet' })).toHaveTextContent('must keep {{x}}');
    unmount();
    const locked = render(<PromptChangeCard card={card({ canApply: false, locked: true })} actions={actions} actionState={{}} onNav={{}} api={api} state={STATE} />);
    expect(screen.getByText(/only an admin can apply the change/)).toBeInTheDocument();
    locked.unmount();
    render(<PromptChangeCard card={card()} actions={actions} actionState={{}} onNav={{}} api={api} state={{ ...STATE, contentStudio: { ...STATE.contentStudio, promptChanges: [{ promptId: 'research.discovery', version: 2, current: true, byName: 'Riley' }] } }} />);
    expect(screen.getByRole('button', { name: 'Apply as version 1' })).toBeDisabled();
    expect(screen.getByText(/Riley saved version 2 after this suggestion/)).toBeInTheDocument();
  });
  it('shows what was applied when the conversation is reopened', () => {
    render(<PromptChangeCard card={card()} actions={actions} actionState={{ 0: { status: 'done', text: 'Saved as version 1 of “Find candidate trends”.' } }} onNav={{}} api={{ savePromptVersion: vi.fn() }} state={STATE} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved as version 1');
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
  });
});

describe('the edit-prompt button without its card', () => {
  function Harness({ api, onReady, confirm }) {
    const actions = useStudioActions({ api, state: STATE, confirm, viewer: ADMIN, can: () => true, canRun: () => true });
    onReady(actions);
    return null;
  }
  it('shows what changes, then saves it as the next version', async () => {
    const api = fakeApi(); let actions = null; const confirm = vi.fn(async () => true);
    render(<Harness api={api} confirm={confirm} onReady={(value) => { actions = value; }} />);
    let result;
    await act(async () => { result = await actions.runAiAction({ kind: 'edit-prompt', target: 'Find candidate trends', conversationId: 'ask-9', prompt: { promptId: 'research.discovery', blockId: 'empty', text: 'Return nothing.', note: 'Shorter.' } }); });
    expect(confirm.mock.calls[0][0]).toMatchObject({ title: 'Save this change to “Find candidate trends”?', confirmLabel: 'Save as version 1' });
    expect(confirm.mock.calls[0][0].lines[0]).toBe('When nothing qualifies: 1 line added, 1 line removed.');
    expect(api.savePromptVersion).toHaveBeenCalledWith({ id: 'research.discovery', blocks: { empty: 'Return nothing.' }, expectedVersion: 0, note: 'Shorter.', source: 'ask-ai', conversationId: 'ask-9' });
    expect(result).toBe('Saved as version 1 of “Find candidate trends”.');
  });
  it('asks whether a retry should use prompts saved since the run started', async () => {
    const api = { retryStudioRun: vi.fn(async () => ({})) };
    const state = { contentStudio: { activeWorkspaceId: 'semrush', researchRuns: [{ id: 'run-1', title: 'Weekly listening', status: 'failed', workspaceId: 'semrush', maxBudgetUsd: 10, reservedUsd: 2, prompts: { 'research.discovery': { version: 1, custom: true } } }], contentRuns: [], promptChanges: [{ promptId: 'research.discovery', name: 'Find candidate trends', version: 2, current: true }] } };
    let actions = null; const confirm = vi.fn(async () => true);
    function Retry() { actions = useStudioActions({ api, state, confirm, viewer: ADMIN, can: () => true, canRun: () => true }); return null; }
    render(<Retry />);
    await act(async () => { await actions.runAiAction({ kind: 'retry-run', target: 'Weekly listening' }); });
    expect(confirm.mock.calls[1][0]).toMatchObject({ title: 'Use the newest prompts?', items: ['Find candidate trends · version 2'], cancelLabel: 'Keep the run’s prompts' });
    expect(api.retryStudioRun).toHaveBeenCalledWith({ runId: 'run-1', maxBudgetUsd: 10, refreshPrompts: true });
  });
});
