// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelSettings } from '../src/renderer/src/channel-settings.jsx';
import { ViewerContext } from '../src/renderer/src/viewer.js';
import FIELDS from '../src/shared/channel-knowledge.json';

afterEach(cleanup);
const prompt = (id, name, version, extra = {}) => ({ prompt: { id, name, blocks: [{ id: 'instruction', label: 'Instruction', editable: true }, { id: 'schema', label: 'Output', editable: false }] }, blocks: { instruction: `Write the ${name}.` }, version, history: [{ version, by: { name: 'Riley' }, at: '2026-11-01T10:00:00Z', note: 'Shorter' }, { version: version - 1, by: { name: 'Chris' }, at: '2026-10-20T10:00:00Z' }], lockedForYou: false, ...extra });
function settings(channelId = 'blog') {
  return { channelId, channelName: channelId === 'blog' ? 'Semrush Blog' : 'Semrush Social Team', fields: FIELDS.fields, knowledge: { voice: channelId === 'blog' ? 'Plain.' : '', audience: '' }, updatedAt: '', updatedBy: null,
    prompts: channelId === 'blog' ? [prompt('assets.blogshort', 'Blog short', 3), prompt('assets.bloglong', 'Blog long', 2, { lockedForYou: true })] : [prompt('assets.social', 'Social posts', 2)] };
}
const api = () => ({
  readChannelSettings: vi.fn(async ({ channelId }) => settings(channelId)),
  saveChannelKnowledge: vi.fn(async ({ channelId, knowledge }) => ({ channelId, knowledge })),
  saveChannelInstructions: vi.fn(async () => ({ version: 4 })),
  revertChannelInstructions: vi.fn(async () => ({ version: 4 })),
});
const show = (ui) => render(<ViewerContext.Provider value={{ id: 'm-alex', role: 'channel', base: 'channel', preview: false, allowed: null }}>{ui}</ViewerContext.Provider>);

describe('a channel’s settings', () => {
  it('saves the channel knowledge for a channel owner’s own channel', async () => {
    const calls = api(); const onNotice = vi.fn();
    show(<ChannelSettings api={calls} channelId="blog" onNotice={onNotice} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'My channel' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Channel' })).not.toBeInTheDocument(); // their channel only
    const save = screen.getByRole('button', { name: 'Save channel knowledge' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Never do' }), { target: { value: 'No exclamation marks.' } });
    fireEvent.click(save);
    await waitFor(() => expect(calls.saveChannelKnowledge).toHaveBeenCalledWith({ channelId: 'blog', knowledge: expect.objectContaining({ voice: 'Plain.', donts: 'No exclamation marks.' }) }));
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('Semrush Blog'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save channel knowledge' })).toBeDisabled());
  });

  it('edits and restores the asset instructions, and keeps a locked prompt read-only', async () => {
    const calls = api();
    show(<ChannelSettings api={calls} channelId="blog" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Asset instructions' }));
    const short = screen.getByRole('region', { name: 'Blog short' });
    expect(within(short).queryByRole('textbox', { name: 'Output' })).not.toBeInTheDocument(); // only the editable parts
    fireEvent.change(within(short).getByRole('textbox', { name: 'Instruction' }), { target: { value: 'Write it in 300 words.' } });
    fireEvent.change(within(short).getByRole('textbox', { name: 'Note for the history' }), { target: { value: 'Shorter posts' } });
    fireEvent.click(within(short).getByRole('button', { name: 'Save instructions' }));
    await waitFor(() => expect(calls.saveChannelInstructions).toHaveBeenCalledWith({ channelId: 'blog', promptId: 'assets.blogshort', blocks: { instruction: 'Write it in 300 words.' }, expectedVersion: 3, note: 'Shorter posts' }));
    await waitFor(() => expect(calls.readChannelSettings).toHaveBeenCalledTimes(2)); // the saved version is read again
    const again = await screen.findByRole('region', { name: 'Blog short' });
    fireEvent.click(within(again).getByText('Earlier versions'));
    fireEvent.click(within(again).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(calls.revertChannelInstructions).toHaveBeenCalledWith({ channelId: 'blog', promptId: 'assets.blogshort', toVersion: 2, expectedVersion: 3 }));
    const locked = screen.getByRole('region', { name: 'Blog long' });
    expect(within(locked).getByRole('textbox', { name: 'Instruction' })).toBeDisabled();
    expect(within(locked).queryByRole('button', { name: 'Save instructions' })).not.toBeInTheDocument();
  });

  it('lets an admin or editor pick any channel', async () => {
    const calls = api();
    show(<ChannelSettings api={calls} channels={[{ id: 'blog', name: 'Semrush Blog' }, { id: 'social', name: 'Semrush Social Team' }]} />);
    // Channels opens on every channel in one table: how much of each one's knowledge is filled in, at a glance.
    expect(await screen.findByRole('heading', { level: 1, name: 'Channels' })).toBeInTheDocument();
    const blogRow = (await screen.findByRole('rowheader', { name: 'Semrush Blog' })).closest('tr');
    await waitFor(() => expect(blogRow).toHaveTextContent(`1 of ${FIELDS.fields.length} filled in`));
    expect(blogRow).toHaveTextContent('2 prompts');
    const socialRow = screen.getByRole('rowheader', { name: 'Semrush Social Team' }).closest('tr');
    await waitFor(() => expect(socialRow).toHaveTextContent('Empty'));
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 has no channel knowledge yet');
    expect(screen.queryByRole('columnheader', { name: 'Owner' })).not.toBeInTheDocument(); // this role can't read People
    // A row opens that channel; its picker moves to another, and Back returns to the table.
    fireEvent.click(within(blogRow).getByRole('button', { name: 'Semrush Blog' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Semrush Blog' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Channel' }), { target: { value: 'social' } });
    await waitFor(() => expect(calls.readChannelSettings).toHaveBeenLastCalledWith({ channelId: 'social' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Asset instructions' }));
    expect(await screen.findByRole('region', { name: 'Social posts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All channels' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Channels' })).toBeInTheDocument();
  });

  it('names each channel’s owner for a role that can read People, and says which have none', async () => {
    const calls = { ...api(), getTeam: vi.fn(async () => ({ members: [{ id: 'm1', name: 'Alex', base: 'channel', channelId: 'blog' }, { id: 'm2', name: 'Gone', base: 'channel', channelId: 'social', disabled: true }, { id: 'm3', name: 'Riley', base: 'admin' }] })) };
    show(<ChannelSettings api={calls} channels={[{ id: 'blog', name: 'Semrush Blog' }, { id: 'social', name: 'Semrush Social Team' }]} />);
    const blogRow = (await screen.findByRole('rowheader', { name: 'Semrush Blog' })).closest('tr');
    await waitFor(() => expect(blogRow).toHaveTextContent('Alex'));
    expect(screen.getByRole('rowheader', { name: 'Semrush Social Team' }).closest('tr')).toHaveTextContent('No owner');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 has no owner'));
  });
});
