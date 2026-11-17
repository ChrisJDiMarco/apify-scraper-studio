// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceMemberDialog } from '../src/renderer/src/workspace-member-dialog.jsx';

afterEach(cleanup);
const viewer = { isSuperAdmin: true, workspaceId: 'adobe', preview: false };
const team = {
  members: [{ id: 'm-alex', name: 'Alex' }],
  directory: [{ id: 'm-alex', name: 'Alex', email: 'alex@example.com' }, { id: 'm-riley', name: 'Riley', email: 'riley@example.com' }],
  channels: [{ id: 'social', name: 'Social' }],
  access: { roles: [{ id: 'admin', label: 'Admin', base: 'admin' }, { id: 'editor', label: 'Editor', base: 'editor' }, { id: 'channel', label: 'Channel owner', base: 'channel' }] },
};

it('adds an existing global account to this workspace with a channel role, without inviting it', async () => {
  const api = { saveWorkspaceMembership: vi.fn(async () => ({ ok: true })), inviteMembers: vi.fn() };
  const onSaved = vi.fn();
  render(<WorkspaceMemberDialog viewer={viewer} team={team} api={api} workspaceName="Adobe" onClose={() => {}} onSaved={onSaved} />);
  expect(screen.queryByRole('option', { name: /Alex/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Existing person'), { target: { value: 'm-riley' } });
  fireEvent.change(screen.getByLabelText('Role in Adobe'), { target: { value: 'channel' } });
  expect(screen.getByRole('button', { name: 'Add to workspace' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'social' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add to workspace' }));
  await waitFor(() => expect(api.saveWorkspaceMembership).toHaveBeenCalledWith({ memberId: 'm-riley', workspaceId: 'adobe', role: 'channel', channelId: 'social' }));
  expect(api.inviteMembers).not.toHaveBeenCalled();
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('keeps a failed assignment open so it can be corrected and retried', async () => {
  const api = { saveWorkspaceMembership: vi.fn().mockRejectedValueOnce(new Error('Access changed. Reload and try again.')).mockResolvedValue({ ok: true }) };
  render(<WorkspaceMemberDialog viewer={viewer} team={team} api={api} workspaceName="Adobe" onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText('Existing person'), { target: { value: 'm-riley' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add to workspace' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access changed.');
  expect(screen.getByLabelText('Existing person')).toHaveValue('m-riley');
  fireEvent.click(screen.getByRole('button', { name: 'Add to workspace' }));
  await waitFor(() => expect(api.saveWorkspaceMembership).toHaveBeenCalledTimes(2));
});

it('does not expose global account assignment to a workspace admin or a preview', () => {
  const { rerender } = render(<WorkspaceMemberDialog viewer={{ ...viewer, isSuperAdmin: false }} team={team} api={{}} onClose={() => {}} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  rerender(<WorkspaceMemberDialog viewer={{ ...viewer, preview: true }} team={team} api={{}} onClose={() => {}} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
