// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../src/renderer/src/settings-view.jsx';

const state = () => ({ keys: {}, settings: { maxItems: 1000, sheets: {} }, sheetRuns: [] });
afterEach(cleanup);

describe('AI provider settings', () => {
  it('defaults to exact Claude Opus 5.5 and saves all AI settings explicitly', async () => {
    const onSaveSettings = vi.fn(async (settings) => settings);
    render(<SettingsView state={state()} meta={{}} onSaveSettings={onSaveSettings} />);
    fireEvent.click(screen.getByText('Advanced writing provider'));
    expect(screen.getByRole('combobox', { name: 'AI provider' })).toHaveValue('claude');
    expect(screen.getByRole('textbox', { name: 'Claude model' })).toHaveValue('claude-opus-5-5');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Claude budget per request (USD)' }), { target: { value: '0.5' } });
    expect(onSaveSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledWith({ aiProvider: 'claude', aiModel: 'claude-opus-5-5', aiMaxBudgetUsd: 0.5 }));
  });
  it('checks the selected provider and displays its actual connection receipt', async () => {
    const onCheckAi = vi.fn(async () => ({ ok: true, version: '2.1.281 (Claude Code)', loggedIn: true }));
    render(<SettingsView state={state()} meta={{}} onCheckAi={onCheckAi} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check Claude' }));
    await waitFor(() => expect(onCheckAi).toHaveBeenCalledWith({ provider: 'claude', model: 'claude-opus-5-5' }));
    expect(await screen.findByDisplayValue('2.1.281 (Claude Code) · Signed in')).toBeInTheDocument();
  });
  it('keeps Codex an explicit choice and retains Claude settings for switching back', async () => {
    const onSaveSettings = vi.fn(async (settings) => settings);
    const onCheckAi = vi.fn(async () => ({ ok: true, version: 'codex-cli test' }));
    render(<SettingsView state={state()} meta={{}} onSaveSettings={onSaveSettings} onCheckAi={onCheckAi} />);
    fireEvent.click(screen.getByText('Advanced writing provider'));
    fireEvent.change(screen.getByRole('combobox', { name: 'AI provider' }), { target: { value: 'codex' } });
    expect(screen.queryByRole('textbox', { name: 'Claude model' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check Codex' }));
    await waitFor(() => expect(onCheckAi).toHaveBeenCalledWith({ provider: 'codex', model: 'claude-opus-5-5' }));
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
