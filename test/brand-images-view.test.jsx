// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrandImages } from '../src/renderer/src/brand-images.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const image = (id, role, name, extra = {}) => ({ id, family: 'sel-editorial', role, name, mime: 'image/png', extension: 'png', bytes: 2048, width: 1200, height: 630, sha256: id.padEnd(64, '0'), addedAt: '2026-10-16T10:00:00Z', ...extra });
function workspace(images = []) {
  return { id: 'semrush', editionId: 'semrush', name: 'Semrush workspace', brandImageSets: [
    { id: 'campaign', deliverableId: 'brand-image', label: 'Semrush campaign graphics', hint: 'Social Team — Hero Graphic.', max: 6, images: [] },
    { id: 'sel-editorial', deliverableId: 'sel-image', label: 'Search Engine Land editorial heroes', hint: 'n8n sent five SEL style examples and the 2026 SEL logo.', max: 6, images },
    { id: 'sel-social', deliverableId: 'sel-social-image', label: 'Search Engine Land social graphics', hint: 'Social Hero.', max: 6, images: [] },
  ] };
}
function api(extra = {}) {
  return { addBrandImage: vi.fn(async () => ({ cancelled: true })), readBrandImage: vi.fn(async ({ imageId }) => ({ id: imageId, dataUrl: `data:image/png;base64,${imageId}` })), setBrandImageRole: vi.fn(async () => ({})), removeBrandImage: vi.fn(async () => ({})), ...extra };
}
const setNamed = (name) => screen.getByRole('article', { name });

