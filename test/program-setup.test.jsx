// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramSetup } from '../src/renderer/src/program-setup.jsx';
import { ViewerContext } from '../src/renderer/src/viewer.js';
import setup from '../src/shared/program-setup.js';
import research from '../src/shared/research-program.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const workspace = { id: 'semrush', name: 'Main', editionId: 'semrush', knowledge: { name: 'Semrush', audience: 'Marketers' }, products: [{ id: 'p1' }] };
const answer = { sources: { x: [{ target: 'acmeai', name: 'Acme AI', why: 'The official account.' }], linkedin: [{ target: 'https://www.linkedin.com/company/acme', name: 'Acme', why: 'Company page.' }], reddit: [{ target: 'generativeai', name: 'r/generativeAI', why: 'Practitioners compare tools.' }] }, brand: { audience: 'Creators and marketing teams', positioning: 'Commercially safe AI images', voice: 'Clear', forbiddenClaims: 'No guaranteed results' }, notes: '', dropped: 1 };
function open({ firstRun = false, space = workspace } = {}) {
  const api = {
    estimateProgramSetup: vi.fn(async () => ({ route: 'claude-api', routeLabel: 'Claude API', modelLabel: 'Claude Opus 5.5', metered: true, estimateUsd: 0.06 })),
    suggestProgramSetup: vi.fn(async () => answer),
    saveResearchProgram: vi.fn(async (program) => ({ program: { ...program, id: 'program-new' } })),
    saveContentWorkspace: vi.fn(async () => ({})),
  };
  const onSaved = vi.fn();
  render(<ViewerContext.Provider value={{ id: 'local', role: 'admin', base: 'admin', preview: false, allowed: null }}><ProgramSetup api={api} workspace={space} firstRun={firstRun} onClose={() => {}} onSaved={onSaved} /></ViewerContext.Provider>);
  return { api, onSaved };
}
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const type = (name, value) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });

