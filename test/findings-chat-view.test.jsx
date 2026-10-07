// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FindingsChatView } from '../src/renderer/src/findings-chat-view.jsx';

afterEach(cleanup);
const conversation = { id: 'chat-1', title: 'Campaign themes', datasetIds: ['a', 'b'], messages: [
  { id: 'q1', role: 'user', content: 'What are the themes?' },
  { id: 'a1', role: 'assistant', content: 'Reporting is the clearest theme. <img src=x onerror=alert(1)>', citations: [{ itemId: 'a:1', excerpt: 'Better reporting', url: 'https://example.com/source', datasetName: 'Web findings' }, { itemId: 'b:1', excerpt: 'No executable links', url: 'javascript:alert(1)' }], coverage: { includedItems: 12, availableItems: 20, truncatedItems: 1 }, caveats: ['The sample is limited.'] },
] };
function props() { return { state: { datasets: [{ id: 'a', name: 'Web findings', platform: 'web', itemCount: 10 }, { id: 'b', name: 'Reddit findings', platform: 'reddit', itemCount: 10 }], conversations: [] }, selectedDatasetId: 'a', onDatasetSelect: vi.fn(), busy: false, onAskQuestion: vi.fn().mockResolvedValue({ conversation }), onNavigate: vi.fn() }; }
function ask(text) { fireEvent.change(screen.getByRole('textbox', { name: 'Question about your findings' }), { target: { value: text } }); fireEvent.click(screen.getByRole('button', { name: 'Ask question' })); }

