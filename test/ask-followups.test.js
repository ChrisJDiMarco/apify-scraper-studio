import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import followups from '../src/main/ask-followups.js';
import askStoreModule from '../src/main/ask-store.js';
const { createAskFollowUps, FOLLOW_UP_EVENTS } = followups;
const { createAskStore, askHistory } = askStoreModule;

// What the studio posts into an Ask AI conversation by itself when work started there gets somewhere (SPEC-3): written
// from the run's records (no AI call), buttons only for what the person's role runs, money only for people who see costs.
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const theme = (id, name, tier = 'STRONG', extra = {}) => ({ id, name, description: `${name} is showing up in posts.`, evidenceCount: 6, platforms: ['x'], scoring: { priorityTier: tier }, ...extra });
const scanRun = (extra = {}) => ({ id: 'research-scan', type: 'research', origin: 'quick-scan', title: 'Quick scan · AI Overviews', programId: 'program-a', status: 'succeeded', stage: 'scan-complete', createdAt: '2026-10-17T10:00:00Z', costUsd: 0.84, maxBudgetUsd: 5, message: 'Found 2 trends in 120 posts from the last 6 hours. The trends report is ready.', quickScan: { topic: 'AI Overviews', lookbackHours: 6, platforms: ['x'] }, counts: { retained: 120 }, discoveredThemes: [theme('t-low', 'Quiet trend', 'LOW'), theme('t-top', 'Fast trend', 'FAST-TRACK')], themes: [], scanReport: { runId: 'content-report', status: 'succeeded', assetId: 'asset-report' }, ...extra });
const report = { assetId: 'asset-report', title: 'Quick scan report: AI Overviews (2026-10-17)', summary: 'Two trends stand out; the fast one is worth a full run.', childRunId: 'content-report', costUsd: 0.21, model: 'claude-opus-5-5', route: '' };
const event = (type, extra = {}) => ({ type, key: type, identityId: 'member-editor', conversationId: 'ask-11111111-2222-3333-4444-555555555555', programName: 'Weekly pulse', run: scanRun(), ...extra });
const admin = { role: 'admin', allowed: null, hiddenPages: [], costs: true, drive: false, admin: true };
const editor = (allowed, costs = false) => ({ role: 'editor', allowed, hiddenPages: [], costs, drive: false, admin: false });
const store = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-followups-')); roots.push(root); return createAskStore({ root, now: () => new Date('2026-10-17T12:00:00Z') }); };

