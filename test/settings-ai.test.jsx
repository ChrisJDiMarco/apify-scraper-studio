// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../src/renderer/src/settings-view.jsx';
import routingModule from '../src/main/ai-routing.js';

// Settings → AI connections (src/renderer/src/ai-connections.jsx): one card per connection, with its real status from
// getAiConnections, how to sign in, key fields and free tests. Nothing paid or saved happens without a click.
const { createAiRouting } = routingModule;
const state = (keys = {}) => ({ keys, settings: { maxItems: 1000, sheets: {} }, sheetRuns: [] });
const STATUS = {
  host: 'mac', serverUser: null, checkedAt: '2026-10-17T10:00:00.000Z',
  connections: [
    { id: 'claude', label: 'Claude Code', plan: 'Your Claude plan', kinds: ['text'], auth: 'subscription-cli', status: 'ready', version: '2.1.296', signedInWith: 'claude-plan', detail: 'Signed in · Claude Code 2.1.296', commands: [], usedBy: ['research.discovery', 'research.synthesis'] },
    { id: 'claude-api', label: 'Anthropic API key', kinds: ['text'], auth: 'api-key', status: 'no-key', keySaved: false, detail: 'Add a Anthropic key to use it.', commands: [], usedBy: [] },
    { id: 'codex', label: 'Codex', plan: 'Your ChatGPT plan', kinds: ['text'], auth: 'subscription-cli', status: 'sign-in', version: '0.156.0', detail: 'Not signed in. In Terminal run: codex login', commands: [{ label: 'Sign in', command: 'codex login' }], usedBy: [] },
    { id: 'openai', label: 'OpenAI API key', kinds: ['image', 'text'], auth: 'api-key', status: 'ready', keySaved: true, detail: 'Key saved.', commands: [], usedBy: ['pictures.kit-image'] },
    { id: 'openrouter', label: 'OpenRouter', kinds: ['text'], auth: 'api-key', status: 'key-unreadable', keySaved: true, keyProblem: 'mismatch', detail: 'This key was saved with a different STUDIO_SECRET_KEY.', commands: [], usedBy: [] },
    { id: 'fal', label: 'fal.ai', kinds: ['image', 'video'], auth: 'api-key', status: 'no-key', keySaved: false, detail: 'Add a fal.ai key to use it.', commands: [], usedBy: [] },
  ],
};
function api(overrides = {}) {
  const routing = createAiRouting({ getSettings: () => ({}) });
  return {
    getAiConnections: vi.fn(async () => STATUS),
    testAiConnection: vi.fn(async ({ connection }) => ({ ok: true, connection, detail: connection === 'openrouter' ? 'Works · $42.10 left on this key' : 'Works', models: [] })),
    previewAiRouting: vi.fn(async ({ routing: draft, preset } = {}) => routing.preview({ routing: draft || null, preset: preset || null })),
    saveAiRouting: vi.fn(async ({ routing: draft }) => ({ routing: { ...draft, updatedAt: '2026-10-17T10:05:00.000Z' }, updatedAt: '2026-10-17T10:05:00.000Z' })),
    listAiModels: vi.fn(async () => ({ models: [], nextCursor: null, fetchedAt: '', stale: false })),
    estimateAiTaskTest: vi.fn(), testAiTask: vi.fn(),
    ...overrides,
  };
}
const card = (name) => screen.getByRole('article', { name });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Settings → AI connections', () => {
  it('shows every connection’s status and how to sign in, without testing or saving anything', async () => {
    const setupApi = api(); const onSaveKey = vi.fn();
    render(<SettingsView state={state({ OPENAI_API_KEY: true })} meta={{}} setupApi={setupApi} onSaveKey={onSaveKey} onClearKey={vi.fn()} />);
    await waitFor(() => expect(within(card('Claude Code')).getByText('Signed in · Claude Code 2.1.296')).toBeVisible());
    for (const name of ['Claude Code', 'Codex', 'Anthropic API key', 'OpenAI API key', 'OpenRouter', 'fal.ai']) expect(card(name)).toBeVisible();
    expect(within(card('Claude Code')).getByText('Ready')).toBeVisible();
    expect(within(card('Claude Code')).getByText('Used by 2 jobs')).toBeVisible();
    expect(within(card('Codex')).getByText('Sign in')).toBeVisible();
    expect(within(card('Codex')).getByText('codex login')).toBeVisible();
    expect(within(card('OpenRouter')).getByRole('alert')).toHaveTextContent('saved with a different STUDIO_SECRET_KEY');
    expect(within(card('fal.ai')).getByText('Add a key')).toBeVisible();
    // Claude Code's model check costs a few cents, and says so; the others are free.
    expect(within(card('Claude Code')).getByText(/one tiny request per model through Claude Code, a few cents/)).toBeVisible();
    expect(within(card('fal.ai')).getByText('Free: no paid request is sent.')).toBeVisible();
    expect(setupApi.getAiConnections).toHaveBeenCalledWith({ fresh: false });
    expect(setupApi.testAiConnection).not.toHaveBeenCalled(); expect(onSaveKey).not.toHaveBeenCalled(); expect(setupApi.saveAiRouting).not.toHaveBeenCalled();
  });

  it('says on the browser studio that subscription connections use the server’s sign-in', async () => {
    const web = { ...STATUS, host: 'server', serverUser: 'node', connections: STATUS.connections.map((row) => (row.auth === 'subscription-cli' ? { ...row, serverNote: `This uses the sign-in on the studio server (user node), not your own account.${row.id === 'codex' ? ' Codex can read files the server’s user can read. Prefer Claude on a shared server.' : ''}` } : row)) };
    render(<SettingsView state={state()} meta={{ runtime: 'web' }} setupApi={api({ getAiConnections: vi.fn(async () => web) })} onSaveKey={vi.fn()} onClearKey={vi.fn()} />);
    expect(await within(card('Claude Code')).findByText(/sign-in on the studio server \(user node\)/)).toBeVisible();
    expect(within(card('Codex')).getByText(/Prefer Claude on a shared server/)).toBeVisible();
    expect(screen.getByText(/Keys are stored on the studio server and never sent to browsers/)).toBeVisible();
  });

  it('tests a connection only on a click and shows what it found, including what failed', async () => {
    const setupApi = api({ testAiConnection: vi.fn(async ({ connection }) => (connection === 'openai' ? { ok: false, connection, detail: '', error: 'This OpenAI key can’t use gpt-image-2.5-flare.', models: [{ id: 'gpt-image-2.5-flare', available: false, error: 'Not available to this key.' }] } : { ok: true, connection, detail: 'Works · $42.10 left on this key', models: [] })) });
    render(<SettingsView state={state({ OPENAI_API_KEY: true, OPENROUTER_API_KEY: true })} meta={{}} setupApi={setupApi} onSaveKey={vi.fn()} onClearKey={vi.fn()} />);
    await within(card('OpenAI API key')).findByText('Key saved.');
    fireEvent.click(within(card('OpenAI API key')).getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(setupApi.testAiConnection).toHaveBeenCalledWith({ connection: 'openai' }));
    const result = await within(card('OpenAI API key')).findByRole('status');
    expect(result).toHaveTextContent('This OpenAI key can’t use gpt-image-2.5-flare.'); expect(result).toHaveTextContent('gpt-image-2.5-flare — Not available to this key.');
    fireEvent.click(within(card('OpenRouter')).getByRole('button', { name: 'Test' }));
    expect(await within(card('OpenRouter')).findByText('Works · $42.10 left on this key')).toBeVisible();
    // A finished test reads the statuses again (fresh), since a test can change what's known.
    await waitFor(() => expect(setupApi.getAiConnections).toHaveBeenCalledWith({ fresh: true }));
    // A connection without a key can't be tested.
    expect(within(card('fal.ai')).getByRole('button', { name: 'Test' })).toBeDisabled();
  });

  it('copies a sign-in command and saves who may see OpenRouter prompts through Model routing', async () => {
    const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const setupApi = api();
    render(<SettingsView state={state()} meta={{}} setupApi={setupApi} onSaveKey={vi.fn()} onClearKey={vi.fn()} />);
    fireEvent.click(await within(card('Codex')).findByRole('button', { name: 'Copy codex login' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('codex login'));
    const privacy = within(card('OpenRouter')).getByLabelText('Which OpenRouter providers may see prompts');
    await waitFor(() => expect(privacy).not.toBeDisabled());
    expect(privacy).toHaveValue('no-training');
    fireEvent.change(privacy, { target: { value: 'zdr' } });
    await waitFor(() => expect(setupApi.saveAiRouting).toHaveBeenCalledWith(expect.objectContaining({ routing: expect.objectContaining({ openrouter: { privacy: 'zdr' } }), baseUpdatedAt: '' })));
    expect(await within(card('OpenRouter')).findByText('Saved. New requests use it.')).toBeVisible();
  });

  it('shows a locked note to people who aren’t admins', () => {
    render(<SettingsView role="editor" state={state()} meta={{}} setupApi={api()} />);
    expect(screen.getByRole('heading', { name: 'Settings are for admins' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Claude Code' })).not.toBeInTheDocument();
  });
});
