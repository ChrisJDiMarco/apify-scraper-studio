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
  it('requires a description before choosing an image and keeps the saved example on the channel', async () => {
    const reference = { id: 'image-1', name: 'example.png', description: 'Bold headline, simple layout.' };
    const calls = { ...api(), addChannelReference: vi.fn(async () => ({ reference, dataUrl: 'data:image/png;base64,YQ==' })), saveChannelReference: vi.fn(async ({ description }) => ({ reference: { ...reference, description } })), removeChannelReference: vi.fn(async () => ({ removed: 'image-1' })) };
    show(<ChannelSettings api={calls} channelId="blog" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Image examples' }));
    const choose = screen.getByRole('button', { name: 'Choose image and save example' });
    expect(choose).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Why this example works' }), { target: { value: reference.description } });
    fireEvent.click(choose);
    await waitFor(() => expect(calls.addChannelReference).toHaveBeenCalledWith({ channelId: 'blog', description: reference.description }));
    expect(await screen.findByRole('img', { name: 'Example: example.png' })).toHaveAttribute('src', 'data:image/png;base64,YQ==');
    const edit = screen.getByRole('textbox', { name: 'Description for example.png' });
    fireEvent.change(edit, { target: { value: 'Keep the spacious layout.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save description for example.png' }));
    await waitFor(() => expect(calls.saveChannelReference).toHaveBeenCalledWith({ channelId: 'blog', imageId: 'image-1', description: 'Keep the spacious layout.' }));
    expect(screen.getByRole('button', { name: 'Save description for example.png' })).toBeDisabled();
  });

  it('shows saved examples in previews without allowing uploads or edits', async () => {
    const calls = { ...api(), readChannelSettings: vi.fn(async () => ({ ...settings(), references: [{ id: 'image-1', name: 'saved.png', description: 'Use the simple spacing.' }] })), readChannelReference: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,YQ==' })), addChannelReference: vi.fn() };
    render(<ViewerContext.Provider value={{ role: 'channel', preview: true }}><ChannelSettings api={calls} channelId="blog" /></ViewerContext.Provider>);
    fireEvent.click(await screen.findByRole('tab', { name: 'Image examples' }));
    expect(await screen.findByRole('img', { name: 'Example: saved.png' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Description for saved.png' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose image and save example' })).toBeDisabled();
    expect(calls.addChannelReference).not.toHaveBeenCalled();
  });

  it('saves the channel knowledge for a channel owner’s own channel', async () => {
    const calls = api(); const onNotice = vi.fn();
    show(<ChannelSettings api={calls} channelId="blog" onNotice={onNotice} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'My channel' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Channel' })).not.toBeInTheDocument(); // their channel only
    // The save bar comes up once something changed, and goes once it's saved.
    const never = await screen.findByRole('textbox', { name: 'Never do' });
    expect(screen.queryByRole('button', { name: 'Save channel knowledge' })).not.toBeInTheDocument();
    fireEvent.change(never, { target: { value: 'No exclamation marks.' } });
    const bar = screen.getByRole('region', { name: 'Unsaved changes' });
    expect(within(bar).getByText('1 unsaved change')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Save channel knowledge' }));
    await waitFor(() => expect(calls.saveChannelKnowledge).toHaveBeenCalledWith({ channelId: 'blog', knowledge: expect.objectContaining({ voice: 'Plain.', donts: 'No exclamation marks.' }) }));
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('Semrush Blog'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save channel knowledge' })).not.toBeInTheDocument());
  });

  it('edits and restores the asset instructions, and keeps a locked prompt read-only', async () => {
    // The blog writes with three prompts here: Blog short, Blog long (an admin locked it) and Newsletter.
    const calls = { ...api(), readChannelSettings: vi.fn(async ({ channelId }) => ({ ...settings(channelId), prompts: [...settings(channelId).prompts, prompt('assets.newsletter', 'Newsletter', 2)] })) };
    const onNotice = vi.fn();
    show(<ChannelSettings api={calls} channelId="blog" onNotice={onNotice} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Asset instructions' }));
    const short = screen.getByRole('region', { name: 'Blog short' });
    expect(within(short).queryByRole('textbox', { name: 'Blog short: Output' })).not.toBeInTheDocument(); // only the editable parts
    // Locked: its text as text, with nothing to change or restore.
    const locked = screen.getByRole('region', { name: 'Blog long' });
    expect(within(locked).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(locked).getByText('Write the Blog long.')).toBeInTheDocument();
    expect(within(locked).getByText(/Read only: an admin locked it/)).toBeInTheDocument();
    expect(within(locked).queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    // One save bar and one note for the history for every instruction on the tab, once something changed.
    expect(screen.queryByRole('button', { name: /^Save instruction/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Note for the history' })).not.toBeInTheDocument();
    fireEvent.change(within(short).getByRole('textbox', { name: 'Blog short: Instruction' }), { target: { value: 'Write it in 300 words.' } });
    expect(within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save instruction' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Newsletter: Instruction' }), { target: { value: 'Three stories, one line each.' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note for the history' }), { target: { value: 'Shorter posts' } });
    const bar = screen.getByRole('region', { name: 'Unsaved changes' });
    expect(within(bar).getByText('2 unsaved changes')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Save instructions' }));
    await waitFor(() => expect(calls.saveChannelInstructions).toHaveBeenCalledTimes(2));
    expect(calls.saveChannelInstructions).toHaveBeenNthCalledWith(1, { channelId: 'blog', promptId: 'assets.blogshort', blocks: { instruction: 'Write it in 300 words.' }, expectedVersion: 3, note: 'Shorter posts' });
    expect(calls.saveChannelInstructions).toHaveBeenNthCalledWith(2, { channelId: 'blog', promptId: 'assets.newsletter', blocks: { instruction: 'Three stories, one line each.' }, expectedVersion: 2, note: 'Shorter posts' });
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Saved 2 instructions. New assets use them.'));
    await waitFor(() => expect(calls.readChannelSettings).toHaveBeenCalledTimes(2)); // the saved versions are read again
    const again = await screen.findByRole('region', { name: 'Blog short' });
    fireEvent.click(within(again).getByText('Earlier versions'));
    fireEvent.click(within(again).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(calls.revertChannelInstructions).toHaveBeenCalledWith({ channelId: 'blog', promptId: 'assets.blogshort', toVersion: 2, expectedVersion: 3 }));
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
    await waitFor(() => expect(socialRow).toHaveTextContent('None yet'));
    expect(screen.getByText('1 of 2 has no channel knowledge yet: their assets are written from the brand knowledge alone.')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Owner' })).not.toBeInTheDocument(); // this role can't read People
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); // so nothing is said about owners
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Channel', 'Channel knowledge', 'Asset instructions', 'Last saved']);
    // The row opens that channel (there's no Open column); its picker moves to another, and Back returns to the table.
    fireEvent.click(within(blogRow).getByText('2 prompts'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Semrush Blog' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Channel settings' })).toHaveClass('people-tabs');
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
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();
    // The Owner cell: a disabled owner doesn't count.
    expect(within(screen.getByRole('rowheader', { name: 'Semrush Social Team' }).closest('tr')).getAllByRole('cell')[0]).toHaveTextContent(/^None$/);
    // One notice says what needs doing, with the way to do it.
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('1 channel has no owner.');
    expect(within(notice).getByRole('link', { name: 'Assign owners' })).toHaveAttribute('href', '#/studio/people');
  });
});
