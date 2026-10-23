// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import { ContentStudioView } from '../src/renderer/src/content-studio-view.jsx';

// Ask AI's hand-offs, as App wires them in both layouts: a research program card, its Open button and a [[Program]]
// link land on Research programs with that program selected, not on whichever program was picked last or is newest.
afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } });

const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: {}, products: [] }];
const programs = [
  { id: 'p-old', workspaceId: 'semrush', name: 'Older program', query: 'Older question', budgets: { collectionUsd: 5, aiUsd: 3 }, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z' },
  { id: 'p-new', workspaceId: 'semrush', name: 'Newer program', query: 'Newer question', budgets: { collectionUsd: 5, aiUsd: 3 }, createdAt: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:00:00Z' },
];
// Ask AI answers about the older program: a program card, an Open button for it and an in-answer link to it.
const reply = {
  answer: 'Here is [Older program](studio:program/p-old).', pages: [], followUps: [],
  actions: [{ kind: 'open', label: 'Open the older program', target: 'Older program', programId: 'p-old', ref: { kind: 'program', id: 'p-old' }, params: { type: 'program' } }],
  cards: [{ type: 'program', title: 'Older program', note: '', actionIndexes: [], data: { programId: 'p-old', name: 'Older program' } }],
};

async function openStudio(uiMode) {
  const state = {
    projects: [], recipes: [], datasets: [], cards: [], assets: [], runs: [], analyses: [], jobs: [],
    keys: { APIFY_API_TOKEN: true }, settings: { maxItems: 1000, sheets: {}, uiMode },
    v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } },
    contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs, researchRuns: [], contentRuns: [], themes: [], assets: [], availableDatasets: [], availableReports: [], capabilities: {}, promptChanges: [] },
  };
  const api = {
    appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => state), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [] })),
    contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []),
    estimateResearchProgram: vi.fn(async () => ({ ai: { totalUsd: 1 }, collection: { worstCaseUsd: 1 } })),
    setViewPrefs: vi.fn(async () => ({ viewer: null })), saveSettings: vi.fn(async () => state),
    saveResearchProgram: vi.fn(async (program) => ({ program })), startResearchRun: vi.fn(async () => ({ id: 'research-2' })),
    askHelp: vi.fn(async () => reply),
  };
  window.apifyStudio = api;
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: /^This week in/ });
  // Someone who used Advanced has the stages' tools showing; from an Advanced page, Ask AI is the drawer beside it.
  if (uiMode === 'classic') {
    fireEvent.click(document.querySelector('[data-spot="nav.board"]'));
    await waitFor(() => expect(document.querySelector('.app-shell')).toHaveAttribute('data-mode', 'classic'));
  }
  return api;
}
const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }));
const selectedProgram = () => document.querySelector('.cs-program-choice.selected')?.querySelector('strong')?.textContent || '';
const pickProgram = (name) => fireEvent.click([...document.querySelectorAll('.cs-program-choice')].find((button) => button.querySelector('strong')?.textContent === name));
async function askInDrawer() {
  fireEvent.click(document.querySelector('[data-spot="nav.ask"]'));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Question about Golden Thread' }), { target: { value: 'Tell me about the older program' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  return screen.findByRole('article', { name: 'Answer' });
}

