// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    const box = screen.getByRole('textbox', { name: 'Question about Scraper Studio' });
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
    expect(api.createHelpImage).toHaveBeenCalledWith(picture);
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
    const box = screen.getByRole('textbox', { name: 'Question about Scraper Studio' });
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
