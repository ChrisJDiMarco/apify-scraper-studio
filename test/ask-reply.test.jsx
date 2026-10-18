// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpAssistant } from '../src/renderer/src/help-assistant.jsx';
import { ChatCards, choiceOptions, primaryCard } from '../src/renderer/src/chat-cards.jsx';
import { SALVAGE_NOTE, splitSalvage } from '../src/renderer/src/ask-markdown.js';

// One look for every Ask AI reply (ask-reply.css): the answer text, cards, references, actions, the meta row and Ask
// next, always in that order and never empty; one primary button at most; choice rows that never read the same; and a
// conversation bar that sits above the thread instead of over it.
const require = createRequire(import.meta.url);
afterEach(cleanup);
const page = { id: 'research', label: 'Research programs' };
const reply = (extra = {}) => ({ answer: 'Two things changed this week.', pages: [], followUps: [], receipt: { costUsd: 0.42, model: 'claude-opus-5-5', route: 'claude' }, ...extra });
async function answerFor(answer, props = {}) {
  const api = { askHelp: vi.fn(async () => answer), ...(props.api || {}) };
  render(<HelpAssistant open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} onAction={vi.fn(async () => 'Done.')} {...props} api={api} />);
  fireEvent.click(screen.getByRole('button', { name: /What will a research run cost\?/ }));
  return screen.findByRole('article', { name: 'Answer' });
}
const groups = (article) => [...article.querySelectorAll('[data-reply-group]')].filter((node) => node.closest('article.help-answer') === article).map((node) => node.getAttribute('data-reply-group'));
const ACTIONS = [
  { kind: 'start-research', label: 'Start research with “Weekly listening”', target: 'Weekly listening', programId: 'p-weekly' },
  { kind: 'finish-assets', label: 'Finish the assets in “AI Citation”', target: 'AI Citation', folderKey: 'theme:x' },
  { kind: 'open', label: 'Open “Zero-click report”', target: 'Zero-click report', ref: { kind: 'report', id: 'asset-1' } },
];

describe('the reply’s anatomy', () => {
  it('puts the groups in one order: text, cards, references, actions, meta, Ask next', async () => {
    const answer = await answerFor(reply({
      answer: 'Read [the report](studio:report/asset-1) first.',
      pages: [{ page: 'research', label: 'Open Research programs' }],
      followUps: ['What will it cost?', 'Which channels use it?'],
      cards: [{ type: 'checklist', title: 'Next steps', note: '', data: { items: [{ text: 'Raise the cap', done: false }] }, actionIndexes: [] }],
      actions: [ACTIONS[0]],
    }));
    expect(groups(answer)).toEqual(['text', 'cards', 'refs', 'actions', 'meta', 'next']);
    // References are link chips with the item's kind; Ask next suggestions are a different, quieter chip.
    const refs = within(answer).getByRole('group', { name: 'In this answer' });
    expect(within(refs).getAllByRole('button').map((button) => button.className)).toEqual(['reply-ref', 'reply-ref']);
    // A chip names the item; the button's full words stay its accessible name.
    expect(within(refs).getAllByRole('button').map((button) => button.textContent)).toEqual(['the report', 'Research programs']);
    expect(within(refs).getByRole('button', { name: 'Open Research programs' })).toBeInTheDocument();
    const next = within(answer).getByRole('group', { name: 'Ask next' });
    expect(next).toHaveTextContent(/^Ask next/);
    expect(within(next).getAllByRole('button').every((button) => button.classList.contains('reply-suggest') && !button.classList.contains('reply-ref'))).toBe(true);
    expect(within(answer).getByText('Next steps').closest('.reply-card')).not.toBeNull();
  });

  it('leaves out the groups an answer doesn’t have', async () => {
    const answer = await answerFor(reply());
    expect(groups(answer)).toEqual(['text', 'meta']);
    expect(answer.querySelector('[data-reply-group="meta"]')).toHaveTextContent('claude-opus-5-5 · $0.42');
  });

  it('shows the salvage note as a quiet note, not as part of the answer', async () => {
    expect(SALVAGE_NOTE).toBe(require('../src/main/help-assistant.js').SALVAGE_NOTE);
    expect(splitSalvage(`Here is the answer.\n\n${SALVAGE_NOTE}`)).toEqual({ text: 'Here is the answer.', salvaged: true });
    expect(splitSalvage('Nothing to see.')).toEqual({ text: 'Nothing to see.', salvaged: false });
    const answer = await answerFor(reply({ answer: `I can run quick scans.\n\n${SALVAGE_NOTE}` }));
    const note = within(answer).getByText(SALVAGE_NOTE);
    expect(note).toHaveClass('reply-note');
    expect(note.querySelector('svg')).not.toBeNull();
    expect(answer.querySelector('.markdown-content')).not.toHaveTextContent(SALVAGE_NOTE);
    // Copy answer copies the answer, without the note.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    fireEvent.click(within(answer).getByRole('button', { name: 'Copy answer' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('I can run quick scans.'));
  });
});