describe('Settings → Brand reference images', () => {
  it('shows each picture set with its saved pictures, and adds a style example or the logo to the right set', async () => {
    const bridge = api();
    render(<BrandImages api={bridge} workspace={workspace([image('style-1', 'style', 'sel-style-example-01-link-building-agency.png')])} imagesConfigured />);
    expect(screen.getByRole('heading', { name: 'Brand reference images' })).toBeInTheDocument();
    expect(screen.getAllByRole('article').map(node => within(node).getByRole('heading').textContent)).toEqual(['Semrush campaign graphics', 'Search Engine Land editorial heroes', 'Search Engine Land social graphics']);
    const editorial = setNamed('Search Engine Land editorial heroes');
    expect(within(editorial).getByText('1 of 6')).toBeInTheDocument();
    expect(await within(editorial).findByRole('img', { name: 'sel-style-example-01-link-building-agency.png' })).toHaveAttribute('src', 'data:image/png;base64,style-1');
    expect(bridge.readBrandImage).toHaveBeenCalledWith({ workspaceId: 'semrush', imageId: 'style-1' });
    expect(within(setNamed('Semrush campaign graphics')).getByText(/No reference images yet/)).toBeInTheDocument();
    fireEvent.click(within(editorial).getByRole('button', { name: /Add approved logo/ }));
    await waitFor(() => expect(bridge.addBrandImage).toHaveBeenCalledWith({ workspaceId: 'semrush', family: 'sel-editorial', role: 'logo' }));
    fireEvent.click(within(setNamed('Semrush campaign graphics')).getByRole('button', { name: /Add style example/ }));
    await waitFor(() => expect(bridge.addBrandImage).toHaveBeenLastCalledWith({ workspaceId: 'semrush', family: 'campaign', role: 'style' }));
  });
  it('allows one logo per set, switches a picture between style example and logo, and removes after confirming', async () => {
    const bridge = api(); vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<BrandImages api={bridge} workspace={workspace([image('style-1', 'style', 'example.png'), image('logo-1', 'logo', 'search-engine-land-logo-2026.png', { width: 331, height: 60 })])} imagesConfigured />);
    const editorial = setNamed('Search Engine Land editorial heroes');
    expect(within(editorial).getByRole('button', { name: /Add approved logo/ })).toBeDisabled();
    expect(within(editorial).getByText('331 × 60')).toBeInTheDocument();
    const use = within(editorial).getByRole('combobox', { name: 'How example.png is used' });
    expect(within(use).getByRole('option', { name: 'Approved logo' })).toBeDisabled(); // the set already has its logo
    fireEvent.change(within(editorial).getByRole('combobox', { name: 'How search-engine-land-logo-2026.png is used' }), { target: { value: 'style' } });
    await waitFor(() => expect(bridge.setBrandImageRole).toHaveBeenCalledWith({ workspaceId: 'semrush', imageId: 'logo-1', role: 'style' }));
    fireEvent.click(within(editorial).getByRole('button', { name: 'Remove example.png' }));
    expect(bridge.removeBrandImage).not.toHaveBeenCalled();
    fireEvent.click(within(editorial).getByRole('button', { name: 'Remove example.png' }));
    await waitFor(() => expect(bridge.removeBrandImage).toHaveBeenCalledWith({ workspaceId: 'semrush', imageId: 'style-1' }));
  });
  it('says why a picture was refused, in the set it was added to, and marks a full set', async () => {
    const bridge = api({ addBrandImage: vi.fn(async () => { throw new Error('Choose a PNG, JPEG or WebP picture.'); }), readBrandImage: vi.fn(async () => { throw new Error('The reference image “example.png” is missing from the studio’s data folder. Remove it and add it again.'); }) });
    const full = Array.from({ length: 6 }, (_, index) => image(`style-${index}`, 'style', `example-${index}.png`));
    render(<BrandImages api={bridge} workspace={workspace(full)} imagesConfigured={false} />);
    expect(screen.getByText(/Pictures are drawn once an OpenAI key is saved/)).toBeInTheDocument();
    const editorial = setNamed('Search Engine Land editorial heroes');
    expect(within(editorial).getByRole('button', { name: /Add style example/ })).toBeDisabled(); expect(within(editorial).getByText(/This set is full/)).toBeInTheDocument();
    expect(await within(editorial).findAllByText('File missing')).toHaveLength(6);
    const social = setNamed('Search Engine Land social graphics');
    fireEvent.click(within(social).getByRole('button', { name: /Add style example/ }));
    expect(await within(social).findByRole('alert')).toHaveTextContent('Choose a PNG, JPEG or WebP picture.');
    expect(within(editorial).queryByRole('alert')).toBeNull();
  });
  it('offers a retry when a preview fails to load for another reason, instead of calling the file missing', async () => {
    let fail = true; const bridge = api({ readBrandImage: vi.fn(async ({ imageId }) => { if (fail) { fail = false; throw new Error('The studio server answered 502.'); } return { id: imageId, dataUrl: `data:image/png;base64,${imageId}` }; }) });
    render(<BrandImages api={bridge} workspace={workspace([image('style-1', 'style', 'example.png')])} imagesConfigured />);
    const editorial = setNamed('Search Engine Land editorial heroes');
    fireEvent.click(await within(editorial).findByRole('button', { name: /Preview didn’t load\. Retry/ }));
    expect(await within(editorial).findByRole('img', { name: 'example.png' })).toHaveAttribute('src', 'data:image/png;base64,style-1');
    expect(within(editorial).queryByText('File missing')).toBeNull(); expect(bridge.readBrandImage).toHaveBeenCalledTimes(2);
  });
  it('starts afresh in another workspace: no errors or previews carried over from the last one', async () => {
    const bridge = api({ addBrandImage: vi.fn(async () => { throw new Error('That picture is already in this set.'); }) });
    const general = { id: 'general', editionId: 'general', name: 'Your workspace', brandImageSets: [{ id: 'campaign', deliverableId: 'brand-image', label: 'Campaign graphics', hint: '', max: 6, images: [] }] };
    const { rerender } = render(<BrandImages api={bridge} workspace={workspace()} imagesConfigured />);
    fireEvent.click(within(setNamed('Semrush campaign graphics')).getByRole('button', { name: /Add style example/ }));
    expect(await within(setNamed('Semrush campaign graphics')).findByRole('alert')).toHaveTextContent('already in this set');
    rerender(<BrandImages api={bridge} workspace={general} imagesConfigured />);
    expect(within(setNamed('Campaign graphics')).queryByRole('alert')).toBeNull();
  });
  it('shows nothing without a workspace that has picture sets', () => {
    const { container } = render(<BrandImages api={api()} workspace={{ id: 'general', editionId: 'general' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
