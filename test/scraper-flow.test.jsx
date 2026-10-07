// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationView } from '../src/renderer/src/automation-view.jsx';

beforeEach(() => vi.stubGlobal('requestAnimationFrame', (callback) => callback()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function props(overrides = {}) {
  return {
    state: { recipes: [], runs: [], v5: { recipeVersions: {} } },
    busy: false,
    onSaveRecipe: vi.fn(async (recipe) => ({ ...recipe, id: 'saved-scraper' })),
    onRunRecipe: vi.fn(),
    onDeleteRecipe: vi.fn(async () => ({ recipes: [] })),
    onDiscoverApifyResource: vi.fn(),
    onTestRecipe: vi.fn(),
    onSaveRecipeVersion: vi.fn(),
    ...overrides,
  };
}

function beginScraper(name = 'Customer conversations') {
  fireEvent.click(screen.getByRole('button', { name: 'New scraper' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Scraper name/ }), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

function continueToReview() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('heading', { name: 'Your scraper is ready to save' })).toBeInTheDocument();
}

describe('guided scraper setup', () => {
  it('shows the library until creation is explicitly requested', () => {
    render(<AutomationView {...props()} creationKey={null} />);
    expect(screen.getByRole('heading', { name: 'Your first scraper starts here' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Scraper name/ })).not.toBeInTheDocument();
  });

  it('clears unsaved fields when starting another new scraper with no id', () => {
    render(<AutomationView {...props()} />);
    beginScraper('Discarded draft');
    fireEvent.change(screen.getByRole('textbox', { name: 'Actor ID' }), { target: { value: 'someone/old-actor' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Actor input/ }), { target: { value: '{"oldQuery":"discard"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'All scrapers' }));
    fireEvent.click(screen.getByRole('button', { name: 'New scraper' }));
    expect(screen.getByRole('textbox', { name: /Scraper name/ })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: /Scraper name/ }), { target: { value: 'Fresh draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('textbox', { name: 'Actor ID' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: /Actor input/ })).toHaveValue('{}');
  });

  it('keeps a failed save open and allows retry with the exact input', async () => {
    const onSaveRecipe = vi.fn().mockResolvedValueOnce(null).mockImplementationOnce(async (recipe) => ({ ...recipe, id: 'saved' }));
    render(<AutomationView {...props({ onSaveRecipe })} />);
    beginScraper();
    fireEvent.change(screen.getByRole('textbox', { name: 'Actor ID' }), { target: { value: 'team/custom-actor' } });
    const input = '{"customUrls":["https://example.com"],"exactSetting":false}';
    fireEvent.change(screen.getByRole('textbox', { name: /Actor input/ }), { target: { value: input } });
    continueToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Save scraper' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your scraper could not be saved');
    expect(screen.getByRole('heading', { name: 'Your scraper is ready to save' })).toBeInTheDocument();
    expect(onSaveRecipe).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Customer conversations', inputJson: input, actorId: 'team/custom-actor', taskId: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save scraper' }));
    await waitFor(() => expect(onSaveRecipe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Your scraper is ready to save' })).not.toBeInTheDocument());
  });

  it('catches thrown save errors without discarding the scraper', async () => {
    render(<AutomationView {...props({ onSaveRecipe: vi.fn().mockRejectedValue(new Error('Disk is full')) })} />);
    beginScraper();
    fireEvent.change(screen.getByRole('textbox', { name: 'Actor ID' }), { target: { value: 'team/actor' } });
    continueToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Save scraper' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk is full');
    expect(screen.getByRole('button', { name: 'Save scraper' })).toBeEnabled();
  });

  it('submits only the active saved task when changing resource type', async () => {
    const handlers = props();
    render(<AutomationView {...handlers} />);
    beginScraper();
    fireEvent.change(screen.getByRole('textbox', { name: 'Actor ID' }), { target: { value: 'unused/actor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved task' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Saved task ID' }), { target: { value: 'my-saved-task' } });
    continueToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Save scraper' }));
    await waitFor(() => expect(handlers.onSaveRecipe).toHaveBeenCalledWith(expect.objectContaining({ actorId: '', taskId: 'my-saved-task', inputJson: '{}' })));
  });

  it('submits only the active Actor when changing from a saved task', async () => {
    const recipe = { id: 'existing', name: 'Existing task', platform: 'web', taskId: 'old-task', input: { customField: 12 }, mapper: {} };
    const handlers = props({ state: { recipes: [recipe], runs: [] } });
    render(<AutomationView {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Existing task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use an Actor' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Actor ID' }), { target: { value: 'new/actor' } });
    continueToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Save scraper' }));
    await waitFor(() => expect(handlers.onSaveRecipe).toHaveBeenCalledWith(expect.objectContaining({ id: 'existing', actorId: 'new/actor', taskId: '', inputJson: JSON.stringify(recipe.input, null, 2) })));
  });

  it('selects a requested template source without injecting guessed Actor input', async () => {
    const handlers = props();
    render(<AutomationView {...handlers} initialTemplateId="reddit" creationKey={1} />);
    expect(screen.getByRole('button', { name: /Reddit/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: /Scraper name/ })).toHaveValue('Subreddit pulse');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('textbox', { name: /Actor input/ })).toHaveValue('{}');
    fireEvent.change(screen.getByRole('textbox', { name: 'Actor ID' }), { target: { value: 'real/reddit-actor' } });
    const exactInput = { queries: ['customer feedback'], resultsLimit: 15, includeReplies: false };
    fireEvent.change(screen.getByRole('textbox', { name: /Actor input/ }), { target: { value: JSON.stringify(exactInput) } });
    continueToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Save scraper' }));
    await waitFor(() => expect(handlers.onSaveRecipe).toHaveBeenCalled());
    const saved = handlers.onSaveRecipe.mock.calls[0][0];
    expect(saved.platform).toBe('reddit');
    expect(JSON.parse(saved.inputJson)).toEqual(exactInput);
    expect(JSON.parse(saved.inputJson)).not.toHaveProperty('startUrls');
    expect(JSON.parse(saved.inputJson)).not.toHaveProperty('maxItems');
  });

  it('opens a fresh form when a new creation request arrives while editing', () => {
    const handlers = props();
    const { rerender } = render(<AutomationView {...handlers} initialTemplateId="web" creationKey={1} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Scraper name/ }), { target: { value: 'Previous unsaved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Actor ID' }), { target: { value: 'previous/actor' } });
    rerender(<AutomationView {...handlers} initialTemplateId="linkedin" creationKey={2} />);
    expect(screen.getByRole('textbox', { name: /Scraper name/ })).toHaveValue('LinkedIn account intelligence');
    expect(screen.getByRole('button', { name: 'LinkedIn' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('textbox', { name: 'Actor ID' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: /Actor input/ })).toHaveValue('{}');
  });

  it('blocks missing resources and malformed JSON before review', () => {
    render(<AutomationView {...props()} />);
    beginScraper();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add the Actor ID');
    fireEvent.change(screen.getByRole('textbox', { name: 'Actor ID' }), { target: { value: 'my/actor' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Actor input/ }), { target: { value: '[1,2,3]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('heading', { name: 'Your scraper is ready to save' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('must be a JSON object');
  });
});
