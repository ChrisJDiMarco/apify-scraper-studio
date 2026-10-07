// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrandContextView } from '../src/renderer/src/brand-context-view.jsx';
import brandContext from '../src/shared/brand-context.js';

afterEach(cleanup);
const profile = { id: 'brand-1', name: 'Acme', offering: 'Research software', audience: 'Marketers', positioning: 'Evidence first', icp: 'Enterprise teams', brandVoice: 'Direct', forbiddenClaims: 'Guaranteed ROI', competitors: [{ name: 'Other', domain: 'other.example' }] };
const props = (overrides = {}) => ({ state: { brandProfiles: [], settings: {} }, onSaveProfile: vi.fn(async (draft) => ({ ...brandContext.validateBrandContext(draft), id: draft.id || 'brand-new' })), onDeleteProfile: vi.fn(async () => ({ deleted: true })), onSelectProfile: vi.fn(async () => profile), ...overrides });

describe('reusable brand context', () => {
  it('requires a name then saves plain context with structured competitors', async () => {
    const handlers = props();
    render(<BrandContextView {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.getByRole('alert')).toHaveTextContent('brand or company name');
    expect(handlers.onSaveProfile).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: /Brand or company name/ }), { target: { value: ' Acme ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Ideal customer profile (ICP)' }), { target: { value: 'Enterprise teams' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Claims to avoid' }), { target: { value: 'No guaranteed ROI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add competitor' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Competitor 1 name' }), { target: { value: 'Other' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Competitor 1 domain' }), { target: { value: 'other.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Brand profile saved');
    expect(handlers.onSaveProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme', icp: 'Enterprise teams', forbiddenClaims: 'No guaranteed ROI', competitors: [{ name: 'Other', domain: 'other.example' }] }));
  });

  it('preserves a failed draft, including invalid competitor input, for correction', async () => {
    render(<BrandContextView {...props({ state: { brandProfiles: [profile], settings: { selectedBrandProfileId: profile.id } } })} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Competitor 1 domain' }), { target: { value: 'https://user:secret@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('without credentials');
    expect(screen.getByRole('textbox', { name: 'Competitor 1 domain' })).toHaveValue('https://user:secret@example.com');
    expect(screen.getByRole('textbox', { name: /Brand or company name/ })).toHaveValue('Acme');
  });

  it('does not replace an unsaved draft when workspace state refreshes', () => {
    const handlers = props({ state: { brandProfiles: [profile], settings: { selectedBrandProfileId: profile.id } } });
    const { rerender } = render(<BrandContextView {...handlers} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'What do you offer?' }), { target: { value: 'Unsaved local edit' } });
    rerender(<BrandContextView {...handlers} state={{ brandProfiles: [{ ...profile, offering: 'External change' }], settings: { selectedBrandProfileId: profile.id } }} />);
    expect(screen.getByRole('textbox', { name: 'What do you offer?' })).toHaveValue('Unsaved local edit');
  });

  it('requires an explicit delete action and retains the profile if deletion fails', async () => {
    const onDeleteProfile = vi.fn().mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce({ deleted: true });
    render(<BrandContextView {...props({ state: { brandProfiles: [profile], settings: { selectedBrandProfileId: profile.id } }, onDeleteProfile })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
    expect(onDeleteProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep profile' }));
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(screen.getByText('Storage unavailable')).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /Brand or company name/ })).toHaveValue('Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Profile deleted');
    expect(onDeleteProfile).toHaveBeenLastCalledWith('brand-1');
    expect(screen.getByRole('textbox', { name: /Brand or company name/ })).toHaveValue('');
  });

  it('starts a separate draft and selects a saved profile only through the explicit context action', async () => {
    const handlers = props({ state: { brandProfiles: [profile], settings: {} } });
    render(<BrandContextView {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Acme' }));
    expect(handlers.onSelectProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Use as workspace context/ }));
    await waitFor(() => expect(handlers.onSelectProfile).toHaveBeenCalledWith('brand-1'));
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    expect(screen.getByRole('textbox', { name: /Brand or company name/ })).toHaveValue('');
  });
});
