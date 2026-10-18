// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../src/renderer/src/settings-view.jsx';

// The key fields in Settings → AI connections (Anthropic, OpenAI, OpenRouter, fal.ai): saved and removed only on an
// explicit click, never echoed, kept on screen when a save fails, and tested only when someone asks.
const state = (keys = {}) => ({ keys, settings: { maxItems: 1000, sheets: {} }, sheetRuns: [] });
const row = (id, label, saved) => ({ id, label, kinds: ['text'], auth: 'api-key', status: saved ? 'ready' : 'no-key', keySaved: saved, detail: saved ? 'Key saved. Stored encrypted in this Mac’s keychain and sent only to OpenAI.' : 'Add a key to use it.', commands: [], usedBy: [] });
const status = (saved = false) => ({ host: 'mac', serverUser: null, checkedAt: '', connections: [row('openai', 'OpenAI API key', saved), row('fal', 'fal.ai', false), row('openrouter', 'OpenRouter', false), row('claude-api', 'Anthropic API key', false)] });
const props = (saved = false) => ({
  state: state({ OPENAI_API_KEY: saved }), meta: {}, onSaveKey: vi.fn(async () => true), onClearKey: vi.fn(async () => true),
  setupApi: { getAiConnections: vi.fn(async () => status(saved)), testAiConnection: vi.fn(async ({ connection }) => ({ ok: true, connection, detail: 'Works · GPT Image 2.5 Flare', models: [] })) },
});
const draft = 'test-only-input'; // Deliberately not a real API credential.
const openai = () => within(screen.getByRole('article', { name: 'OpenAI API key' }));
afterEach(cleanup);

describe('AI connection keys', () => {
  it('keeps key fields as password inputs and sends nothing until someone clicks', async () => {
    const handlers = props(); render(<SettingsView {...handlers} />);
    const field = await openai().findByLabelText('OpenAI API key');
    expect(field).toHaveAttribute('type', 'password'); expect(field).toHaveAttribute('autoComplete', 'off');
    expect(openai().getByRole('button', { name: 'Save key' })).toBeDisabled();
    expect(openai().getByRole('button', { name: 'Test' })).toBeDisabled();
    expect(openai().queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(handlers.setupApi.testAiConnection).not.toHaveBeenCalled(); expect(handlers.onSaveKey).not.toHaveBeenCalled();
    expect(screen.getByText(/Keys are stored in this Mac’s keychain/)).toBeVisible();
  });
  it('saves only on an explicit click, trimmed, and clears the field afterwards', async () => {
    const handlers = props(); render(<SettingsView {...handlers} />);
    fireEvent.change(await openai().findByLabelText('OpenAI API key'), { target: { value: `  ${draft} ` } });
    fireEvent.click(openai().getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(handlers.onSaveKey).toHaveBeenCalledWith('OPENAI_API_KEY', draft));
    await waitFor(() => expect(openai().getByLabelText('OpenAI API key')).toHaveValue(''));
    expect(handlers.setupApi.testAiConnection).not.toHaveBeenCalled();
  });
  it.each(['returned-failure', 'thrown-failure'])('keeps the entry when a save fails: %s', async (mode) => {
    const handlers = props(); handlers.onSaveKey = mode === 'returned-failure' ? vi.fn(async () => null) : vi.fn(async () => { throw new Error('fixture storage failure'); });
    render(<SettingsView {...handlers} />);
    fireEvent.change(await openai().findByLabelText('OpenAI API key'), { target: { value: draft } });
    fireEvent.click(openai().getByRole('button', { name: 'Save key' }));
    expect(await openai().findByRole('alert')).toHaveTextContent('Your entry is still here');
    expect(openai().getByLabelText('OpenAI API key')).toHaveValue(draft);
    expect(openai().getByRole('alert')).not.toHaveTextContent(draft);
  });
  it('tests a saved key for free on request and removes it only through Clear', async () => {
    const handlers = props(true); render(<SettingsView {...handlers} />);
    await openai().findByText(/Key saved/);
    expect(openai().getByLabelText('OpenAI API key')).toHaveAttribute('placeholder', 'Enter a replacement key');
    fireEvent.click(openai().getByRole('button', { name: 'Test' }));
    expect(await openai().findByText('Works · GPT Image 2.5 Flare')).toBeVisible();
    expect(handlers.setupApi.testAiConnection).toHaveBeenCalledWith({ connection: 'openai' });
    expect(handlers.onClearKey).not.toHaveBeenCalled();
    fireEvent.click(openai().getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(handlers.onClearKey).toHaveBeenCalledWith('OPENAI_API_KEY'));
  });
  it('shows a failed check as a real result without discarding the key', async () => {
    const handlers = props(true); handlers.setupApi.testAiConnection = vi.fn(async () => { throw new Error('Connection unavailable.'); });
    render(<SettingsView {...handlers} />);
    fireEvent.click(await openai().findByRole('button', { name: 'Test' }));
    expect(await openai().findByRole('status')).toHaveTextContent('Connection unavailable.');
    expect(handlers.onClearKey).not.toHaveBeenCalled();
    expect(openai().getByText(/Key saved/)).toBeVisible();
  });
});
