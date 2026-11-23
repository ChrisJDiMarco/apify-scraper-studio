// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrandContextView } from '../src/renderer/src/brand-context-view.jsx';
import brandContext from '../src/shared/brand-context.js';

afterEach(cleanup);
// A product research profile: one product or service of the brand. The brand's own voice and claims to avoid come from
// the Brand tab, so the profile form has no fields for them.
const profile = { id: 'brand-1', name: 'Acme', offering: 'Research software', audience: 'Marketers', positioning: 'Evidence first', icp: 'Enterprise teams', brandVoice: 'Direct', forbiddenClaims: 'Guaranteed ROI', competitors: [{ name: 'Other', domain: 'other.example' }] };
const props = (overrides = {}) => ({ state: { brandProfiles: [], settings: {} }, onSaveProfile: vi.fn(async (draft) => ({ ...brandContext.validateBrandContext(draft), id: draft.id || 'brand-new' })), onDeleteProfile: vi.fn(async () => ({ deleted: true })), onSelectProfile: vi.fn(async () => profile), ...overrides });

describe('reusable brand context', () => {
  it('requires a name then saves plain context with structured competitors', async () => {
    const handlers = props();
    render(<BrandContextView {...handlers} />);
    // Nothing to save until something changes; then the save bar offers to save the new profile.
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ideal customer profile (ICP)' }), { target: { value: 'Enterprise teams' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new profile' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Name the product or service.');
    expect(handlers.onSaveProfile).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: /Product or service name/ }), { target: { value: ' Acme ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Who is it for?' }), { target: { value: 'Marketing teams' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add competitor' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Competitor 1 name' }), { target: { value: 'Other' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Competitor 1 domain' }), { target: { value: 'other.example' } });
    expect(screen.queryByRole('textbox', { name: 'Brand voice' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Claims to avoid' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save new profile' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Profile saved and selected for the data tools.');
    expect(handlers.onSaveProfile).toHaveBeenCalledWith({ name: 'Acme', offering: '', audience: 'Marketing teams', positioning: '', icp: 'Enterprise teams', competitors: [{ name: 'Other', domain: 'other.example' }] });
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
  });

  it('preserves a failed draft, including invalid competitor input, for correction', async () => {
    render(<BrandContextView {...props({ state: { brandProfiles: [profile], settings: { selectedBrandProfileId: profile.id } } })} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Competitor 1 domain' }), { target: { value: 'https://user:secret@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('without credentials');
    expect(screen.getByRole('textbox', { name: 'Competitor 1 domain' })).toHaveValue('https://user:secret@example.com');
    expect(screen.getByRole('textbox', { name: /Product or service name/ })).toHaveValue('Acme');
  });

  it('does not replace an unsaved draft when workspace state refreshes', () => {
    const handlers = props({ state: { brandProfiles: [profile], settings: { selectedBrandProfileId: profile.id } } });
    const { rerender } = render(<BrandContextView {...handlers} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'What does it do?' }), { target: { value: 'Unsaved local edit' } });
    rerender(<BrandContextView {...handlers} state={{ brandProfiles: [{ ...profile, offering: 'External change' }], settings: { selectedBrandProfileId: profile.id } }} />);
    expect(screen.getByRole('textbox', { name: 'What does it do?' })).toHaveValue('Unsaved local edit');
  });

  it('requires an explicit delete action and retains the profile if deletion fails', async () => {
    const onDeleteProfile = vi.fn().mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce({ deleted: true });
    const onNotice = vi.fn();
    render(<BrandContextView {...props({ state: { brandProfiles: [profile], settings: { selectedBrandProfileId: profile.id } }, onDeleteProfile, onNotice })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
    expect(onDeleteProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep profile' }));
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(screen.getByText('Storage unavailable')).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /Product or service name/ })).toHaveValue('Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    // With an onNotice, the page's own toast says so instead of a line in the form.
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Profile deleted. Briefs saved before keep their context.'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(onDeleteProfile).toHaveBeenLastCalledWith('brand-1');
    expect(screen.getByRole('textbox', { name: /Product or service name/ })).toHaveValue('');
  });

  it('starts a separate draft and selects a saved profile only through the explicit context action', async () => {
    const handlers = props({ state: { brandProfiles: [profile], settings: {} } });
    render(<BrandContextView {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Acme' }));
    expect(handlers.onSelectProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Use for the data tools/ }));
    await waitFor(() => expect(handlers.onSelectProfile).toHaveBeenCalledWith('brand-1'));
    expect(await screen.findByRole('status')).toHaveTextContent('The data tools use this profile with the brand’s knowledge.');
    fireEvent.click(screen.getByRole('button', { name: 'New product profile' }));
    expect(screen.getByRole('textbox', { name: /Product or service name/ })).toHaveValue('');
  });
});