describe('references', () => {
  it('shows each studio item once, even when the text, an Open button and the pages all name it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const openTarget = vi.fn(); const onOpenPage = vi.fn();
    const trend = { kind: 'open', label: 'Open Self-Promotional Listicle Crackdown Panic', target: 'Self-Promotional Listicle Crackdown Panic', ref: { kind: 'trend', id: 'theme-1' }, themeId: 'theme-1' };
    const answer = await answerFor(reply({
      answer: 'Watch [Self-Promotional Listicle Crackdown Panic](studio:trend/theme-1) and [Research programs](studio:page/research).',
      pages: [{ page: 'research', label: 'Open Research programs' }],
      actions: [trend, ACTIONS[0]],
    }), { nav: { openTarget }, onOpenPage });
    const refs = within(answer).getByRole('group', { name: 'In this answer' });
    expect(within(refs).getAllByRole('button').map((button) => button.textContent)).toEqual(['Self-Promotional Listicle Crackdown Panic', 'Research programs']);
    // The Open button for the same trend isn't drawn a second time in the actions row.
    expect(within(answer.querySelector('[data-reply-group="actions"]')).getAllByRole('button').map((button) => button.textContent)).toEqual(['Start research with “Weekly listening”']);
    expect(errors.mock.calls.some(([line]) => /same key/.test(String(line)))).toBe(false);
    fireEvent.click(within(refs).getByRole('button', { name: 'Self-Promotional Listicle Crackdown Panic' }));
    expect(openTarget).toHaveBeenCalledWith({ kind: 'trend', id: 'theme-1' });
    errors.mockRestore();
  });

  it('runs an Open button that became a chip through the shared runner, and says why when it can’t open', async () => {
    const onAction = vi.fn(async () => { throw new Error('That report was deleted.'); });
    const answer = await answerFor(reply({ actions: [ACTIONS[2]] }), { onAction });
    expect(answer.querySelector('[data-reply-group="actions"]')).toBeNull();
    const chip = within(answer).getByRole('button', { name: 'Open “Zero-click report”' });
    expect(chip).toHaveClass('reply-ref');
    expect(chip).toHaveTextContent('Zero-click report');
    fireEvent.click(chip);
    await waitFor(() => expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'open', ref: { kind: 'report', id: 'asset-1' } })));
    expect(await within(answer).findByRole('alert')).toHaveTextContent('That report was deleted.');
    expect(within(answer).getByRole('button', { name: 'Open “Zero-click report”' })).toBeEnabled();
  });
});

