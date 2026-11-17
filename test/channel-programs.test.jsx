// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelPrograms } from '../src/renderer/src/programs-page.jsx';

afterEach(cleanup);
const program = { id: 'firefly', name: 'Adobe Firefly', query: 'Creative workflows', sourceGroups: [{ id: 'x', name: 'X accounts', enabled: true, targets: ['adobefirefly'] }], schedule: { frequency: 'weekly', enabled: true, time: '09:00', timeZone: 'America/New_York', lookbackDays: 7 }, budgets: { aiUsd: 100 }, model: 'SECRET-MODEL' };

describe('channel owner research programs', () => {
  it('opens program facts read-only without editing, generation, costs or models', () => {
    const save = vi.fn();
    render(<ChannelPrograms programs={[program, { id: 'other', name: 'Design trends' }]} workspaceName="Adobe" viewer={{ askAdmin: 'Alex' }} api={{ saveResearchProgram: save }} />);
    expect(screen.getByText('2 research programs')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View Adobe Firefly' }));
    const detail = screen.getByRole('dialog', { name: 'Adobe Firefly' });
    expect(detail).toHaveTextContent('Creative workflows');
    expect(detail).toHaveTextContent('adobefirefly');
    expect(detail).toHaveTextContent('weekly');
    expect(detail.textContent).not.toMatch(/100|SECRET-MODEL/);
    expect(within(detail).queryByRole('button', { name: /Edit|Run now|Save program/ })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('composes an admin request without sending any message', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ChannelPrograms programs={[program]} workspaceName="Adobe" viewer={{ askAdmin: 'Alex' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Contact admin' }));
    const dialog = screen.getByRole('dialog', { name: 'Request a research program change' });
    expect(within(dialog).getByLabelText('Message to your workspace admin').value).toContain('Adobe');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy request' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Request copied');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Adobe'));
  });
});
