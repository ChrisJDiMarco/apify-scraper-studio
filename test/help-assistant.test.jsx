// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpAssistant, attentionStarters, studioLinks } from '../src/renderer/src/help-assistant.jsx';

afterEach(cleanup);
const page = { id: 'research', label: 'Research programs' };
const reply = (extra = {}) => ({ answer: 'Open **Research programs**, then **Start research**.', pages: [{ page: 'research', label: 'Open Research programs' }], followUps: ['What will it cost?'], receipt: { costUsd: 0.0912, model: 'claude-opus-5-5', route: 'claude' }, ...extra });

describe('Ask AI panel', () => {
  it('asks a starter question with the current page and shows the answer, links and cost', async () => {
    const api = { askHelp: vi.fn(async () => reply()) };
    const onOpenPage = vi.fn();
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={onOpenPage} />);
    fireEvent.click(screen.getByRole('button', { name: /How do I run my first research program\?/ }));
    await waitFor(() => expect(api.askHelp).toHaveBeenCalledWith(expect.objectContaining({ question: 'How do I run my first research program?', history: [], page, requestId: expect.any(String) })));
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(within(answer).getByText('Start research')).toBeInTheDocument();
    expect(answer).toHaveTextContent('claude-opus-5-5 · $0.09');
    fireEvent.click(within(answer).getByRole('button', { name: /Open Research programs/ }));
    expect(onOpenPage).toHaveBeenCalledWith('research');
  });
  it('keeps the conversation as history for follow-ups and starts over on request', async () => {
    const api = { askHelp: vi.fn(async () => reply({ followUps: [] })) };
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Question about Golden Thread' });
    fireEvent.change(box, { target: { value: 'How do budgets work?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByRole('article', { name: 'Answer' });
    fireEvent.change(box, { target: { value: 'And the AI budget?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(api.askHelp).toHaveBeenCalledTimes(2));
    expect(api.askHelp.mock.calls[1][0].history).toEqual([{ role: 'user', content: 'How do budgets work?' }, { role: 'assistant', content: reply().answer }]);
    await waitFor(() => expect(screen.getAllByRole('article', { name: 'Answer' })).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Start a new conversation' }));
    expect(screen.queryByRole('article', { name: 'Answer' })).not.toBeInTheDocument();
  });
  it('shows a readable error with a way to fix the Claude connection', async () => {
    const api = { askHelp: vi.fn(async () => { throw new Error('The Claude app is not signed in. Run "claude auth login" in Terminal.'); }) };
    const onOpenSettings = vi.fn();
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole('button', { name: /What will a research run cost\?/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not signed in');
    fireEvent.click(screen.getByRole('button', { name: /Open Settings/ }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
  it('creates a picture in the chat: placeholder first, then the picture with its cost, download and enlarge', async () => {
    let finish; const drawn = new Promise((resolve) => { finish = resolve; });
    const picture = { title: 'AI Overviews hero', prompt: 'A lavender comet trail over a results page', size: '1536x1024' };
    const api = {
      askHelp: vi.fn(async () => reply({ answer: 'Making a landscape hero image for **Branded AI Overviews Click Collapse**.', pages: [], followUps: [], image: picture })),
      createHelpImage: vi.fn(() => drawn),
      saveHelpImage: vi.fn(async () => ({ fileName: 'AI Overviews hero.png' })),
    };
    const onClose = vi.fn();
    render(<HelpAssistant api={api} open imagesReady onClose={onClose} page={page} onOpenPage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create a hero image for my latest trend/ }));
    expect(await screen.findByText(/Creating the picture/)).toBeInTheDocument();
    expect(api.createHelpImage).toHaveBeenCalledWith({ ...picture, family: 'none' }); // no brand set chosen: no reference images
    finish({ ...picture, id: 'help-image-1', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', costUsd: 0.0472, model: 'gpt-image-2.5-flare' });
    const image = await screen.findByRole('img', { name: 'AI Overviews hero' });
    expect(image).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
    expect(screen.getByRole('article', { name: 'Answer' })).toHaveTextContent('OpenAI image · $0.05');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(api.saveHelpImage).toHaveBeenCalledWith({ id: 'help-image-1' }));
    expect(await screen.findByText('Saved AI Overviews hero.png.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge AI Overviews hero' }));
    expect(screen.getByRole('dialog', { name: 'AI Overviews hero' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(onClose).not.toHaveBeenCalled();
  });
  it('sends the earlier picture prompt with a follow-up so revisions build on it', async () => {
    const picture = { title: 'Hero', prompt: 'A lavender comet trail', size: '1536x1024' };
    const api = { askHelp: vi.fn(async () => reply({ answer: 'Here it is.', pages: [], followUps: [], image: picture })), createHelpImage: vi.fn(async () => ({ ...picture, id: 'help-image-1', dataUrl: 'data:image/png;base64,AA==', costUsd: 0.05 })), saveHelpImage: vi.fn() };
    render(<HelpAssistant api={api} open imagesReady onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Question about Golden Thread' });
    fireEvent.change(box, { target: { value: 'Make a hero image' } }); fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByRole('img', { name: 'Hero' });
    fireEvent.change(box, { target: { value: 'Make it bluer' } }); fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.askHelp).toHaveBeenCalledTimes(2));
    expect(api.askHelp.mock.calls[1][0].history[1].content).toBe('Here it is.\n[Picture created from this prompt: A lavender comet trail]');
  });
  it('offers Try again when a picture fails, and hides picture suggestions without an image key', async () => {
    const picture = { title: 'Hero', prompt: 'A lavender comet trail', size: '1024x1024' };
    const createHelpImage = vi.fn().mockRejectedValueOnce(new Error('OpenAI denied image access.')).mockResolvedValueOnce({ ...picture, id: 'help-image-2', dataUrl: 'data:image/png;base64,AA==', costUsd: 0.04 });
    const api = { askHelp: vi.fn(async () => reply({ answer: 'Making it.', pages: [], followUps: [], image: picture })), createHelpImage, saveHelpImage: vi.fn() };
    const { rerender } = render(<HelpAssistant api={api} open imagesReady onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create a hero image/ }));
    expect(await screen.findByText(/OpenAI denied image access/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: 'Hero' })).toBeInTheDocument();
    expect(createHelpImage).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Start a new conversation' }));
    rerender(<HelpAssistant api={api} open imagesReady={false} onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Create a hero image/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Add an OpenAI key in Settings/)).toBeInTheDocument();
  });
  it('is hidden and inert while closed, closes on Escape, and is absent without the bridge', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<HelpAssistant api={{ askHelp: vi.fn() }} open={false} onClose={onClose} page={page} onOpenPage={vi.fn()} />);
    expect(container.querySelector('aside')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('aside')).toHaveAttribute('inert');
    rerender(<HelpAssistant api={{ askHelp: vi.fn() }} open onClose={onClose} page={page} onOpenPage={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    rerender(<HelpAssistant api={{}} open onClose={onClose} page={page} onOpenPage={vi.fn()} />);
    expect(container.querySelector('aside')).toBeNull();
  });
  it('keeps a question sent from elsewhere while an answer is coming, and asks it once that answer is in', async () => {
    let finish; const first = new Promise((resolve) => { finish = resolve; });
    const askHelp = vi.fn().mockImplementationOnce(() => first).mockImplementation(async () => reply({ answer: 'Here is what people say.', pages: [], followUps: [] }));
    const props = { api: { askHelp }, open: true, onClose: vi.fn(), page, onOpenPage: vi.fn() };
    const { rerender } = render(<HelpAssistant {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /What will a research run cost\?/ }));
    rerender(<HelpAssistant {...props} seed={{ text: 'What are people saying about AI Overviews?', context: 'The report text', key: 2 }} />);
    expect(await screen.findByText('Your question will be asked as soon as this answer is done.')).toBeInTheDocument();
    expect(askHelp).toHaveBeenCalledTimes(1);
    finish(reply({ answer: 'About $2.', pages: [], followUps: [] }));
    await waitFor(() => expect(askHelp).toHaveBeenCalledTimes(2));
    expect(askHelp.mock.calls[1][0]).toMatchObject({ question: 'What are people saying about AI Overviews?', context: 'The report text' });
  });
  it('turns studio links in an answer into buttons that open the item', async () => {
    const openTarget = vi.fn();
    const api = { askHelp: vi.fn(async () => reply({ answer: 'Start with [AI Overviews](studio:trend/theme-1) and read [the report](studio:report/asset-1).', pages: [], followUps: [] })) };
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} nav={{ openTarget }} />);
    fireEvent.click(screen.getByRole('button', { name: /What will a research run cost\?/ }));
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(answer).toHaveTextContent('Start with AI Overviews and read the report.');
    fireEvent.click(within(answer).getByRole('button', { name: /the report/ }));
    expect(openTarget).toHaveBeenCalledWith({ kind: 'report', id: 'asset-1' });
    expect(studioLinks('[x](studio:nowhere/1) and [y](studio:page/research)')).toEqual({ text: '[x](studio:nowhere/1) and **y**', links: [{ label: 'y', kind: 'page', id: 'research' }] });
  });
  it('opens a [[Program]] link on that program, and on Research programs where the layout can’t', async () => {
    expect(studioLinks('Run [Weekly listening](studio:program/p-weekly).')).toEqual({ text: 'Run **Weekly listening**.', links: [{ label: 'Weekly listening', kind: 'program', id: 'p-weekly' }] });
    const openTarget = vi.fn();
    const api = { askHelp: vi.fn(async () => reply({ answer: 'Run [Weekly listening](studio:program/p-weekly) again.', pages: [], followUps: [] })) };
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} nav={{ openTarget }} />);
    fireEvent.click(screen.getByRole('button', { name: /What will a research run cost\?/ }));
    fireEvent.click(within(await screen.findByRole('article', { name: 'Answer' })).getByRole('button', { name: /Weekly listening/ }));
    expect(openTarget).toHaveBeenCalledWith({ kind: 'program', id: 'p-weekly' });
    cleanup();
    const onOpenPage = vi.fn();
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={onOpenPage} nav={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /What will a research run cost\?/ }));
    fireEvent.click(within(await screen.findByRole('article', { name: 'Answer' })).getByRole('button', { name: /Weekly listening/ }));
    expect(onOpenPage).toHaveBeenCalledWith('research');
  });
  it('records a button that failed as failed, shows why, and asks a plan’s ask step itself', async () => {
    const recordAskOutcome = vi.fn(async () => ({}));
    const message = { id: 'msg-00000000-0000-0000-0000-000000000001', role: 'assistant', content: 'Two steps.', actions: [{ kind: 'start-research', label: 'Start research', target: 'Weekly listening' }, { kind: 'ask', label: 'Then: make Social assets', target: 'Make Social assets for the new report' }], cards: [] };
    const askHelp = vi.fn(async () => ({ conversation: { id: 'ask-00000000-0000-0000-0000-000000000009', title: 'Plan' }, userMessage: { id: 'msg-u' }, message }));
    const onAction = vi.fn(async () => { throw new Error('Riley started a search with this program at 2:14 PM.'); });
    render(<HelpAssistant api={{ askHelp, recordAskOutcome }} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /What will a research run cost\?/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start research' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Riley started a search');
    await waitFor(() => expect(recordAskOutcome).toHaveBeenCalledWith(expect.objectContaining({ index: 0, outcome: { status: 'failed', text: 'Riley started a search with this program at 2:14 PM.' } })));
    fireEvent.click(screen.getByRole('button', { name: 'Then: make Social assets' }));
    await waitFor(() => expect(askHelp).toHaveBeenCalledTimes(2));
    expect(askHelp.mock.calls[1][0].question).toBe('Make Social assets for the new report');
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  it('leads an empty thread with what needs the person now, as free one-click buttons', async () => {
    const state = { contentStudio: { activeWorkspaceId: 'w', researchRuns: [{ id: 'r', workspaceId: 'w', status: 'awaiting-review', discoveredThemes: [{ id: 'a' }, { id: 'b' }], decisions: { b: 'approved' } }], contentRuns: [{ id: 'k', workspaceId: 'w', kit: { sourceKey: 'theme:x', sourceTitle: 'AI Citation' }, status: 'partial', jobs: [{ status: 'succeeded' }, { status: 'failed' }, { status: 'failed' }], createdAt: '2026-10-16' }] } };
    expect(attentionStarters(state).map((row) => row.label)).toEqual(['Review 1 trend waiting for your OK', '2 assets in “AI Citation” need another try']);
    // A role that can't approve trends isn't sent to review them.
    expect(attentionStarters(state, (method) => method !== 'decideResearchTheme').map((row) => row.label)).toEqual(['2 assets in “AI Citation” need another try']);
    const onAction = vi.fn(async () => 'Opened.');
    render(<HelpAssistant api={{ askHelp: vi.fn() }} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} onAction={onAction} state={state} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Needs you now' })).getByRole('button', { name: /Review 1 trend/ }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: 'open-tab', label: 'Open Trends', target: 'trends' }));
    expect(await screen.findByText('Opened.')).toBeInTheDocument();
  });
});

// Streaming: the main process sends each answer's progress over api.onAskStream (ask-stream.js). Reduced motion is on
// here, so streamed text shows at once and the tests read it without waiting for animation frames.
function streaming(extra = {}) {
  const listeners = new Set();
  const emit = (event) => act(() => { for (const fn of [...listeners]) fn(event); });
  const api = { onAskStream: vi.fn((fn) => { listeners.add(fn); return () => listeners.delete(fn); }), readAskProgress: vi.fn(async () => ({ progress: null, active: [] })), cancelAsk: vi.fn(async () => ({ stopped: true })), ...extra };
  return { api, emit };
}
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const ev = {
  progress: (requestId, seq, progress) => ({ type: 'progress', requestId, conversationId: '', seq, progress: { steps: [], textLength: 0, ...progress } }),
  delta: (requestId, seq, at, text) => ({ type: 'delta', requestId, conversationId: '', seq, at, text }),
};
const convo = { id: 'ask-00000000-0000-4000-8000-000000000001', title: 'Budgets', updatedAt: '2026-10-17T10:00:00Z' };
const userMsg = { id: 'msg-00000000-0000-4000-8000-0000000000a1', content: 'How do budgets work?', createdAt: '2026-10-17T10:00:00Z' };
const answerMsg = (content, extra = {}) => ({ id: 'msg-00000000-0000-4000-8000-0000000000b1', role: 'assistant', content, pages: [], followUps: [], actions: [], cards: [], read: [], receipt: { costUsd: 0.08, model: 'claude-opus-5-5', route: 'claude-api' }, createdAt: '2026-10-17T10:00:05Z', ...extra });
const persisted = { listAskConversations: vi.fn(async () => ({ conversations: [] })), readAskConversation: vi.fn(async () => ({ conversation: { ...convo, messages: [] } })), renameAskConversation: vi.fn(), deleteAskConversation: vi.fn() };
const reducedMotion = () => { window.matchMedia = (query) => ({ matches: /reduce/.test(query), media: query, addEventListener() {}, removeEventListener() {} }); };
const box = () => screen.getByRole('textbox', { name: 'Question about Golden Thread' });
const send = (text) => { fireEvent.change(box(), { target: { value: text } }); fireEvent.keyDown(box(), { key: 'Enter' }); };

describe('Ask AI streaming', () => {
  afterEach(() => { delete window.matchMedia; });
  it('writes the answer into the same article that then holds the reply, with a caret while writing and cards only after', async () => {
    reducedMotion();
    const call = deferred(); const { api, emit } = streaming({ askHelp: vi.fn(() => call.promise) });
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    send('How do budgets work?');
    const placeholder = await screen.findByRole('article', { name: 'Answering' });
    expect(within(placeholder).getByRole('img', { name: 'Ask AI is thinking' })).toBeInTheDocument();
    const { requestId } = api.askHelp.mock.calls[0][0];
    emit(ev.progress(requestId, 1, { status: 'starting', question: 'How do budgets work?', steps: [{ id: 'context', kind: 'context', label: 'Looking at your studio', status: 'running' }] }));
    expect(placeholder).toHaveTextContent('Looking at your studio');
    emit(ev.progress(requestId, 2, { status: 'reading', steps: [{ id: 'lookup-0', kind: 'report', label: 'Reading “Budget guide”', status: 'running' }] }));
    expect(placeholder).toHaveTextContent('Reading “Budget guide”');
    emit(ev.delta(requestId, 3, 0, 'Each run has **a budget'));
    expect(placeholder).toHaveTextContent('Each run has a budget');
    expect(placeholder).toHaveClass('ask-streaming');
    expect(placeholder.querySelector('strong')).toHaveTextContent('a budget'); // the open ** is closed while it streams
    emit(ev.delta(requestId, 4, 23, '** that caps it.'));
    expect(placeholder).toHaveTextContent('Each run has a budget that caps it.');
    expect(screen.queryByText('Next steps')).not.toBeInTheDocument();
    call.resolve({ conversation: convo, userMessage: userMsg, message: answerMsg('Each run has **a budget** that caps it.', { cards: [{ type: 'checklist', title: 'Next steps', note: '', data: { items: [{ text: 'Raise the cap', done: false }] }, actionIndexes: [] }] }) });
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(answer).toBe(placeholder); // finished in place: no remount, no jump
    expect(answer).not.toHaveClass('ask-streaming');
    expect(within(answer).getByText('Next steps')).toBeInTheDocument();
    expect(answer).toHaveTextContent('claude-opus-5-5 · $0.08');
    expect(screen.getByText(/^Answer ready\. Each run has a budget that caps it\.$/)).toBeInTheDocument();
  });

  it('stops an answer with Stop or Esc, keeping what was written', async () => {
    reducedMotion();
    const call = deferred(); const onClose = vi.fn();
    const { api, emit } = streaming({ askHelp: vi.fn(() => call.promise) });
    render(<HelpAssistant api={api} open onClose={onClose} page={page} onOpenPage={vi.fn()} />);
    send('Summarize the week');
    const { requestId } = api.askHelp.mock.calls[0][0];
    emit(ev.progress(requestId, 1, { status: 'writing' })); emit(ev.delta(requestId, 2, 0, 'Two trends moved'));
    box().focus();
    fireEvent.keyDown(box(), { key: 'Escape' });
    await waitFor(() => expect(api.cancelAsk).toHaveBeenCalledWith({ requestId }));
    expect(onClose).not.toHaveBeenCalled(); // Esc stopped the answer before closing the drawer
    expect(screen.getByRole('button', { name: 'Stop answering' })).toBeDisabled();
    call.resolve({ conversation: convo, userMessage: { ...userMsg, content: 'Summarize the week' }, message: answerMsg('Two trends moved', { stopped: true, receipt: null }) });
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(answer).toHaveTextContent('Two trends moved');
    expect(answer).toHaveTextContent('Stopped. What was written so far is kept.');
    expect(screen.getByRole('button', { name: 'Send question' })).toBeInTheDocument();
  });

  it('asks the last question again with Retry, and edits it with ↑', async () => {
    const askHelp = vi.fn(async () => ({ conversation: convo, userMessage: userMsg, message: answerMsg('Budgets cap each run.') }));
    const { api } = streaming({ askHelp, ...persisted });
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    send('How do budgets work?');
    const answer = await screen.findByRole('article', { name: 'Answer' });
    fireEvent.click(within(answer).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(askHelp).toHaveBeenCalledTimes(2));
    expect(askHelp.mock.calls[1][0]).toMatchObject({ question: 'How do budgets work?', conversationId: convo.id, mode: 'regenerate', replaces: userMsg.id });
    await screen.findByRole('article', { name: 'Answer' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    const edit = await screen.findByRole('textbox', { name: 'Edit question' });
    fireEvent.change(edit, { target: { value: 'How do AI budgets work?' } });
    fireEvent.keyDown(edit, { key: 'Enter' });
    await waitFor(() => expect(askHelp).toHaveBeenCalledTimes(3));
    expect(askHelp.mock.calls[2][0]).toMatchObject({ question: 'How do AI budgets work?', mode: 'edit', replaces: userMsg.id, conversationId: convo.id });
  });

  it('queues a question typed while an answer is coming, and sends it once that answer is in', async () => {
    const call = deferred();
    const askHelp = vi.fn().mockImplementationOnce(() => call.promise).mockImplementation(async () => reply({ answer: 'Second.', pages: [], followUps: [] }));
    const { api } = streaming({ askHelp });
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    send('First question');
    send('Second question');
    expect(await screen.findByText('Sends when this answer is done')).toBeInTheDocument();
    expect(askHelp).toHaveBeenCalledTimes(1);
    call.resolve(reply({ answer: 'First.', pages: [], followUps: [] }));
    await waitFor(() => expect(askHelp).toHaveBeenCalledTimes(2));
    expect(askHelp.mock.calls[1][0].question).toBe('Second question');
  });

  it('opens / commands as they type, moves with the arrow keys and runs one with Enter', async () => {
    const askHelp = vi.fn(async () => reply({ followUps: [] }));
    render(<HelpAssistant api={{ askHelp }} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    fireEvent.change(box(), { target: { value: '/' } });
    const menu = screen.getByRole('listbox', { name: 'Commands' });
    expect(within(menu).getAllByRole('option').length).toBeGreaterThan(4);
    fireEvent.change(box(), { target: { value: '/s' } });
    expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual([expect.stringContaining('/scan'), expect.stringContaining('/summarize')]);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(within(menu).getByRole('option', { selected: true })).toHaveTextContent('/summarize');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(askHelp).toHaveBeenCalledWith(expect.objectContaining({ question: 'Summarize what changed since the last research run.' })));
    fireEvent.change(box(), { target: { value: '/help' } }); fireEvent.keyDown(box(), { key: 'Escape' }); fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.getByRole('region', { name: 'Commands' })).toHaveTextContent('/scan topic');
    expect(askHelp).toHaveBeenCalledTimes(1); // /help is answered here, without the AI
  });

  it('takes a report dropped into the chat as an attachment', async () => {
    const askHelp = vi.fn(async () => reply({ followUps: [] }));
    const { container } = render(<HelpAssistant api={{ askHelp }} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    const ref = JSON.stringify({ kind: 'report', ref: 'Zero-click report', id: 'asset-1' });
    const dataTransfer = { types: ['application/x-studio-ref'], getData: (type) => (type === 'application/x-studio-ref' ? ref : ''), files: [], dropEffect: 'none', effectAllowed: 'copy' };
    const aside = container.querySelector('aside');
    fireEvent.dragOver(aside, { dataTransfer });
    fireEvent.drop(aside, { dataTransfer });
    expect(screen.getByText('Zero-click report')).toBeInTheDocument();
    expect(box()).toHaveAttribute('placeholder', 'Ask about “Zero-click report”…');
    send('What should we post?');
    await waitFor(() => expect(askHelp).toHaveBeenCalledWith(expect.objectContaining({ question: 'What should we post?', attachments: [{ kind: 'report', ref: 'Zero-click report' }] })));
    expect(await screen.findByText('Report: Zero-click report')).toBeInTheDocument();
  });

  it('offers Jump to latest once the person scrolls up', async () => {
    const askHelp = vi.fn(async () => reply({ followUps: [] }));
    const { container } = render(<HelpAssistant api={{ askHelp }} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    send('How do budgets work?');
    await screen.findByRole('article', { name: 'Answer' });
    const scroller = container.querySelector('.help-messages');
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 });
    scroller.scrollTop = 200; fireEvent.wheel(scroller, { deltaY: -100 }); fireEvent.scroll(scroller);
    fireEvent.click(await screen.findByRole('button', { name: 'Jump to latest' }));
    expect(scroller.scrollTop).toBe(2000);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  });

  it('keeps following an answer when its call is cut, and finishes it from the stream', async () => {
    reducedMotion();
    const call = deferred(); const { api, emit } = streaming({ askHelp: vi.fn(() => call.promise) });
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    send('How do budgets work?');
    const { requestId } = api.askHelp.mock.calls[0][0];
    emit(ev.progress(requestId, 1, { status: 'writing' })); emit(ev.delta(requestId, 2, 0, 'Budgets cap'));
    call.reject(Object.assign(new Error('The studio isn’t answering right now.'), { status: 524 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    emit(ev.delta(requestId, 3, 11, ' each run.'));
    emit({ ...ev.progress(requestId, 4, { status: 'done', textLength: 21, final: { conversation: convo, userMessage: userMsg, message: answerMsg('Budgets cap each run.') } }), conversationId: convo.id });
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(answer).toHaveTextContent('Budgets cap each run.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('picks up an answer that was still being written before a reload, and marks its conversation as answering', async () => {
    reducedMotion();
    const snapshot = { requestId: 'req-before-reload', conversationId: convo.id, question: 'What changed?', status: 'writing', text: 'Two trends', steps: [], seq: 5 };
    const { api, emit } = streaming({ askHelp: vi.fn(), ...persisted, listAskConversations: vi.fn(async () => ({ conversations: [convo] })), readAskConversation: vi.fn(async () => ({ conversation: { ...convo, messages: [{ ...userMsg, role: 'user' }, answerMsg('Budgets cap each run.')] } })), readAskProgress: vi.fn(async ({ requestId } = {}) => (requestId ? { progress: snapshot } : { active: [snapshot] })) });
    sessionStorage.setItem('ask.thread.local', convo.id);
    render(<HelpAssistant api={api} open variant="page" onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    const answering = await screen.findByRole('article', { name: 'Answering' }, { timeout: 4000 });
    expect(answering).toHaveTextContent('Two trends');
    expect(screen.getByText('What changed?')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Ask AI conversations' })).getByText('Answering…')).toBeInTheDocument();
    emit({ type: 'delta', requestId: 'req-before-reload', conversationId: convo.id, seq: 6, at: 10, text: ' moved.' });
    expect(answering).toHaveTextContent('Two trends moved.');
    emit({ type: 'progress', requestId: 'req-before-reload', conversationId: convo.id, seq: 7, progress: { status: 'done', steps: [], textLength: 17, final: { conversation: convo, userMessage: { ...userMsg, id: 'msg-00000000-0000-4000-8000-0000000000a2', content: 'What changed?' }, message: answerMsg('Two trends moved.', { id: 'msg-00000000-0000-4000-8000-0000000000b2' }) } } });
    expect(await screen.findAllByRole('article', { name: 'Answer' })).toHaveLength(2);
    expect(screen.queryByText('Answering…')).not.toBeInTheDocument();
    sessionStorage.clear();
  });

  it('shows a follow-up the studio posts into the open conversation as soon as it arrives', async () => {
    reducedMotion();
    const stored = [{ ...userMsg, role: 'user' }, answerMsg('Scan planned.')];
    const followUp = answerMsg('**Quick scan finished: “SEO”**', { id: 'msg-00000000-0000-4000-8000-0000000000c1', followUp: { key: 'scan-finished', runId: 'r1' }, receipt: null });
    const readAskConversation = vi.fn().mockResolvedValueOnce({ conversation: { ...convo, messages: stored } }).mockResolvedValue({ conversation: { ...convo, messages: [...stored, followUp] } });
    const { api, emit } = streaming({ askHelp: vi.fn(), ...persisted, listAskConversations: vi.fn(async () => ({ conversations: [convo] })), readAskConversation });
    sessionStorage.setItem('ask.thread.local', convo.id);
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={vi.fn()} />);
    await screen.findByText('Scan planned.');
    emit({ type: 'followup', conversationId: convo.id, messageId: followUp.id });
    expect(await screen.findByText('Quick scan finished: “SEO”')).toBeInTheDocument();
    expect(screen.getByText(/From the studio/)).toBeInTheDocument();
    sessionStorage.clear();
  });
});

describe('Ask AI drawer resize handle', () => {
  it('widens with the arrow keys, remembers the width and resets on double-click', () => {
    const store = new Map(); vi.stubGlobal('localStorage', { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) });
    render(<HelpAssistant api={{ askHelp: vi.fn() }} open onClose={vi.fn()} page={{ id: 'home', label: 'Home' }} onOpenPage={vi.fn()} />);
    const handle = screen.getByRole('separator', { name: 'Resize Ask AI' });
    const drawer = document.getElementById('help-drawer');
    expect(handle).toHaveAttribute('aria-valuenow', '440');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '464');
    expect(drawer.style.getPropertyValue('--help-drawer-w')).toBe('464px');
    expect(store.get('studio.ask.drawerWidth')).toBe('464');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle).toHaveAttribute('aria-valuenow', '360');
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '440');
    vi.unstubAllGlobals();
  });
});