describe('findings chat interactions', () => {
  it('directs an empty workspace to search without sample answers', () => {
    const input = props();
    input.state.datasets = [];
    render(<FindingsChatView {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a search' }));
    expect(input.onNavigate).toHaveBeenCalledWith('search');
    expect(input.onAskQuestion).not.toHaveBeenCalled();
  });

  it('asks across selected datasets, displays sourced plain text, then continues the same conversation', async () => {
    const input = props();
    const { container } = render(<FindingsChatView {...input} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Reddit findings/ }));
    await act(async () => ask('What are the themes?'));
    expect(input.onAskQuestion).toHaveBeenCalledWith({ datasetIds: ['a', 'b'], question: 'What are the themes?', requestId: expect.stringMatching(/^chat-request-/) });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'Campaign themes' })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByText('2 sources'));
    expect(screen.getByRole('link', { name: /Open source 1/ })).toHaveAttribute('href', 'https://example.com/source');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('The sample is limited.')).toBeInTheDocument();
    expect(screen.getByText(/Based on 12 of 20 loaded records/)).toBeInTheDocument();
    await act(async () => ask('What should we test?'));
    expect(input.onAskQuestion).toHaveBeenLastCalledWith({ datasetIds: ['a', 'b'], question: 'What should we test?', requestId: expect.stringMatching(/^chat-request-/), conversationId: 'chat-1' });
  });

  it('preserves the question after failure and retries the same request', async () => {
    const input = props();
    input.onAskQuestion.mockRejectedValueOnce(new Error('Claude is not available')).mockResolvedValueOnce(conversation);
    render(<FindingsChatView {...input} />);
    await act(async () => ask('Keep this question'));
    expect(screen.getByRole('alert')).toHaveTextContent('Claude is not available');
    expect(screen.getByRole('textbox')).toHaveValue('Keep this question');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(input.onAskQuestion).toHaveBeenCalledTimes(2);
    expect(input.onAskQuestion.mock.calls[0][0]).toEqual(input.onAskQuestion.mock.calls[1][0]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not send example questions until asked and blocks empty evidence selection', () => {
    const input = props();
    render(<FindingsChatView {...input} />);
    fireEvent.click(screen.getByRole('button', { name: /What are the strongest themes/ }));
    expect(screen.getByRole('textbox')).toHaveValue('What are the strongest themes in these findings? Cite examples.');
    expect(input.onAskQuestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Web findings/ }));
    expect(screen.getByRole('button', { name: 'Ask question' })).toBeDisabled();
    expect(screen.getByText('Select at least one dataset to start.')).toBeInTheDocument();
  });

  it('opens a saved conversation and clears its context when the evidence selection changes', async () => {
    const input = props();
    input.state.conversations = [conversation];
    render(<FindingsChatView {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Campaign themes' }));
    expect(screen.getByRole('checkbox', { name: /Reddit findings/ })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Reddit findings/ }));
    expect(screen.queryByLabelText('AI answer')).not.toBeInTheDocument();
    await act(async () => ask('A different scope'));
    expect(input.onAskQuestion).toHaveBeenCalledWith({ datasetIds: ['a'], question: 'A different scope', requestId: expect.stringMatching(/^chat-request-/) });
  });

  it('locks scope and duplicate submission while a question is in flight', async () => {
    const input = props();
    let resolve;
    input.onAskQuestion.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<FindingsChatView {...input} />);
    act(() => ask('Pending question'));
    expect(screen.getByRole('status')).toHaveTextContent('Reading your selected evidence');
    expect(screen.getByRole('button', { name: 'Answering question' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Web findings/ })).toBeDisabled();
    await act(async () => resolve(conversation));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('source opening and execution receipts', () => {
  it('uses the desktop bridge for safe source links and shows the actual provider/model/cost receipt', async () => {
    const input = props();
    input.onOpenSourceUrl = vi.fn().mockResolvedValue(undefined);
    input.state.conversations = [{ ...conversation, messages: conversation.messages.map((message) => message.role === 'assistant' ? { ...message, aiReceipt: { provider: 'claude', actualModel: 'claude-sonnet-4-6', costUsd: 0.0032 } } : message) }];
    render(<FindingsChatView {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Campaign themes' }));
    fireEvent.click(screen.getByText('2 sources'));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => screen.getByRole('link', { name: /Open source 1/ }).dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(input.onOpenSourceUrl).toHaveBeenCalledWith('https://example.com/source');
    expect(screen.getByLabelText('AI execution receipt')).toHaveTextContent('Claude CLI');
    expect(screen.getByLabelText('AI execution receipt')).toHaveTextContent('claude-sonnet-4-6');
    expect(screen.getByLabelText('AI execution receipt')).toHaveTextContent('$0.0032 reported cost');
  });

  it('keeps unknown cost distinct from zero and allows a source-opening failure to be retried', async () => {
    const input = props();
    input.onOpenSourceUrl = vi.fn().mockRejectedValueOnce(new Error('Browser unavailable')).mockResolvedValueOnce(undefined);
    input.state.conversations = [{ ...conversation, messages: conversation.messages.map((message) => message.role === 'assistant' ? { ...message, aiReceipt: { provider: 'claude', actualModel: '', costUsd: null } } : message) }];
    render(<FindingsChatView {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Campaign themes' }));
    fireEvent.click(screen.getByText('2 sources'));
    await act(async () => fireEvent.click(screen.getByRole('link', { name: /Open source 1/ })));
    expect(screen.getByRole('alert')).toHaveTextContent('Browser unavailable');
    expect(screen.getByLabelText('AI execution receipt')).toHaveTextContent('Cost not reported');
    await act(async () => fireEvent.click(screen.getByRole('link', { name: /Open source 1/ })));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input.onOpenSourceUrl).toHaveBeenCalledTimes(2);
  });
});

describe('chat retry identity and dataset limits', () => {
  it('retains a first-question request ID across failure and uses a new ID for a different question', async () => {
    const input = props();
    input.onAskQuestion.mockRejectedValue(new Error('Try after signing in'));
    render(<FindingsChatView {...input} />);
    await act(async () => ask('First attempt'));
    const first = input.onAskQuestion.mock.calls[0][0];
    expect(first.requestId).toMatch(/^chat-request-/);
    expect(first.conversationId).toBeUndefined();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(input.onAskQuestion.mock.calls[1][0]).toEqual(first);
    await act(async () => ask('A different question'));
    expect(input.onAskQuestion.mock.calls[2][0].requestId).not.toBe(first.requestId);
  });

  it('starts a fresh request identity when the user explicitly creates a new conversation', async () => {
    const input = props();
    input.onAskQuestion.mockRejectedValue(new Error('Not signed in'));
    render(<FindingsChatView {...input} />);
    await act(async () => ask('Repeated words, new chat'));
    const first = input.onAskQuestion.mock.calls[0][0].requestId;
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await act(async () => ask('Repeated words, new chat'));
    expect(input.onAskQuestion.mock.calls[1][0].requestId).not.toBe(first);
  });

  it('limits selection to eight while allowing selected datasets to be removed', async () => {
    const input = props();
    input.state.datasets = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, name: `Dataset ${i}`, itemCount: 2 }));
    input.selectedDatasetId = 'd0';
    render(<FindingsChatView {...input} />);
    for (let index = 1; index < 8; index++) fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`Dataset ${index} `) }));
    expect(screen.getByText('8 / 8 selected')).toBeInTheDocument();
    expect(screen.getByText('Eight datasets maximum. Deselect one to add another.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Dataset 8 / })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Dataset 0 / })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Dataset 0 / }));
    expect(screen.getByRole('checkbox', { name: /Dataset 8 / })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Dataset 8 / }));
    await act(async () => ask('Compare this evidence'));
    expect(input.onAskQuestion.mock.calls[0][0].datasetIds).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8']);
  });
});

describe('conversation formatting', () => {
  it('formats assistant Markdown while preserving user questions as plain text', () => {
    const input = props();
    input.state.conversations = [{ ...conversation, messages: [{ id: 'q', role: 'user', content: '**My question**' }, { id: 'a', role: 'assistant', content: '## Main finding\n\n**Reporting** matters. [Invented](https://invented.example)', citations: [] }] }];
    render(<FindingsChatView {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Campaign themes' }));
    expect(screen.getByLabelText('Your question')).toHaveTextContent('**My question**');
    expect(screen.getByRole('heading', { name: 'Main finding', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Reporting').tagName).toBe('STRONG');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
