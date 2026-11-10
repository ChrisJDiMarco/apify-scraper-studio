// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramAccessField, programsLabel } from '../src/renderer/src/program-access-field.jsx';
import { ProgramPeople } from '../src/renderer/src/programs-page.jsx';

afterEach(cleanup);
const programs = [{ id: 'pulse', name: 'AI search pulse' }, { id: 'weekly', name: 'Weekly listening' }];

describe('choosing someone’s research programs', () => {
  it('starts on All programs, and lists the programs to tick once Only the ones I choose is picked', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ProgramAccessField programs={programs} value={null} onChange={onChange} first="Sam" />);
    expect(screen.getByRole('radio', { name: /All programs/ })).toBeChecked();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Only the programs I choose/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    rerender(<ProgramAccessField programs={programs} value={[]} onChange={onChange} first="Sam" />);
    expect(screen.getByRole('status')).toHaveTextContent('Sam sees no research program’s trends or reports');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Weekly listening' }));
    expect(onChange).toHaveBeenLastCalledWith(['weekly']);
  });

  it('names a person’s programs in a few words', () => {
    expect(programsLabel(null, programs)).toBe('All programs');
    expect(programsLabel([], programs)).toBe('No programs');
    expect(programsLabel(['weekly'], programs)).toBe('Weekly listening');
    expect(programsLabel(['weekly', 'pulse'], programs)).toBe('2 programs');
  });
});

describe('who sees one program', () => {
  const team = { members: [
    { id: 'm-chris', name: 'Chris', base: 'admin', roleLabel: 'Admin', programIds: null },
    { id: 'm-riley', name: 'Riley', base: 'editor', roleLabel: 'Editor', programIds: null },
    { id: 'm-sam', name: 'Sam', base: 'channel', roleLabel: 'Channel owner', programIds: ['pulse'] },
  ] };

  it('lists who sees it, keeps admins on, and saves one person’s programs at a time', async () => {
    const api = { getTeam: vi.fn(async () => team), saveMember: vi.fn(async ({ id, programIds }) => ({ member: { id, programIds } })) };
    render(<ProgramPeople program={programs[1]} programs={programs} api={api} onClose={() => {}} />);
    const riley = await screen.findByRole('switch', { name: /Riley/ });
    expect(riley).toBeChecked(); // every program
    expect(screen.getByRole('switch', { name: /Chris/ })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /Sam/ })).not.toBeChecked();
    // Taking Weekly from someone with every program leaves them the others.
    fireEvent.click(riley);
    await waitFor(() => expect(api.saveMember).toHaveBeenCalledWith({ id: 'm-riley', programIds: ['pulse'] }));
    // Giving Sam the last program they lacked gives them every program again.
    fireEvent.click(screen.getByRole('switch', { name: /Sam/ }));
    await waitFor(() => expect(api.saveMember).toHaveBeenLastCalledWith({ id: 'm-sam', programIds: null }));
  });
});
