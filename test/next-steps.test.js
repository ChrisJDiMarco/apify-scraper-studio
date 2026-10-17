import { describe, expect, it } from 'vitest';
import { nextSteps, setupChecklist } from '../src/renderer/src/next-steps.js';
import { defaultProgram } from '../src/renderer/src/choices.js';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const theme = (id, name) => ({ id, name, evidenceCount: 6, platforms: ['x'] });
const yes = () => true;
const only = (...methods) => (method) => methods.includes(method);

// One workspace: a run with two trends (one approved, one waiting), a finished run whose trend's report has been ready
// for two days with no channel assets, a research run that stopped, an asset in review and a missed planned date.
function state(extra = {}) {
  return {
    keys: { APIFY_API_TOKEN: true },
    contentStudio: {
      activeWorkspaceId: 'ws', workspaces: [{ id: 'ws', name: 'Semrush workspace', editionId: 'semrush' }],
      programs: [{ id: 'p', workspaceId: 'ws', name: 'AI search pulse', updatedAt: iso(NOW - 5 * DAY) }],
      researchRuns: [
        { id: 'review', workspaceId: 'ws', programId: 'p', status: 'awaiting-review', createdAt: iso(NOW - DAY), discoveredThemes: [theme('t-1', 'Agentic checkout'), theme('t-2', 'Zero click')], decisions: { 't-1': 'approved' } },
        { id: 'done', workspaceId: 'ws', programId: 'p', status: 'succeeded', createdAt: iso(NOW - 4 * DAY), discoveredThemes: [theme('t-3', 'AI Overviews')], themes: [theme('t-3', 'AI Overviews')], reportRunIds: [{ themeId: 't-3', runId: 'report' }] },
        { id: 'broken', workspaceId: 'ws', programId: 'q', title: 'Reddit listening', status: 'failed', message: 'Apify refused the token.', createdAt: iso(NOW - 2 * DAY) },
      ],
      contentRuns: [{ id: 'report', workspaceId: 'ws', status: 'succeeded', themeId: 't-3', researchRunId: 'done', createdAt: iso(NOW - 3 * DAY) }],
      assets: [
        { id: 'asset-report', workspaceId: 'ws', runId: 'report', deliverableId: 'evidence-report', title: 'AI Overviews — Trends report', createdAt: iso(NOW - 2 * DAY) },
        { id: 'asset-review', workspaceId: 'ws', runId: 'report', deliverableId: 'editorial-toolkit', title: 'TREND: AI Overviews', createdAt: iso(NOW - 2 * DAY), review: { status: 'in-review', at: iso(NOW - DAY) } },
      ],
      adoptionsByTheme: { 't-3': { social: { status: 'using', plannedFor: '2026-10-14', channelName: 'Semrush Social Team' } } },
      ...extra,
    },
  };
}