describe('compose', () => {
  const { compose } = createAskFollowUps({ askStore: { appendFollowUp: () => null } });

  it('writes the quick scan report message: summary, report and trend cards, and what to do next', () => {
    const message = compose(event('scan-report-ready', { report }), admin);
    expect(message.content).toContain('**Quick scan finished: “AI Overviews”** · the last 6 hours');
    expect(message.content).toContain('Two trends stand out');
    expect(message.content).toContain('It found 2 trends in 120 posts. The write-up is in [Quick scan report: AI Overviews (2026-10-17)](studio:report/asset-report).');
    expect(message.actions.map((action) => action.kind)).toEqual(['open', 'make-assets', 'start-research']);
    expect(message.actions[0]).toMatchObject({ assetId: 'asset-report', ref: { kind: 'report', id: 'asset-report' } });
    expect(message.actions[2]).toMatchObject({ programId: 'program-a', label: 'Run full research with “Weekly pulse”' });
    expect(message.cards.map((card) => card.type)).toEqual(['report', 'trend', 'trend']);
    expect(message.cards[0]).toMatchObject({ actionIndexes: [0, 1], data: { assetId: 'asset-report', kind: 'scan-report' } });
    // The strongest trend first, each card pointing at its exact run and trend.
    expect(message.cards[1].data).toMatchObject({ themeId: 't-top', runId: 'research-scan', name: 'Fast trend', stage: '' });
    expect(message.followUps[0]).toBe('What’s driving “Fast trend”?');
    expect(message.receipt).toEqual({ costUsd: 0.84, model: 'claude-opus-5-5', route: '' });
    expect(message.followUp).toEqual({ event: 'scan-report-ready', runId: 'research-scan' });
  });

  it('keeps only the buttons the person’s role runs, renumbered for the cards, and no money without seeCosts', () => {
    const message = compose(event('scan-report-ready', { report }), editor(['readStudioAsset', 'planAssetKit', 'createAssetKit']));
    expect(message.actions.map((action) => action.kind)).toEqual(['open', 'make-assets']);
    expect(message.cards[0].actionIndexes).toEqual([0, 1]);
    expect(message.receipt).toBeNull();
    const none = compose(event('scan-report-ready', { report }), editor([]));
    expect(none.actions.map((action) => action.kind)).toEqual(['open']);
    expect(none.cards[0].actionIndexes).toEqual([0]);
  });

  it('offers Retry report when the report didn’t finish, and hides the cap from people who don’t see costs', () => {
    const run = scanRun({ scanReport: { runId: 'content-report', status: 'failed', error: 'Not enough of the $1.50 AI cap is left for the trends report (about $0.27).' } });
    const shown = compose(event('scan-report-failed', { run, error: run.scanReport.error, key: 'scan-report-failed:1' }), admin);
    expect(shown.content).toContain('Its short trends report didn’t finish: Not enough of the $1.50 AI cap');
    expect(shown.content).toContain('**Retry report** writes only the report; the posts aren’t collected again.');
    expect(shown.actions).toEqual([expect.objectContaining({ kind: 'retry-run', label: 'Retry report', runId: 'content-report' })]);
    expect(shown.cards.at(-1)).toMatchObject({ type: 'run', actionIndexes: [0], data: { runId: 'research-scan', costUsd: 0.84 } });
    const hidden = compose(event('scan-report-failed', { run, error: run.scanReport.error }), editor(['retryStudioRun']));
    expect(hidden.content).not.toMatch(/\$/);
    expect(hidden.content).toContain('The scan’s AI cap doesn’t cover the report');
    expect(hidden.cards.at(-1).data.costUsd).toBeUndefined();
  });

  it('puts Yes and Skip on each waiting trend of a research run, with Write reports for that run', () => {
    const run = { id: 'research-weekly', type: 'research', title: 'Weekly pulse', programId: 'program-a', status: 'awaiting-review', createdAt: '2026-10-17T10:00:00Z', window: { startDate: '2026-10-10', endDate: '2026-10-17' }, counts: { retained: 900 }, discoveredThemes: ['a', 'b', 'c', 'd'].map((id, index) => theme(id, `Trend ${id}`, index === 3 ? 'FAST-TRACK' : 'MONITOR')), themes: [] };
    const message = compose(event('trends-ready', { run }), admin);
    expect(message.content).toBe('**“Weekly pulse” found 4 trends** in 900 posts from 2026-10-10 to 2026-10-17. They need your OK before any reports are written: say Yes or Skip to each, then **Write reports** shows the cost first.');
    expect(message.cards).toHaveLength(3);
    expect(message.cards[0]).toMatchObject({ type: 'trend', actionIndexes: [0, 1], data: { themeId: 'd', runId: 'research-weekly', stage: 'waiting' } });
    expect(message.actions.slice(0, 2)).toEqual([expect.objectContaining({ kind: 'approve-trend', runId: 'research-weekly', themeId: 'd' }), expect.objectContaining({ kind: 'pass-trend', runId: 'research-weekly', themeId: 'd' })]);
    expect(message.actions.at(-2)).toMatchObject({ kind: 'write-reports', runId: 'research-weekly' });
    expect(message.actions.at(-1)).toMatchObject({ kind: 'open-tab', target: 'trends', label: 'See all 4 on Trends' });
    // A role that can't decide trends gets the cards without the buttons.
    const viewer = compose(event('trends-ready', { run }), editor(['readStudioRun']));
    expect(viewer.actions.map((action) => action.kind)).toEqual(['open-tab']);
    expect(viewer.cards.every((card) => card.actionIndexes.length === 0)).toBe(true);
  });

  it('has a message for every event a run raises', () => {
    expect(FOLLOW_UP_EVENTS).toEqual(expect.arrayContaining(['scan-report-ready', 'scan-report-failed', 'scan-finished', 'scan-empty', 'run-stopped', 'trends-ready', 'no-trends', 'reports-ready']));
    const reports = compose(event('reports-ready', { run: { ...scanRun(), origin: '', title: 'Weekly pulse' }, reports: [{ assetId: 'asset-1', title: 'TREND: Fast trend', themeName: 'Fast trend', createdAt: '2026-10-17T11:00:00Z' }] }), admin);
    expect(reports.content).toBe('**Reports are ready** for 1 trend from “Weekly pulse”.');
    expect(reports.cards[0]).toMatchObject({ type: 'report', actionIndexes: [0], data: { assetId: 'asset-1', trendName: 'Fast trend' } });
    const stopped = compose(event('run-stopped', { run: scanRun({ status: 'failed', message: 'Apify token missing\nmore' }) }), admin);
    expect(stopped.content).toBe('**“Quick scan · AI Overviews” stopped.** Apify token missing\n\nFinished steps are kept, so trying again doesn’t pay for them twice.');
    expect(stopped.actions[0]).toMatchObject({ kind: 'retry-run', runId: 'research-scan' });
    expect(compose(event('scan-empty', { run: scanRun({ discoveredThemes: [], message: 'The chosen accounts posted nothing in the last 6 hours.' }) }), admin).followUps).toEqual(['Plan a longer scan on AI Overviews']);
    expect(compose(event('not-an-event'), admin)).toBeNull();
  });
});