describe('one primary button per reply', () => {
  const primaries = (article) => [...article.querySelectorAll('.studio-primary')];
  it('makes the first button that does the work primary and every other one quiet', async () => {
    const answer = await answerFor(reply({ actions: ACTIONS }));
    const row = answer.querySelector('[data-reply-group="actions"]');
    expect(primaries(answer).map((button) => button.textContent)).toEqual(['Start research with “Weekly listening”']);
    expect([...row.querySelectorAll('button')].map((button) => button.classList.contains('studio-primary') ? 'primary' : button.classList.contains('studio-quiet') ? 'quiet' : 'other')).toEqual(['primary', 'quiet']);
    expect([...row.querySelectorAll('button')].every((button) => button.classList.contains('small'))).toBe(true);
    // The Open button for one report is a reference chip, not a third button in the row.
    expect(within(row).queryByRole('button', { name: /Zero-click report/ })).toBeNull();
    expect(within(answer).getByRole('group', { name: 'In this answer' })).toContainElement(within(answer).getByRole('button', { name: 'Open “Zero-click report”' }));
  });

  it('gives the primary only to a card that can show it to this person, else to the actions row', async () => {
    // A scan plan in a studio without quick-scan pricing (no estimateQuickScan) draws no Check cost, so it can't hold the
    // primary; the actions row's Start research takes it.
    const scanAction = { kind: 'quick-scan', label: 'Quick scan', target: 'AI Overviews', scan: { topic: 'AI Overviews' } };
    const plan = { type: 'scan-plan', title: 'Quick scan · AI Overviews', note: '', actionIndexes: [0], data: { scan: { topic: 'AI Overviews' } } };
    const answer = await answerFor(reply({ actions: [scanAction, ACTIONS[0]], cards: [plan] }));
    expect(primaries(answer).map((button) => button.textContent)).toEqual(['Start research with “Weekly listening”']);
    expect(primaries(answer)[0].closest('[data-reply-group="actions"]')).not.toBeNull();
    // The rules a card follows for its own buttons decide whether it wants the primary.
    const run = { type: 'run', title: '', note: '', actionIndexes: [], data: { runId: 'r1', kind: 'research', title: 'Weekly listening', status: 'failed', themes: [] } };
    expect(primaryCard([run], [], {}, null, { can: () => true })).toBe(0);
    expect(primaryCard([run], [], {}, null, { can: (method) => method !== 'retryStudioRun' })).toBe(-1);
    expect(primaryCard([run], [], {}, null, { canRunAction: false, canAct: false })).toBe(-1);
    const change = { type: 'prompt-change', title: 'Discovery', note: '', actionIndexes: [], data: { canApply: true, promptId: 'research.discovery', blockId: 'focus', text: 'New words', version: 3 } };
    expect(primaryCard([change], [], {}, null, { api: { savePromptVersion: vi.fn() } })).toBe(0);
    expect(primaryCard([change], [], {}, null, { api: {} })).toBe(-1);
    expect(primaryCard([change], [], {}, null, { api: { savePromptVersion: vi.fn() }, can: () => false })).toBe(-1);
    // A plan of one step draws nothing, so it can't hold the primary either.
    const plan1 = { type: 'plan', title: 'Plan', note: '', actionIndexes: [0], data: { steps: [{ index: 0, why: '' }] } };
    expect(primaryCard([plan1], [ACTIONS[0]], {})).toBe(-1);
    expect(primaryCard([{ ...plan1, data: { steps: [{ index: 0 }, { index: 1 }] } }], [ACTIONS[0], ACTIONS[1]], { 0: { status: 'cancelled', text: '' } })).toBe(0);
  });

  it('gives it to the card with open work, so the actions row under it is all quiet', async () => {
    const approve = { kind: 'approve-trend', label: 'Yes, for Social', target: 'AI Overviews', runId: 'run-1', themeId: 'theme-1', params: { note: 'Lead with clicks' } };
    const form = { type: 'action', title: 'Yes, for Social', note: '', actionIndexes: [0], data: { kind: 'approve-trend', title: 'AI Overviews', fields: [{ key: 'note', type: 'text', label: 'Note for the channels', value: 'Lead with clicks', max: 280 }], problems: [], spends: false } };
    const answer = await answerFor(reply({ actions: [approve, ...ACTIONS], cards: [form] }));
    expect(primaries(answer)).toHaveLength(1);
    expect(primaries(answer)[0].closest('.reply-card')).not.toBeNull();
    expect(primaries(answer)[0]).toHaveTextContent('Yes, for Social');
    expect(answer.querySelector('[data-reply-group="actions"] .studio-primary')).toBeNull();
    expect(primaryCard([form], [approve], {})).toBe(0);
    expect(primaryCard([form], [approve], { 0: { status: 'done', text: 'Approved.' } })).toBe(-1);
  });

  it('keeps it to one inside a card that offers several buttons', () => {
    const run = { type: 'run', title: '', note: '', actionIndexes: [], data: { runId: 'r1', kind: 'research', title: 'Weekly listening · Oct 17', status: 'partial', themes: ['AI Overviews'] } };
    const { container } = render(<div className="help-drawer"><ChatCards cards={[run]} actions={[]} actionState={{}} state={{ contentStudio: { researchRuns: [], contentRuns: [] } }} onNav={{}} onRunAction={vi.fn()} onAsk={vi.fn()} /></div>);
    // Partly done: both Try again and Summarize what changed are offered, and only the first is primary.
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass('studio-primary');
    expect(screen.getByRole('button', { name: 'Summarize what changed' })).toHaveClass('studio-quiet');
    expect(container.querySelectorAll('.studio-primary')).toHaveLength(1);
  });
});