describe('guided setup of a research program', () => {
  it('suggests sources after the estimate, keeps the chosen ones, writes for another brand, and saves a valid program', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api, onSaved } = open();
    type('Company', 'Acme'); type('Vertical or industry', 'AI images'); type('What should research follow?', 'AI image tools');
    fireEvent.click(screen.getByRole('radio', { name: /Another brand/ }));
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest sources' }));
    await waitFor(() => expect(api.suggestProgramSetup).toHaveBeenCalledWith({ company: 'Acme', website: '', vertical: 'AI images', focus: 'AI image tools', wantBrand: true, wantSources: true }));
    expect(api.estimateProgramSetup).toHaveBeenCalled(); // the estimate came first
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('About $0.06 on Claude Opus 5.5'));
    expect(await screen.findByText(/1 suggestion wasn’t a valid account/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /r\/generativeAI/ })); // not this one
    fireEvent.change(within(screen.getByRole('group', { name: 'Subreddits' })).getByRole('textbox', { name: 'Add your own' }), { target: { value: 'r/StableDiffusion' } });
    next();
    expect(screen.getByRole('textbox', { name: 'Who it serves' })).toHaveValue('Creators and marketing teams'); // Ask AI's draft
    type('Brand name', 'Acme Images');
    next(); next();
    expect(screen.getByText('Acme · AI image tools')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save program' }));
    await waitFor(() => expect(api.saveResearchProgram).toHaveBeenCalled());
    const saved = api.saveResearchProgram.mock.calls[0][0];
    const targets = Object.fromEntries(saved.sourceGroups.filter((group) => group.enabled).map((group) => [group.sourceId, group.targets]));
    expect(targets).toEqual({ x: ['acmeai'], 'linkedin-profile': ['https://www.linkedin.com/company/acme'], reddit: ['r/StableDiffusion'] });
    expect(saved.brand).toMatchObject({ mode: 'own', name: 'Acme Images', audience: 'Creators and marketing teams' });
    // The server's own check accepts it.
    expect(() => research.validateResearchProgram({ ...saved, id: 'program-new' })).not.toThrow();
    expect(api.saveContentWorkspace).not.toHaveBeenCalled(); // another brand never changes the studio's
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'program-new' }));
    expect(await screen.findByRole('heading', { name: '“Acme · AI image tools” is saved' })).toBeInTheDocument();
  });

  it('asks nothing of AI until asked, and refuses to save without a source', async () => {
    const { api } = open();
    type('Company', 'Acme'); type('Vertical or industry', 'AI images');
    for (let i = 0; i < 4; i += 1) next();
    fireEvent.click(screen.getByRole('button', { name: 'Save program' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose or add at least one source');
    expect(api.suggestProgramSetup).not.toHaveBeenCalled();
    expect(api.saveResearchProgram).not.toHaveBeenCalled();
  });

  it('on the studio’s first setup, saves the brand as the workspace’s, keeping its products', async () => {
    const { api } = open({ firstRun: true, space: { ...workspace, knowledge: {} } });
    type('Company', 'Acme'); type('Vertical or industry', 'AI images');
    next();
    fireEvent.change(within(screen.getByRole('group', { name: 'X accounts' })).getByRole('textbox', { name: 'Add your own' }), { target: { value: '@acmeai' } });
    next();
    type('Brand name', 'Acme'); type('Voice', 'Plain');
    next(); next();
    fireEvent.click(screen.getByRole('button', { name: 'Save program' }));
    await waitFor(() => expect(api.saveContentWorkspace).toHaveBeenCalledWith(expect.objectContaining({ id: 'semrush', knowledge: expect.objectContaining({ name: 'Acme', voice: 'Plain' }), products: [{ id: 'p1' }] })));
    expect(api.saveResearchProgram.mock.calls[0][0].brand).toBeUndefined();
  });
});

describe('setup suggestions, checked', () => {
  it('keeps only sources the program form accepts, without duplicates, and needs a company and vertical', () => {
    const clean = setup.cleanSetup({ sources: { x: [{ target: '@AcmeAI', name: 'Acme', why: 'x' }, { target: 'acmeai', name: 'Again', why: '' }, { target: 'not a handle!', name: 'Bad', why: '' }], linkedin: [{ target: 'https://example.com/acme', name: 'Bad', why: '' }], reddit: [{ target: 'r/GenerativeAI', name: 'r', why: '' }] }, brand: { audience: ' Marketers ' } });
    expect(clean.sources.x.map((row) => row.target)).toEqual(['acmeai']);
    expect(clean.sources.linkedin).toEqual([]);
    expect(clean.sources.reddit.map((row) => row.target)).toEqual(['generativeai']);
    expect(clean.dropped).toBe(2);
    expect(clean.brand.audience).toBe('Marketers');
    expect(() => setup.setupRequest({ company: 'Acme' })).toThrow('vertical');
    expect(setup.setupPrompt(setup.setupRequest({ company: 'Acme', vertical: 'AI' }), { editionId: 'general' })).toContain('SETUP_REQUEST');
  });

  it('keeps a program’s own brand, and drops it for the workspace’s', () => {
    const base = { ...research.DEFAULT_RESEARCH_PROGRAM, id: 'p', workspaceId: 'w', name: 'Firefly', sourceGroups: [{ id: 's', sourceId: 'x', platform: 'x', name: 'X', targets: ['adobefirefly'], enabled: true, options: {} }] };
    expect(research.validateResearchProgram({ ...base, brand: { mode: 'own', name: 'Adobe Firefly', voice: 'Inspiring' } }).brand).toEqual({ mode: 'own', name: 'Adobe Firefly', voice: 'Inspiring' });
    expect(research.validateResearchProgram({ ...base, brand: { mode: 'workspace' } }).brand).toBeUndefined();
    expect(() => research.validateResearchProgram({ ...base, brand: { mode: 'own' } })).toThrow('Name the brand');
  });
});