describe('Next up', () => {
  it('ranks stopped work first, then what this person can do now, each with one action', () => {
    const rows = nextSteps({ state: state(), can: yes, now: NOW, origin: 'https://studio.example.com' });
    expect(rows.map((row) => row.kind)).toEqual(['stopped', 'decide', 'write-reports', 'make-assets', 'review', 'add-link']);
    expect(rows[0]).toMatchObject({ title: 'Research stopped · Reddit listening', detail: 'Apify refused the token.', action: { kind: 'retry', runId: 'broken', label: 'Try again' } });
    expect(rows.find((row) => row.kind === 'write-reports')).toMatchObject({ title: '1 approved trend is waiting for reports', action: { kind: 'write-reports' } });
    expect(rows.find((row) => row.kind === 'make-assets')).toMatchObject({ title: 'Make channel assets for “AI Overviews”', action: { kind: 'make-assets', assetId: 'asset-report' } });
    expect(rows.find((row) => row.kind === 'review').action).toEqual({ kind: 'open', target: { kind: 'report', id: 'asset-review', page: 'reports' }, label: 'Review' });
    // An admin adds the link under Analytics' Change answer.
    expect(rows.find((row) => row.kind === 'add-link').action).toEqual({ kind: 'open', target: { kind: 'page', page: 'analytics' }, label: 'Open Analytics' });
  });

  it('opens a channel-asset file under review in its Assets folder, and a picture in Assets', () => {
    const base = state().contentStudio;
    const kit = { id: 'kit', workspaceId: 'ws', status: 'succeeded', createdAt: iso(NOW - DAY), kit: { sourceKey: 'theme:t-3', themeId: 't-3', reportAssetId: 'asset-report' } };
    const kitFile = { id: 'kit-post', workspaceId: 'ws', runId: 'kit', title: 'Social post', createdAt: iso(NOW - DAY), review: { status: 'in-review', at: iso(NOW) } };
    const withKit = state({ contentRuns: [...base.contentRuns, kit], assets: [...base.assets, kitFile] });
    expect(nextSteps({ state: withKit, can: yes, now: NOW }).find((row) => row.kind === 'review').action.target).toEqual({ kind: 'folder', id: 'theme:t-3', page: 'assets' });
    const picture = { id: 'pic', workspaceId: 'ws', runId: 'report', kind: 'image', title: 'Hero', createdAt: iso(NOW - DAY), review: { status: 'in-review', at: iso(NOW) } };
    expect(nextSteps({ state: state({ assets: [...base.assets, picture] }), can: yes, now: NOW }).find((row) => row.kind === 'review').action.target).toEqual({ kind: 'page', page: 'assets' });
  });

  it('asks someone without Analytics to remind the channel about a missed link', () => {
    const rows = nextSteps({ state: state(), viewer: { role: 'editor', realRole: 'editor' }, can: (method) => method !== 'getTrendAnalytics', now: NOW, origin: 'https://studio.example.com' });
    const row = rows.find((item) => item.kind === 'add-link');
    expect(row).toMatchObject({ detail: 'Ask the channel to add the link once it’s live, so the team sees it under Shipped.', action: { kind: 'copy', label: 'Copy reminder' } });
    expect(row.action.text).toMatch(/^Semrush Social Team: “AI Overviews” was planned for .+\. Add the live link in the studio\. https:\/\/studio\.example\.com$/);
  });

  it('only offers what the role can do, and names who to ask for the rest', () => {
    const reader = nextSteps({ state: state(), can: only('readStudioRun'), now: NOW, askAdmin: 'Riley' });
    expect(reader.map((row) => row.kind)).toEqual(['stopped']);
    expect(reader[0].detail).toBe('Apify refused the token. Ask Riley to try it again.');
    expect(reader[0].action).toEqual({ kind: 'open', target: { kind: 'run', id: 'broken', page: 'research' }, label: 'See why' });
    // Write reports needs Approve trends and Start research both.
    expect(nextSteps({ state: state(), can: only('approveResearchThemes'), now: NOW }).some((row) => row.kind === 'write-reports')).toBe(false);
  });

  it('leaves out what the page already shows, and a report that already has channel assets', () => {
    const withKit = state({ contentRuns: [...state().contentStudio.contentRuns, { id: 'kit', workspaceId: 'ws', status: 'succeeded', createdAt: iso(NOW - DAY), kit: { sourceKey: 'theme:t-3', themeId: 't-3', reportAssetId: 'asset-report' } }] });
    const rows = nextSteps({ state: withKit, can: yes, now: NOW, exclude: ['decide'] });
    expect(rows.map((row) => row.kind)).not.toContain('decide');
    expect(rows.map((row) => row.kind)).not.toContain('make-assets');
  });

  it('copies a reminder for a channel that answers, but not on a brief ready three days', () => {
    const late = state({ researchRuns: state().contentStudio.researchRuns.filter((run) => run.id === 'done'), adoptionsByTheme: { 't-old': { blog: { status: 'not-using', channelName: 'Semrush Blog' } } } });
    const rows = nextSteps({ state: late, can: yes, now: NOW + DAY, origin: 'https://studio.example.com' });
    const remind = rows.find((row) => row.kind === 'remind');
    expect(remind).toMatchObject({ title: 'Semrush Blog hasn’t answered on 1 trend' });
    expect(remind.action).toMatchObject({ kind: 'copy', label: 'Copy reminder', text: '1 trend is waiting for Semrush Blog: “AI Overviews”. https://studio.example.com' });
  });

  it('asks an admin to connect Apify when it is missing', () => {
    const rows = nextSteps({ state: { ...state(), keys: {} }, can: yes, now: NOW });
    expect(rows.at(-1)).toMatchObject({ kind: 'setup', action: { kind: 'open', target: { kind: 'page', page: 'settings' } } });
    expect(nextSteps({ state: { ...state(), keys: {} }, can: only('decideResearchTheme'), now: NOW }).some((row) => row.kind === 'setup')).toBe(false);
  });
});