describe('choice cards', () => {
  const action = { kind: 'open', label: 'Open the SEO quick scan', target: 'Quick scan · SEO and search marketing' };
  const option = (runId, detail) => ({ label: 'Quick scan · SEO and search marketing', detail, ids: { ref: { kind: 'run', id: runId }, runId } });
  it('never shows two answers that read the same', () => {
    // The same item twice is one answer; two items that still read alike (saved before the server told them apart) are
    // numbered so they can be told apart.
    expect(choiceOptions([option('a', 'Activity · 2026-10-17'), option('a', 'Activity · 2026-10-17')], { pick: true })).toHaveLength(1);
    expect(choiceOptions([option('a', 'Activity · 2026-10-17'), option('b', 'Activity · 2026-10-17')], { pick: true }).map((row) => row.detail)).toEqual(['Activity · 2026-10-17 · 1 of 2', 'Activity · 2026-10-17 · 2 of 2']);
    expect(choiceOptions([{ label: 'Enterprise', question: 'A' }, { label: 'enterprise ', question: 'B' }, { label: 'SMB' }]).map((row) => row.label)).toEqual(['Enterprise', 'SMB']);
  });
  it('draws the answers as full-width rows the arrow keys move between, and runs the one picked', async () => {
    const card = { type: 'choice', title: 'Which “Quick scan · SEO and search marketing” did you mean?', note: '', actionIndexes: [0], data: { pick: true, options: [option('a', 'Activity · 2026-10-17 · started 9:42 AM EDT'), option('b', 'Activity · 2026-10-17 · started 11:05 AM EDT')] } };
    const onRunAction = vi.fn(async () => 'Opened.');
    render(<div className="help-drawer"><ChatCards cards={[card]} actions={[action]} actionState={{}} state={null} onNav={{}} onRunAction={onRunAction} onOutcome={vi.fn()} /></div>);
    const group = screen.getByRole('group', { name: card.title });
    const rows = within(group).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual(['Quick scan · SEO and search marketingActivity · 2026-10-17 · started 9:42 AM EDT', 'Quick scan · SEO and search marketingActivity · 2026-10-17 · started 11:05 AM EDT']);
    expect(rows.every((row) => row.classList.contains('reply-choice'))).toBe(true);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1], { key: 'ArrowDown' });
    expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(rows[0], { key: 'End' });
    expect(rows[1]).toHaveFocus();
    fireEvent.click(rows[1]);
    await waitFor(() => expect(onRunAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'open', runId: 'b', ref: { kind: 'run', id: 'b' } })));
  });
  it('keeps the answer picked marked and at full strength, and says which one it was', () => {
    const card = { type: 'choice', title: 'Which audience is this for?', note: '', actionIndexes: [], data: { options: [{ label: 'Enterprise', question: 'For enterprise' }, { label: 'SMB', question: 'For SMB' }] } };
    const onAsk = vi.fn();
    render(<div className="help-drawer"><ChatCards cards={[card]} actions={[]} actionState={{}} state={null} onNav={{}} onAsk={onAsk} /></div>);
    fireEvent.click(screen.getByRole('button', { name: /SMB/ }));
    expect(onAsk).toHaveBeenCalledWith('For SMB');
    const [enterprise, smb] = within(screen.getByRole('group', { name: card.title })).getAllByRole('button');
    expect(smb).toHaveAttribute('aria-current', 'true');
    expect(smb).toHaveClass('is-on');
    expect(enterprise).not.toHaveAttribute('aria-current');
    expect([enterprise, smb].every((row) => row.disabled)).toBe(true);
    // The global disabled fade (premium.css) doesn't reach the picked row.
    const css = fs.readFileSync('src/renderer/src/ask-reply.css', 'utf8');
    expect(css).toMatch(/\.reply-choice\.is-on:disabled \{ opacity: 1;/);
  });
});

