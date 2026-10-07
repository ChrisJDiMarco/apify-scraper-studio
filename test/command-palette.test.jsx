// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../src/renderer/src/mission-command.jsx';

afterEach(cleanup);

const items = [
  { id: 'datasets', label: 'Open datasets', shortcut: 'Cmd+D' },
  { id: 'reports', label: 'Open reports', shortcut: 'Cmd+R' },
  { id: 'scraper', label: 'Create a scraper' },
];

function Harness({ onRun = vi.fn(), onClose = vi.fn() }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open command palette</button>
    <button>Outside control</button>
    <CommandPalette open={open} items={items} onRun={onRun} onClose={() => { setOpen(false); onClose(); }} />
  </>;
}

function launch() {
  const trigger = screen.getByRole('button', { name: 'Open command palette' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

function press(key, options = {}) {
  fireEvent.keyDown(document.activeElement, { key, ...options });
}

describe('command palette keyboard access', () => {
  it('focuses its labelled search field and closes with Escape, restoring the launcher', () => {
    const onClose = vi.fn();
    const onRun = vi.fn();
    render(<Harness onClose={onClose} onRun={onRun} />);
    const trigger = launch();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('textbox', { name: 'Search commands' })).toHaveFocus();
    expect(screen.getByPlaceholderText('Search pages and actions…')).toBeInTheDocument();
    press('Escape');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('wraps ArrowUp and ArrowDown through commands and runs the selected result once', () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);
    const trigger = launch();
    press('ArrowDown');
    expect(screen.getByRole('button', { name: 'Open datasets' })).toHaveFocus();
    press('ArrowDown');
    expect(screen.getByRole('button', { name: 'Open reports' })).toHaveFocus();
    press('ArrowUp');
    expect(screen.getByRole('button', { name: 'Open datasets' })).toHaveFocus();
    press('ArrowUp');
    expect(screen.getByRole('button', { name: 'Create a scraper' })).toHaveFocus();
    press('ArrowDown');
    expect(screen.getByRole('button', { name: 'Open datasets' })).toHaveFocus();
    press('ArrowDown');
    press('Enter');
    expect(onRun).toHaveBeenCalledExactlyOnceWith(items[1]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('shows the result Enter will run before any arrow key, and follows the pointer with one highlight', () => {
    render(<Harness />);
    launch();
    expect(screen.getByRole('button', { name: 'Open datasets' })).toHaveClass('active');
    fireEvent.mouseMove(screen.getByRole('button', { name: 'Create a scraper' }));
    expect(screen.getByRole('button', { name: 'Create a scraper' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Open datasets' })).not.toHaveClass('active');
  });

  it('returns typing to the search field after arrowing into results', () => {
    render(<Harness />);
    launch();
    press('ArrowDown');
    expect(screen.getByRole('button', { name: 'Open datasets' })).toHaveFocus();
    press('r');
    expect(screen.getByRole('textbox', { name: 'Search commands' })).toHaveFocus();
  });

  it('traps Tab and Shift+Tab in both directions', () => {
    render(<Harness />);
    launch();
    const input = screen.getByRole('textbox', { name: 'Search commands' });
    press('Tab', { shiftKey: true });
    expect(screen.getByRole('button', { name: 'Create a scraper' })).toHaveFocus();
    press('Tab');
    expect(input).toHaveFocus();
    press('Tab');
    expect(screen.getByRole('button', { name: 'Open datasets' })).toHaveFocus();
    press('Tab');
    expect(screen.getByRole('button', { name: 'Open reports' })).toHaveFocus();
    press('Tab');
    expect(screen.getByRole('button', { name: 'Create a scraper' })).toHaveFocus();
    press('Tab');
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Outside control' })).not.toHaveFocus();
  });

  it('runs the first visible result with Enter after filtering and resets the query when reopened', () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);
    launch();
    const input = screen.getByRole('textbox', { name: 'Search commands' });
    fireEvent.change(input, { target: { value: '  REPORTS ' } });
    expect(within(screen.getByRole('dialog')).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Open datasets' })).not.toBeInTheDocument();
    press('Enter');
    expect(onRun).toHaveBeenCalledExactlyOnceWith(items[1]);
    launch();
    expect(screen.getByRole('textbox', { name: 'Search commands' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Search commands' })).toHaveFocus();
    expect(within(screen.getByRole('dialog')).getAllByRole('button')).toHaveLength(3);
  });

  it('keeps focus contained and does not run a command when there are no matches', () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    render(<Harness onRun={onRun} onClose={onClose} />);
    launch();
    const input = screen.getByRole('textbox', { name: 'Search commands' });
    fireEvent.change(input, { target: { value: 'No such command' } });
    expect(screen.getByText('No commands')).toBeInTheDocument();
    press('ArrowDown');
    press('ArrowUp');
    press('Enter');
    press('Tab');
    expect(input).toHaveFocus();
    press('Tab', { shiftKey: true });
    expect(input).toHaveFocus();
    expect(onRun).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not run commands while an input method is composing', () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);
    launch();
    press('Enter', { isComposing: true });
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not advertise unimplemented per-command shortcuts', () => {
    render(<Harness />);
    launch();
    expect(screen.queryByText('Cmd+D')).not.toBeInTheDocument();
    expect(screen.queryByText('Cmd+R')).not.toBeInTheDocument();
    expect(screen.getByText('Esc')).toBeInTheDocument();
  });

  it('restores focus after closing with the backdrop and preserves click actions', () => {
    const onRun = vi.fn();
    const { container } = render(<Harness onRun={onRun} />);
    const trigger = launch();
    fireEvent.mouseDown(container.querySelector('.command-palette-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'Open datasets' }));
    expect(onRun).toHaveBeenCalledExactlyOnceWith(items[0]);
    expect(trigger).toHaveFocus();
  });
});