describe('post', () => {
  it('appends one assistant message to the conversation, once per event, and tells the person’s windows', () => {
    const askStore = store();
    const turn = askStore.appendTurn('member-editor', { workspaceId: 'general', user: { content: 'Plan a quick scan on AI Overviews' }, assistant: { content: 'Here is a plan.' } });
    const push = vi.fn();
    const { post } = createAskFollowUps({ askStore, reachFor: () => admin, push });
    const sent = post(event('scan-report-ready', { conversationId: turn.conversation.id, report }));
    expect(sent.messageId).toMatch(/^msg-/);
    expect(push).toHaveBeenCalledWith('member-editor', { type: 'followup', conversationId: turn.conversation.id, messageId: sent.messageId });
    const again = post(event('scan-report-ready', { conversationId: turn.conversation.id, report }));
    expect(again.messageId).toBe(sent.messageId);
    expect(push).toHaveBeenCalledTimes(1);
    const conversation = askStore.readConversation('member-editor', turn.conversation.id);
    expect(conversation.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(conversation.messages[2]).toMatchObject({ role: 'assistant', followUp: { key: 'research-scan:scan-report-ready', event: 'scan-report-ready', runId: 'research-scan' }, cards: expect.any(Array), actions: expect.any(Array) });
    // The next question's history says the studio posted it, unasked.
    expect(askHistory(conversation).turns.at(-1).content).toContain('[Posted by the studio when that work finished; no question was asked]');
    expect(askStore.listConversations('member-editor')[0].preview).toContain('Quick scan finished');
  });

  it('posts nothing for a removed person or a deleted conversation, and never creates a conversation', () => {
    const askStore = store();
    const push = vi.fn();
    expect(createAskFollowUps({ askStore, reachFor: () => null, push }).post(event('scan-report-ready', { report }))).toBeNull();
    expect(createAskFollowUps({ askStore, reachFor: () => admin, push }).post(event('scan-report-ready', { report }))).toBeNull();
    expect(askStore.listConversations('member-editor')).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });
});