describe('card names', () => {
  it('names the memory card for what it is, and a card by its title otherwise', () => {
    const memory = { type: 'memory', title: '', data: { items: [{ id: 'mem-1', text: 'Keep LinkedIn posts under 150 words.' }] } };
    const checklist = { type: 'checklist', title: 'Next steps', note: '', actionIndexes: [], data: { items: [{ text: 'Raise the cap', done: false }] } };
    render(<div className="help-drawer"><ChatCards cards={[memory, checklist]} actions={[]} actionState={{}} state={null} onNav={{}} api={{ forgetAskMemory: vi.fn() }} /></div>);
    expect(screen.getByRole('article', { name: 'Remembered from this answer' })).toHaveTextContent('Keep LinkedIn posts under 150 words.');
    expect(screen.getByRole('article', { name: 'Next steps' })).toHaveClass('reply-card');
  });
  it('keeps every card on the one shell: its type is data, never a class a card part could share', () => {
    const compare = { type: 'compare', title: 'This week and last week', note: '', actionIndexes: [], data: { left: { title: 'This week', points: ['More listicles'] }, right: { title: 'Last week', points: ['More zero-click'] } } };
    const draft = { type: 'draft', title: 'Update', note: '', actionIndexes: [], data: { kind: 'slack', subject: 'Update', text: 'Listicles are up.' } };
    const { container } = render(<div className="help-drawer"><ChatCards cards={[compare, draft]} actions={[]} actionState={{}} state={null} onNav={{}} onAsk={vi.fn()} /></div>);
    const shells = [...container.querySelectorAll('article.reply-card')];
    expect(shells.map((card) => [card.className, card.getAttribute('data-card')])).toEqual([['reply-card', 'compare'], ['reply-card', 'draft']]);
    // The parts named after their card (.cc-compare's two columns, .cc-draft's text box) sit inside the shell.
    expect(shells[0].querySelector('.cc-compare')).not.toBeNull();
    expect(shells[1].querySelector('textarea.cc-draft')).not.toBeNull();
  });
});

describe('the conversation bar', () => {
  it('sits above the thread in the page’s flow, with the conversation’s name, never over the answer', async () => {
    const convo = { id: 'ask-00000000-0000-4000-8000-000000000001', title: 'Catching up on the studio', updatedAt: '2026-10-17T10:00:00Z' };
    const api = {
      askHelp: vi.fn(async () => ({ conversation: convo, userMessage: { id: 'msg-00000000-0000-4000-8000-0000000000a1' }, message: { id: 'msg-00000000-0000-4000-8000-0000000000b1', role: 'assistant', content: '1. First\n2. Second', actions: [], cards: [], createdAt: '2026-10-17T10:00:05Z' } })),
      listAskConversations: vi.fn(async () => ({ conversations: [] })), readAskConversation: vi.fn(), renameAskConversation: vi.fn(), deleteAskConversation: vi.fn(), listAskMemory: vi.fn(async () => ({ items: [] })),
    };
    const { container } = render(<HelpAssistant api={api} open variant="page" onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question about Scraper Studio' }), { target: { value: 'What changed?' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Question about Scraper Studio' }), { key: 'Enter' });
    await screen.findByRole('article', { name: 'Answer' });
    const bar = container.querySelector('.help-page-tools');
    const scroller = container.querySelector('.help-messages');
    expect(within(bar).getByRole('heading', { name: 'Catching up on the studio' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'What Ask AI remembers' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /New conversation/ })).toBeInTheDocument();
    // Structure: the bar and the thread are siblings in one column, the bar first; neither holds the other.
    expect(bar.parentElement).toBe(container.querySelector('.help-main'));
    expect(bar.contains(scroller) || scroller.contains(bar)).toBe(false);
    expect(bar.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Style: nothing positions the bar over the thread.
    const css = ['help-assistant.css', 'ask-chat.css', 'ask-reply.css'].map((name) => fs.readFileSync(`src/renderer/src/${name}`, 'utf8')).join('\n');
    // Rules for the bar itself (".help-page-tools", ".help-page-tools.is-plain"), not for what's inside it.
    const rules = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter((match) => match[1].split(',').some((selector) => /\.help-page-tools(\.[\w-]+)*\s*$/.test(selector.replace(/\/\*[\s\S]*?\*\//g, '')))).map((match) => match[2]);
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) expect(body).not.toMatch(/position:\s*(absolute|fixed)/);
  });
});