describe('Ask AI opens the research program it is about', () => {
  it('in the Advanced layout: the card, the Open button and the link each select that program', async () => {
    const api = await openStudio('classic');
    const answer = await askInDrawer();
    // The newest program is what the page would open on by itself.
    fireEvent.click(within(answer).getByRole('button', { name: /See the program/ }));
    await waitFor(() => expect(selectedProgram()).toBe('Older program'));
    expect(mainNav().getByRole('button', { name: /^Research programs/ })).toHaveAttribute('aria-current', 'page');
    expect(within(document.querySelector('.cs-research-main')).getByRole('heading', { level: 3, name: 'Older program' })).toBeInTheDocument();

    // Already showing the page: the in-answer link still moves the selection. The Open button names the same program,
    // so the answer shows the two as one reference chip.
    pickProgram('Newer program');
    expect(selectedProgram()).toBe('Newer program');
    const refs = within(answer).getByRole('group', { name: 'In this answer' });
    expect(within(refs).getAllByRole('button').map((button) => button.textContent)).toEqual(['Older program']);
    expect(within(answer).queryByRole('button', { name: 'Open the older program' })).toBeNull();
    fireEvent.click(within(refs).getByRole('button', { name: /^Older program/ }));
    await waitFor(() => expect(selectedProgram()).toBe('Older program'));
    // An answer whose text doesn't link it: its Open button is the chip, and runs through the shared runner.
    pickProgram('Newer program');
    api.askHelp.mockImplementationOnce(async () => ({ ...reply, answer: 'Here it is.' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Question about Golden Thread' }), { target: { value: 'Open it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(screen.getAllByRole('article', { name: 'Answer' })).toHaveLength(2));
    const second = screen.getAllByRole('article', { name: 'Answer' })[1];
    fireEvent.click(await within(second).findByRole('button', { name: 'Open the older program' }));
    await waitFor(() => expect(selectedProgram()).toBe('Older program'));

    // A request is taken once: choosing another program, leaving and coming back keeps that choice.
    pickProgram('Newer program');
    fireEvent.click(mainNav().getByRole('button', { name: /^Library/ }));
    await waitFor(() => expect(document.querySelector('.cs-program-choice')).not.toBeInTheDocument());
    fireEvent.click(mainNav().getByRole('button', { name: /^Research programs/ }));
    await waitFor(() => expect(selectedProgram()).toBe('Newer program'));
  });

  it('in the Simple layout: See the program opens Research programs on that program', async () => {
    await openStudio('simple');
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask AI' }), { target: { value: 'Tell me about the older program' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const answer = await screen.findByRole('article', { name: 'Answer' });
    fireEvent.click(within(answer).getByRole('button', { name: /See the program/ }));
    await waitFor(() => expect(selectedProgram()).toBe('Older program'));
    expect(within(document.querySelector('.cs-research-main')).getByRole('heading', { level: 3, name: 'Older program' })).toBeInTheDocument();
  });
});

describe('a program request is taken once', () => {
  // Research programs hands each request back as it takes it (App then drops it), so switching workspace while the page
  // is open doesn't replay "open Older program" into a workspace that doesn't have it.
  it('doesn’t replay into another workspace', async () => {
    const other = { id: 'other', name: 'Other workspace', editionId: 'general', knowledge: {}, products: [] };
    const studio = (activeWorkspaceId) => ({ activeWorkspaceId, workspaces: [...workspaces, other], programs: [...programs, { id: 'p-other', workspaceId: 'other', name: 'Other program', budgets: { collectionUsd: 5, aiUsd: 3 } }], researchRuns: [], contentRuns: [], assets: [], availableDatasets: [], availableReports: [], capabilities: {}, promptChanges: [] });
    const api = { contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), estimateResearchProgram: vi.fn(async () => ({ ai: { totalUsd: 1 }, collection: { worstCaseUsd: 1 } })) };
    const handled = vi.fn(); const onNotice = vi.fn();
    function Studio({ workspaceId }) {
      const [request, setRequest] = React.useState({ kind: 'open', key: 1, programId: 'p-old' });
      return <ContentStudioView state={{ contentStudio: studio(workspaceId) }} api={api} initialView="research" programRequest={request} onNotice={onNotice}
        onProgramRequestHandled={(key) => { handled(key); setRequest((current) => (current?.key === key ? null : current)); }} />;
    }
    const { rerender } = render(<Studio workspaceId="semrush" />);
    await waitFor(() => expect(selectedProgram()).toBe('Older program'));
    expect(handled).toHaveBeenCalledWith(1);
    rerender(<Studio workspaceId="other" />);
    await waitFor(() => expect(selectedProgram()).toBe('Other program'));
    expect(onNotice).not.toHaveBeenCalledWith(expect.stringMatching(/isn’t in this workspace/));
  });
  it('says so when the program isn’t in this workspace', async () => {
    const onNotice = vi.fn();
    render(<ContentStudioView state={{ contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs, researchRuns: [], contentRuns: [], assets: [], availableDatasets: [], availableReports: [], capabilities: {}, promptChanges: [] } }} api={{ contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), estimateResearchProgram: vi.fn(async () => ({})) }} initialView="research" programRequest={{ kind: 'open', key: 2, programId: 'p-gone' }} onNotice={onNotice} />);
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('That research program isn’t in this workspace. It may be in another workspace, or it was removed.'));
    expect(selectedProgram()).toBe('Newer program');
  });
});
