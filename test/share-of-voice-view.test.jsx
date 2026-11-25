// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ShareOfVoice } from '../src/renderer/src/share-of-voice.jsx';
import voice from '../src/shared/share-of-voice.js';

afterEach(cleanup);

it('drills into brand/platform and keyword evidence while retaining the aggregate dashboard', async () => {
  const settings = voice.validateTracking({
    enabled: true, terms: ['AI search', 'AI Overviews'], brands: [{ name: 'Semrush' }, { name: 'Moz' }],
  });
  const posts = [
    { platform: 'linkedin', text: 'Semrush and Moz discuss AI search.', externalId: '1' },
    { platform: 'x', text: 'A Semrush guide to AI Overviews.', externalId: '2' },
    { platform: 'linkedin', text: 'A practitioner asks about AI Overviews.', externalId: '3' },
  ].map((row) => voice.normalizePost({ ...row, publishedAt: '2026-11-25' }));
  const api = { readShareOfVoice: vi.fn(async (query) => ({ settings, ...voice.trackingSummary(settings, posts, query) })) };
  render(<ShareOfVoice api={api} program={{ id: 'ai-search', name: 'AI search' }} />);
  const platformCell = await screen.findByRole('button', { name: 'Semrush on LinkedIn, 50.0% share, view 1 post' });
  expect(screen.getByRole('button', { name: '14 days' })).toBeInTheDocument();
  fireEvent.click(platformCell);
  const evidence = screen.getByRole('region', { name: 'Evidence posts' });
  expect(await within(evidence).findByText('1 matching post on LinkedIn')).toBeInTheDocument();
  expect(within(evidence).queryByText('A Semrush guide to AI Overviews.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Semrush on X, 100.0% share, view 1 post' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveValue('');

  fireEvent.click(screen.getByRole('button', { name: 'View posts about AI Overviews' }));
  expect(await within(evidence).findByRole('heading', { name: 'Posts about AI Overviews' })).toBeInTheDocument();
  expect(within(evidence).getAllByRole('article')).toHaveLength(2);
  fireEvent.click(within(evidence).getByRole('button', { name: 'Clear post filter' }));
  expect(await within(evidence).findByText('3 matching posts')).toBeInTheDocument();
});
