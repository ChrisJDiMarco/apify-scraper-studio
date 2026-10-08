// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../src/renderer/src/settings-view.jsx';

const state = () => ({ keys: {}, settings: { maxItems: 1000, sheets: {} }, sheetRuns: [] });
afterEach(cleanup);

describe('AI provider settings', () => {
  it('defaults to the automatic Claude route with Opus 5.5 and saves all AI settings explicitly', async () => {
    const onSaveSettings = vi.fn(async (settings) => settings);
    render(<SettingsView state={state()} meta={{}} onSaveSettings={onSaveSettings} />);
    expect(screen.getByRole('radio', { name: /Automatic \(recommended\)/ })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Claude model' })).toHaveValue('claude-opus-5-5');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Claude budget per request (USD)' }), { target: { value: '0.5' } });
    expect(onSaveSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledWith({ aiProvider: 'auto', aiModel: 'claude-opus-5-5', aiMaxBudgetUsd: 0.5 }));
  });
  it('checks the route and every model research uses, and shows what was found', async () => {
    const onCheckAi = vi.fn(async () => ({ ok: true, provider: 'auto', route: 'claude', version: '2.1.281 (Claude Code)', loggedIn: true, models: [{ id: 'claude-opus-5-5', available: true }, { id: 'claude-fable-5-1', available: true }] }));
    render(<SettingsView state={state()} meta={{}} onCheckAi={onCheckAi} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check Claude' }));
    await waitFor(() => expect(onCheckAi).toHaveBeenCalledWith({ provider: 'auto', model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-fable-5-1'] }));
    const result = await screen.findByRole('status');
    expect(result).toHaveTextContent('Ready · using Claude app 2.1.281 (Claude Code) · signed in');
    expect(result).toHaveTextContent('✓ claude-fable-5-1');
  });
  it('explains an automatic fallback to the API key and a model the account cannot use', async () => {
    const onCheckAi = vi.fn(async () => ({ ok: false, provider: 'auto', route: 'claude-api', keySaved: true, cli: { installed: true, version: '1.0.0', missingFlags: ['--effort'] }, models: [{ id: 'claude-opus-5-5', available: true }, { id: 'claude-fable-5-1', available: false, error: 'This API key cannot use claude-fable-5-1.' }], error: 'claude-fable-5-1: This API key cannot use claude-fable-5-1.' }));
    render(<SettingsView state={{ ...state(), keys: { ANTHROPIC_API_KEY: true } }} meta={{}} onCheckAi={onCheckAi} />);
    expect(screen.getByLabelText(/Anthropic API key/, { selector: 'input[type=password]' })).toHaveAttribute('type', 'password');
    expect(screen.getByText(/· saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check Claude' }));
    const result = await screen.findByRole('status');
    expect(result).toHaveTextContent('Using Anthropic API key, with a problem');
    expect(result).toHaveTextContent('The Claude app was skipped: version 1.0.0 is too old.');
    expect(result).toHaveTextContent('✕ claude-fable-5-1 — This API key cannot use claude-fable-5-1.');
  });
  it('saves an Anthropic API key and hides the field for the Claude app route', async () => {
    const onSaveKey = vi.fn(async () => ({ ANTHROPIC_API_KEY: true }));
    render(<SettingsView state={state()} meta={{}} onSaveKey={onSaveKey} />);
    fireEvent.change(screen.getByLabelText(/Anthropic API key/, { selector: 'input[type=password]' }), { target: { value: ' sk-ant-api03-example-key-value ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(onSaveKey).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'sk-ant-api03-example-key-value'));
    fireEvent.click(screen.getByRole('radio', { name: /Claude app \(Claude Code\)/ }));
    expect(screen.queryByLabelText(/Anthropic API key/, { selector: 'input[type=password]' })).not.toBeInTheDocument();
  });
  it('keeps Codex an explicit choice and retains Claude settings for switching back', async () => {
    const onSaveSettings = vi.fn(async (settings) => settings);
    const onCheckAi = vi.fn(async () => ({ ok: true, version: 'codex-cli test' }));
    render(<SettingsView state={state()} meta={{}} onSaveSettings={onSaveSettings} onCheckAi={onCheckAi} />);
    fireEvent.click(screen.getByText('Advanced writing provider'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Use the OpenAI Codex CLI instead of Claude/ }));
    expect(screen.queryByRole('textbox', { name: 'Claude model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Automatic/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check Codex' }));
    await waitFor(() => expect(onCheckAi).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex', model: 'claude-opus-5-5' })));
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledWith({ aiProvider: 'codex', aiModel: 'claude-opus-5-5', aiMaxBudgetUsd: 1 }));
  });
  it('prevents invalid budgets and preserves choices when saving fails', async () => {
    const onSaveSettings = vi.fn(async () => null);
    render(<SettingsView state={state()} meta={{}} onSaveSettings={onSaveSettings} />);
    const budget = screen.getByRole('spinbutton', { name: 'Claude budget per request (USD)' });
    fireEvent.change(budget, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
    fireEvent.change(budget, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(budget).toHaveValue(2);
  });
});
