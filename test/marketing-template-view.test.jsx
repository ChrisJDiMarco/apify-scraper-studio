// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketingTemplateView } from '../src/renderer/src/marketing-template-view.jsx';

afterEach(cleanup);
const props = (overrides = {}) => ({ templateId: 'competitor-positioning', onSave: vi.fn(async () => ({ id: 'saved' })), onCancel: vi.fn(), onOpenScrapers: vi.fn(), ...overrides });
function fill() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Project or brand' }), { target: { value: 'Acme launch' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'What decision should this help you make?' }), { target: { value: 'Which proof should lead the launch?' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Public page URLs' }), { target: { value: 'https://example.com/product\nhttps://competitor.com/pricing' } });
}

describe('marketing template setup', () => {
  it('shows a clearly labeled outline and saves a bounded collection without starting any workflow', async () => {
    const handlers = props();
    render(<MarketingTemplateView {...handlers} />);
    expect(screen.getByText('Structure preview · no findings yet')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Apify run budget (USD)' })).toHaveValue(2);
    expect(screen.getByText(/A spending ceiling, not an estimated price/)).toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
    expect(handlers.onSave.mock.calls[0][0]).toMatchObject({ actorId: 'apify/website-content-crawler', marketingBrief: { brand: 'Acme launch', reportPresetId: 'competitor-positioning' }, input: { maxCrawlDepth: 0, maxCrawlPages: 2 }, runOptions: { maxTotalChargeUsd: 2, timeoutSecs: 300 } });
    expect(await screen.findByRole('heading', { name: 'Your research is ready to start.' })).toBeInTheDocument();
    expect(screen.getByText('Saving did not start a paid run or generate a report.')).toBeInTheDocument();
    expect(handlers.onOpenScrapers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open saved scrapers' }));
    expect(handlers.onOpenScrapers).toHaveBeenCalledOnce();
  });

  it('focuses invalid input, keeps the draft, and prevents saving credentialed URLs', () => {
    const handlers = props();
    render(<MarketingTemplateView {...handlers} />);
    fill();
    fireEvent.change(screen.getByRole('textbox', { name: 'Public page URLs' }), { target: { value: 'https://user:password@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Remove usernames and passwords');
    expect(screen.getByRole('textbox', { name: 'Public page URLs' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Public page URLs' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'Project or brand' })).toHaveValue('Acme launch');
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it('retains all inputs after a failed save and allows retry', async () => {
    const onSave = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'saved' });
    render(<MarketingTemplateView {...props({ onSave })} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('textbox', { name: 'Project or brand' })).toHaveValue('Acme launch');
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    expect(await screen.findByRole('heading', { name: 'Your research is ready to start.' })).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toEqual(onSave.mock.calls[0][0]);
  });

  it('handles save exceptions without losing the draft', async () => {
    render(<MarketingTemplateView {...props({ onSave: vi.fn().mockRejectedValue(new Error('Storage unavailable')) })} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
    expect(screen.getByRole('button', { name: 'Save collection' })).toBeEnabled();
  });

  it('prevents duplicate submissions and editing while a save is in flight', async () => {
    let resolve;
    const onSave = vi.fn(() => new Promise((done) => { resolve = done; }));
    render(<MarketingTemplateView {...props({ onSave })} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Project or brand' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Saving…' }).closest('form'));
    expect(onSave).toHaveBeenCalledOnce();
    resolve({ id: 'saved' });
    expect(await screen.findByRole('heading', { name: 'Your research is ready to start.' })).toBeInTheDocument();
  });

  it('cancels without saving and resets the draft when a different template is selected', () => {
    const handlers = props();
    const { rerender } = render(<MarketingTemplateView {...handlers} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onCancel).toHaveBeenCalledOnce();
    expect(handlers.onSave).not.toHaveBeenCalled();
    rerender(<MarketingTemplateView {...handlers} templateId="launch-research" />);
    expect(screen.getByRole('heading', { name: 'Launch research pack' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Project or brand' })).toHaveValue('');
  });
  it('applies a saved profile only after explicit selection and preserves decision, URLs, and the context snapshot', async () => {
    const profile = { id: 'brand-1', name: 'Acme', audience: 'Marketing leaders', offering: 'Original offering', icp: 'Enterprise', competitors: [{ name: 'Other', domain: 'other.example' }] };
    const handlers = props({ brandProfiles: [profile], selectedBrandProfileId: 'brand-1', onSelectBrandProfile: vi.fn() });
    const { rerender } = render(<MarketingTemplateView {...handlers} />);
    expect(screen.getByRole('textbox', { name: 'Project or brand' })).toHaveValue('');
    fill();
    fireEvent.change(screen.getByRole('combobox', { name: /Saved brand context/ }), { target: { value: 'brand-1' } });
    expect(screen.getByRole('textbox', { name: 'Project or brand' })).toHaveValue('Acme');
    expect(screen.getByRole('textbox', { name: /Who are you trying/ })).toHaveValue('Marketing leaders');
    expect(screen.getByRole('textbox', { name: 'What decision should this help you make?' })).toHaveValue('Which proof should lead the launch?');
    expect(screen.getByRole('textbox', { name: 'Public page URLs' })).toHaveValue('https://example.com/product\nhttps://competitor.com/pricing');
    expect(handlers.onSelectBrandProfile).toHaveBeenCalledWith('brand-1');
    rerender(<MarketingTemplateView {...handlers} brandProfiles={[{ ...profile, offering: 'New offering' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledOnce());
    expect(handlers.onSave.mock.calls[0][0].marketingBrief.brandContext.offering).toBe('Original offering');
  });

  it('explains the saved ICP requirement and links to profile management for ABM', () => {
    const handlers = props({ templateId: 'account-research', onManageProfiles: vi.fn() });
    render(<MarketingTemplateView {...handlers} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    expect(screen.getByRole('alert')).toHaveTextContent('ideal customer profile');
    expect(screen.getByRole('combobox', { name: /Saved brand context/ })).toHaveFocus();
    expect(handlers.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Manage profiles' }));
    expect(handlers.onManageProfiles).toHaveBeenCalledOnce();
  });

});