describe('Setup checklist', () => {
  it('lists what a new studio needs, with the web-only steps on the web', () => {
    const empty = { keys: {}, settings: {}, contentStudio: { activeWorkspaceId: 'ws', workspaces: [{ id: 'ws' }] } };
    const mac = setupChecklist({ state: empty, web: false });
    expect(mac.items.map((item) => item.id)).toEqual(['apify', 'ai', 'program', 'pictures', 'address']);
    expect(mac).toMatchObject({ done: 0, complete: false });
    const channels = [{ id: 'blog' }, { id: 'social' }];
    const web = setupChecklist({ state: { ...empty, team: { memberCount: 3 } }, web: true, team: { members: [{ id: 'm1', channelId: 'blog' }] }, channels });
    expect(web.items.map((item) => item.id)).toEqual(['apify', 'ai', 'program', 'team', 'owners', 'pictures']);
    expect(web.items.find((item) => item.id === 'owners')).toMatchObject({ label: 'Give each channel an owner (1 of 2)', done: false });
    expect(web.items.find((item) => item.id === 'team').done).toBe(true);
  });

  it('ticks the AI check once Check connections passed on the current route, and names that route', () => {
    const empty = { keys: {}, contentStudio: { activeWorkspaceId: 'ws', workspaces: [{ id: 'ws' }] } };
    const ai = (settings) => setupChecklist({ state: { ...empty, settings } }).items.find((item) => item.id === 'ai');
    expect(ai({ lastAiCheck: { ok: true, provider: 'auto' } })).toMatchObject({ label: 'Check that Claude works', done: true });
    expect(ai({ lastAiCheck: { ok: false, provider: 'auto' } }).done).toBe(false);
    expect(ai({ aiProvider: 'codex', lastAiCheck: { ok: true, provider: 'auto' } })).toMatchObject({ label: 'Check that Codex works', done: false });
  });

  it('is complete once every required step is done; optional ones can wait', () => {
    const ready = setupChecklist({ state: { ...state(), settings: {} }, web: false });
    expect(ready.items.filter((item) => !item.done).map((item) => item.id)).toEqual(['pictures', 'address']);
    expect(ready.complete).toBe(true);
    expect(ready.allDone).toBe(false);
  });
});

describe('the default research program', () => {
  const programs = [{ id: 'a', updatedAt: '2026-10-01T00:00:00Z' }, { id: 'b', updatedAt: '2026-10-10T00:00:00Z' }];
  it('is the one picked, else the one chosen last, else the newest', () => {
    expect(defaultProgram(programs).id).toBe('b');
    expect(defaultProgram(programs, { lastId: 'a' }).id).toBe('a');
    expect(defaultProgram(programs, { id: 'b', lastId: 'a' }).id).toBe('b');
    expect(defaultProgram(programs, { id: 'gone', lastId: 'also-gone' }).id).toBe('b');
    expect(defaultProgram([])).toBe(null);
  });
});
