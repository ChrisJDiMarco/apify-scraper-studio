// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KitCreator } from '../src/renderer/src/kit-creator.jsx';

afterEach(cleanup);
const source = { kind: 'report', assetId: 'asset-report' };
const plan = { title: 'Zero click', sourceKey: 'theme:t', sourceKind: 'trend', characters: 2000, evidenceCount: 3, earlierRuns: 0, imagesReady: true, warnings: [], minutes: 8, route: 'claude',
  estimate: { totalUsd: 4, capUsd: 12, calls: 2, modelLabel: 'Claude' },
  folders: [{ id: 'blog', name: 'Blog', items: [{ id: 'blogshort', label: 'Blog — short news update', kind: 'text', selected: true, available: true, usd: 0.6 }] },
    { id: 'social', name: 'Social Team', items: [{ id: 'brand-image', label: 'Social Team — hero graphic', kind: 'image', pictures: 3, references: { style: 0, logo: 0 }, selected: true, available: true, usd: 1.2 }] }] };
const staged = (n) => ({ reference: { id: `kit-reference-${n}`, name: `mood-${n}.png`, bytes: 10, width: 64, height: 64, sha256: `hash-${n}` }, dataUrl: `data:image/png;base64,AAA${n}` });

function open(extra = {}) {
  let n = 0;
  const api = { planAssetKit: vi.fn(async () => plan), createAssetKit: vi.fn(async () => ({ id: 'run' })), stageKitReference: vi.fn(async () => staged(++n)), ...extra };
  const onCreated = vi.fn();
  render(<KitCreator api={api} preset={{ key: 'k', source }} imagesReady action={(work) => work()} busy={false} onClose={vi.fn()} onCreated={onCreated} />);
  return { api, onCreated };
}

describe('Make channel assets: reference pictures for one set', () => {
  it('adds pictures, prices the plan with them and sends them with Make', async () => {
    const { api, onCreated } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a picture' }));
    expect(await screen.findByRole('img', { name: 'mood-1.png' })).toHaveAttribute('src', 'data:image/png;base64,AAA1');
    await waitFor(() => expect(api.planAssetKit).toHaveBeenLastCalledWith({ source, referenceIds: ['kit-reference-1'] }));
    expect(screen.getByText(/Every picture set is drawn from the picture you added here\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a picture' }));
    await screen.findByRole('img', { name: 'mood-2.png' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove mood-1.png' }));
    await waitFor(() => expect(api.planAssetKit).toHaveBeenLastCalledWith({ source, referenceIds: ['kit-reference-2'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Make 2 assets' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Make 2 assets' }));
    await waitFor(() => expect(api.createAssetKit).toHaveBeenCalledWith({ source, referenceIds: ['kit-reference-2'], maxBudgetUsd: 12 }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
  it('stops at four, ignores a cancelled pick and says why a picture was refused', async () => {
    const { api } = open();
    for (let n = 1; n <= 4; n++) { fireEvent.click(await screen.findByRole('button', { name: 'Add a picture' })); await screen.findByRole('img', { name: `mood-${n}.png` }); }
    expect(screen.queryByRole('button', { name: 'Add a picture' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove mood-4.png' }));
    api.stageKitReference.mockResolvedValueOnce({ cancelled: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Add a picture' }));
    await waitFor(() => expect(api.stageKitReference).toHaveBeenCalledTimes(5));
    expect(screen.getAllByRole('img')).toHaveLength(3);
    api.stageKitReference.mockRejectedValueOnce(new Error('Choose a picture under 10 MB.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a picture' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a picture under 10 MB.');
  });
  it('drops pictures the studio no longer holds and plans again without them', async () => {
    const { api } = open();
    await screen.findByRole('button', { name: 'Add a picture' });
    api.planAssetKit.mockRejectedValueOnce(Object.assign(new Error('A reference picture you attached is no longer saved. Remove it and add it again.'), { code: 'referenceGone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a picture' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The pictures you added are no longer saved. Add them again.');
    expect(screen.queryByRole('img')).toBeNull();
    await waitFor(() => expect(api.planAssetKit).toHaveBeenLastCalledWith({ source }));
    expect(screen.getByText('Blog')).toBeInTheDocument();
  });
  it('offers no picker when the set draws no pictures or the studio cannot take one', async () => {
    open({ stageKitReference: undefined });
    await screen.findByText('Blog');
    expect(screen.queryByRole('button', { name: 'Add a picture' })).toBeNull();
  });
});
