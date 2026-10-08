// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpAssistant } from '../src/renderer/src/help-assistant.jsx';

afterEach(cleanup);
const page = { id: 'research', label: 'Research programs' };
const reply = (extra = {}) => ({ answer: 'Open **Research programs**, then **Start research**.', pages: [{ page: 'research', label: 'Open Research programs' }], followUps: ['What will it cost?'], receipt: { costUsd: 0.0912, model: 'claude-opus-5-5', route: 'claude' }, ...extra });

describe('Ask AI panel', () => {
  it('asks a starter question with the current page and shows the answer, links and cost', async () => {
    const api = { askHelp: vi.fn(async () => reply()) };
    const onOpenPage = vi.fn();
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={page} onOpenPage={onOpenPage} />);
    fireEvent.click(screen.getByRole('button', { name: /How do I run my first research program\?/ }));
    await waitFor(() => expect(api.askHelp).toHaveBeenCalledWith({ question: 'How do I run my first research program?', history: [], page }));
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
});
