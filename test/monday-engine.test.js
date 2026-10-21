import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import engineModule from '../src/main/monday-engine.js';
import storeModule from '../src/main/monday-store.js';
import fakeModule from './helpers/monday-fake.js';

// The Monday.com sync engine (src/main/monday-engine.js) against an in-memory board (test/helpers/monday-fake.js).
const { createMondayEngine } = engineModule;
const { createMondayStore } = storeModule;
const { createMondayFake } = fakeModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const COLUMNS = [{ id: 'stage', title: 'Stage', type: 'status' }, { id: 'studio_key', title: 'Studio key', type: 'text' }, { id: 'notes', title: 'Notes', type: 'long_text' }, { id: 'owner', title: 'Owner', type: 'people' }];
const theme = (id, name) => ({ id, name, description: `${name} described.`, evidenceIds: ['a'], platforms: ['x'] });
function studioState() {
  return {
    programs: [{ id: 'p1', name: 'Weekly pulse' }],
    researchRuns: [
      { id: 'r1', programId: 'p1', status: 'awaiting-review', createdAt: '2026-10-10T10:00:00Z', discoveredThemes: [theme('t1', 'Zero-click search'), theme('t2', 'AI Overviews')], decisions: {}, decisionsBy: {} },
      { id: 'r2', programId: 'p1', status: 'succeeded', approvedAt: 'x', createdAt: '2026-10-01T10:00:00Z', discoveredThemes: [theme('t4', 'Ready trend')], themes: [theme('t4', 'Ready trend')], reportRunIds: [{ themeId: 't4', runId: 'c4' }] },
    ],
    contentRuns: [{ id: 'c4', status: 'succeeded' }], assets: [{ id: 'a4', runId: 'c4', deliverableId: 'evidence-report' }], editionId: 'general', history: null, docLinks: {},
  };
}
function harness({ link = {}, web = false, columns = COLUMNS, members = {}, allows = () => true, state = studioState() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monday-engine-')); roots.push(root);
  const fake = createMondayFake({ columns, groups: [{ id: 'g_potential', title: 'Potential trend', position: '1' }, { id: 'g_approved', title: 'Approved', position: '2' }, { id: 'g_production', title: 'In production', position: '3' }, { id: 'g_ready', title: 'Ready to use', position: '4' }, { id: 'g_passed', title: 'Passed', position: '5' }] });
  let clock = Date.parse('2026-10-17T12:00:00Z');
  const store = createMondayStore({ root, now: () => clock });
  const timers = [];
  const decisions = [];
  const workspace = {
    activeWorkspaceId: () => 'general',
    boardSource: () => state,
    decideResearchTheme: vi.fn((payload, internal) => {
      const run = state.researchRuns.find((row) => row.id === payload.runId);
      if (run.status !== 'awaiting-review') throw new Error('This trend is no longer waiting for a decision.');
      decisions.push({ payload, internal });
      if (payload.decision === 'pending') { delete run.decisions[payload.themeId]; delete run.decisionsBy[payload.themeId]; }
      else { run.decisions[payload.themeId] = payload.decision; run.decisionsBy[payload.themeId] = { ...internal.by, at: new Date(clock).toISOString(), via: 'monday' }; }
    }),
  };
  const teamStore = { adoptionsFor: () => [], log: vi.fn(), identityForEmail: (email) => members[email] || null };
  store.saveLink('general', {
    active: true, linkedAt: '2026-10-01T00:00:00Z', boardId: '42', boardName: 'Trends', columns: { stage: 'stage', studioKey: 'studio_key', notes: 'notes', owner: 'owner' },
    columnInfo: { stage: { title: 'Stage', type: 'status' }, studio_key: { title: 'Studio key', type: 'text' }, notes: { title: 'Notes', type: 'long_text' }, owner: { title: 'Owner', type: 'people' } },
    fieldOptions: { owner: { direction: 'fromMonday' } }, statusLabels: { potential: 'Potential trend', approved: 'Approved', production: 'In production', ready: 'Ready to use', passed: 'Passed' },
    groups: { by: 'stage', ids: { potential: 'g_potential', approved: 'g_approved', production: 'g_production', ready: 'g_ready', passed: 'g_passed' }, defaultGroupId: 'g_potential' },
    push: { mode: 'manual', from: 'all', includeSkipped: true, postUpdates: true }, pull: { mode: 'poll', pollMinutes: 5, decisions: web ? 'members' : 'anyone', comments: true, owner: true, dates: true }, onDeleted: 'leave', ...link,
  });
  const engine = createMondayEngine({ store, getToken: () => 'fixture-monday-token', workspace, teamStore, access: { allows, actorForCall: () => ({ id: 'admin', name: 'Admin' }) }, web, origin: () => 'https://studio.example.com', fetchImpl: fake.fetchImpl, sleep: async () => {}, now: () => clock, timers: { setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimeout: () => {}, setInterval: () => null, clearInterval: () => {} }, warn: () => {} });
  return { engine, store, fake, state, workspace, teamStore, timers, decisions, tick: (ms) => { clock += ms; }, now: () => clock };
}

describe('pushing to Monday', () => {
  it('looks keys up first and adopts items already on the board instead of creating them', async () => {
    const h = harness();
    const existing = h.fake.add({ name: 'Zero-click search', values: { studio_key: 'r1:t1' } });
    const result = await h.engine.push('general');
    expect(result.created).toBe(2); // t2 and t4 are new; t1 was found by its key
    expect(h.store.item('general', 'r1:t1')).toMatchObject({ itemId: existing.id, state: 'synced' });
    expect([...h.fake.items.values()].filter((item) => item.columns.studio_key === 'r1:t1')).toHaveLength(1);
    expect(h.store.readLog({ ws: 'general', limit: 20 }).rows.some((row) => row.kind === 'adopted')).toBe(true);
  });

  it('persists creates as unsure before sending, so a lost answer never leads to a second item', async () => {
    const h = harness();
    h.fake.failNext(async ({ query }) => {
      if (!query.includes('items_page_by_column_values')) return null;
      // Let the lookup through, then lose the answer to the create after Monday made the items.
      h.fake.failNext(async ({ query: create, variables: vars }) => {
        expect(h.store.item('general', 'r1:t1')).toMatchObject({ state: 'unsure' });
        for (const [, i] of create.matchAll(/c(\d+): create_item/g)) h.fake.add({ name: vars[`n${i}`], values: JSON.parse(vars[`v${i}`]) });
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      });
      return fakeModule.reply({ data: { items_page_by_column_values: { items: [] } } });
    });
    await h.engine.push('general');
    expect(h.store.item('general', 'r1:t1')).toMatchObject({ state: 'unsure' });
    expect(h.fake.items.size).toBe(3);
    h.tick(10 * 60000);
    await h.engine.push('general', { force: true });
    expect(h.fake.items.size).toBe(3); // adopted by key, nothing created twice
    expect(h.store.item('general', 'r1:t1')).toMatchObject({ state: 'synced' });
  });

  it('makes no API calls when nothing changed, and sends only changed columns when something did', async () => {
    const h = harness();
    await h.engine.push('general');
    const before = h.fake.calls.length;
    await h.engine.push('general');
    expect(h.fake.calls.length).toBe(before);
    h.state.researchRuns[0].discoveredThemes[1].description = 'A new description.';
    await h.engine.push('general');
    const update = h.fake.mutations().at(-1);
    expect(update.query).toMatch(/u0: change_multiple_column_values/);
    expect(Object.keys(JSON.parse(update.variables.v0))).toEqual(['notes']);
  });

  it('moves an item to its stage group when its stage changes, and posts a milestone once', async () => {
    const h = harness();
    await h.engine.push('general');
    const id = h.store.item('general', 'r1:t1').itemId;
    expect(h.fake.items.get(id).groupId).toBe('g_potential');
    h.state.researchRuns[0].decisions.t1 = 'approved'; h.state.researchRuns[0].decisionsBy.t1 = { id: 'm1', name: 'Dana Lee', at: '2026-10-17T12:00:00Z' };
    await h.engine.push('general');
    expect(h.fake.items.get(id).groupId).toBe('g_approved');
    expect(h.fake.items.get(id).columns.stage).toEqual({ label: 'Approved' });
    const posts = h.fake.updates.filter((row) => row.itemId === id);
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toMatch(/^Golden Thread · Dana Lee said Yes in the studio/);
    await h.engine.push('general');
    expect(h.fake.updates.filter((row) => row.itemId === id)).toHaveLength(1);
  });

  it('stops at 200 changes and comes back in a minute for the rest', async () => {
    const state = studioState();
    state.researchRuns[0].discoveredThemes = Array.from({ length: 205 }, (_, i) => theme(`m${i}`, `Trend ${i}`));
    const h = harness({ state });
    const result = await h.engine.push('general');
    expect(result).toMatchObject({ sent: 200 });
    expect(h.timers.some((timer) => timer.ms === 60000)).toBe(true);
  });

  it('pauses until midnight UTC when the daily limit is used up', async () => {
    const h = harness();
    h.fake.failNext(async () => fakeModule.reply({ errors: [{ message: 'Daily limit exceeded', extensions: { code: 'DAILY_LIMIT_EXCEEDED' } }] }));
    await h.engine.push('general');
    const paused = h.store.link('general').paused;
    expect(paused).toMatchObject({ reason: 'daily' });
    expect(paused.until).toBe('2026-10-18T00:00:00.000Z');
    expect(await h.engine.push('general')).toEqual({ skipped: 'paused' });
  });

  it('skips only the field whose column is gone', async () => {
    const h = harness({ columns: COLUMNS.filter((column) => column.id !== 'notes') });
    h.fake.failWhen(({ variables, i }) => (String(variables[`v${i}`] || '').includes('"notes"') ? Object.assign(new Error('Column not found: notes'), { code: 'InvalidColumnIdException' }) : null));
    await h.engine.push('general');
    expect(h.store.link('general').fieldProblems).toHaveProperty('notes');
    await h.engine.push('general', { force: true });
    expect([...h.fake.items.values()].length).toBe(3);
    expect([...h.fake.items.values()].every((item) => item.columns.stage)).toBe(true);
  });

  it('keeps the item ID on a network error, a 5xx or a refused value; only a missing item clears it', async () => {
    const h = harness();
    await h.engine.push('general');
    const id = h.store.item('general', 'r1:t2').itemId;
    for (const failure of [() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); }, () => fakeModule.reply({}, 503), () => fakeModule.reply({ errors: [{ message: 'invalid value', extensions: { code: 'ColumnValueException' } }] })]) {
      h.state.researchRuns[0].discoveredThemes[1].description = `Changed ${Math.random()}`;
      // The failure lasts through the client's own retries (an absolute update is retried up to 3 times).
      const persist = async () => { h.fake.failNext(persist); return failure(); };
      h.fake.failNext(persist);
      await h.engine.push('general', { force: true });
      h.fake.failNext(null);
      expect(h.store.item('general', 'r1:t2')).toMatchObject({ itemId: id, state: 'failed' });
      expect(h.store.item('general', 'r1:t2').nextTryAt).toBeTruthy();
    }
    h.fake.items.get(id).state = 'deleted';
    h.state.researchRuns[0].discoveredThemes[1].description = 'Changed again';
    await h.engine.push('general', { force: true });
    expect(h.store.item('general', 'r1:t2')).toMatchObject({ itemId: '', state: 'removed' });
    const count = h.fake.items.size;
    await h.engine.push('general', { force: true });
    expect(h.fake.items.size).toBe(count); // left deleted (onDeleted 'leave')
    h.store.updateLink('general', { onDeleted: 'recreate' });
    await h.engine.push('general', { force: true });
    expect(h.fake.items.size).toBe(count + 1);
  });
});

describe('a link on a hidden workspace', () => {
  it('never syncs while single-workspace mode hides its workspace, and syncs again once it is back', async () => {
    const h = harness({ link: { push: { mode: 'live', from: 'all', includeSkipped: true, postUpdates: true }, pull: { mode: 'poll', pollMinutes: 5, decisions: 'anyone', comments: true, owner: true, dates: true } } });
    let hidden = true;
    h.workspace.isWorkspaceHidden = (ws) => hidden && ws === 'general';
    h.tick(2 * 60 * 60000);
    h.engine.tick();
    h.engine.noteChange();
    expect(h.timers).toHaveLength(0); // no live push scheduled
    expect(await h.engine.push('general', { force: true })).toEqual({ skipped: 'hidden' });
    expect(await h.engine.pull('general')).toEqual({ skipped: 'hidden' });
    expect(await h.engine.full('general')).toEqual({ skipped: 'hidden' });
    await h.engine.idle();
    expect(h.fake.calls).toHaveLength(0);
    hidden = false;
    expect((await h.engine.push('general')).created).toBe(3);
  });
});

describe('reading changes from Monday', () => {
  async function linked(options) { const h = harness(options); await h.engine.push('general'); h.tick(60000); return h; }

  it('takes Approved on a waiting trend as a decision by the Monday person, logged for analytics', async () => {
    const h = await linked();
    const id = h.store.item('general', 'r1:t1').itemId;
    h.fake.changeOnMonday(id, 'stage', { label: 'Approved' }, { by: '55', at: h.now() });
    h.fake.users.set('55', { id: '55', name: 'Dana Lee', email: 'dana@example.com' });
    const result = await h.engine.pull('general');
    expect(result.decisions).toBe(1);
    expect(h.decisions[0]).toEqual({ payload: { runId: 'r1', themeId: 't1', decision: 'approved' }, internal: { by: { id: 'monday:55', name: 'Dana Lee (Monday.com)' }, via: 'monday', workspaceId: 'general' } });
    expect(h.teamStore.log).toHaveBeenCalledWith('trend-decision', 'general', expect.objectContaining({ runId: 'r1', themeId: 't1', decision: 'approved', via: 'monday' }), { id: 'monday:55', name: 'Dana Lee (Monday.com)' });
    // The studio doesn't send the same label back.
    const before = h.fake.mutations().length;
    await h.engine.push('general');
    expect(h.fake.mutations().slice(before).some((call) => JSON.stringify(call.variables).includes('"stage":{"label":"Approved"}'))).toBe(false);
  });

  it('ignores the echo of its own label', async () => {
    const h = await linked();
    const id = h.store.item('general', 'r1:t1').itemId;
    h.fake.changeOnMonday(id, 'stage', { label: 'Potential trend' }, { at: h.now() });
    await h.engine.pull('general');
    expect(h.workspace.decideResearchTheme).not.toHaveBeenCalled();
    expect(h.fake.items.get(id).columns.stage).toEqual({ label: 'Potential trend' });
  });

  it('changes Approved back on a trend past review, with the reason', async () => {
    const h = await linked();
    const id = h.store.item('general', 'r2:t4').itemId;
    h.fake.changeOnMonday(id, 'stage', { label: 'Approved' }, { at: h.now() });
    const result = await h.engine.pull('general');
    expect(result.reverted).toBe(1);
    expect(h.fake.items.get(id).columns.stage).toEqual({ label: 'Ready to use' });
    expect(h.store.readLog({ ws: 'general', key: 'r2:t4' }).rows[0].text).toMatch(/Changed back .* Decisions close once reports start\./);
  });

  it('accepts only studio members who may decide, matched by email, under the members policy', async () => {
    const editor = { id: 'm-ed', name: 'Eli Editor', role: 'editor' }; const owner = { id: 'm-ch', name: 'Cam Channel', role: 'channel' };
    const h = await linked({ web: true, members: { 'eli@example.com': editor, 'cam@example.com': owner }, allows: (identity) => identity.role === 'editor' });
    h.fake.users.set('60', { id: '60', name: 'Stranger', email: 'stranger@example.com' });
    h.fake.users.set('61', { id: '61', name: 'Cam Channel', email: 'cam@example.com' });
    h.fake.users.set('62', { id: '62', name: 'Eli Editor', email: 'eli@example.com' });
    const t1 = h.store.item('general', 'r1:t1').itemId; const t2 = h.store.item('general', 'r1:t2').itemId;
    h.fake.changeOnMonday(t1, 'stage', { label: 'Approved' }, { by: '60', at: h.now() });
    h.fake.changeOnMonday(t2, 'stage', { label: 'Passed' }, { by: '61', at: h.now() });
    await h.engine.pull('general');
    expect(h.workspace.decideResearchTheme).not.toHaveBeenCalled();
    expect(h.fake.items.get(t1).columns.stage).toEqual({ label: 'Potential trend' });
    expect(h.store.readLog({ ws: 'general', key: 'r1:t1' }).rows[0].text).toMatch(/Stranger isn’t in this studio/);
    h.tick(60000);
    h.fake.changeOnMonday(t2, 'stage', { label: 'Passed' }, { by: '62', at: h.now() });
    await h.engine.pull('general');
    expect(h.decisions.at(-1)).toMatchObject({ payload: { themeId: 't2', decision: 'passed' }, internal: { by: { id: 'm-ed', name: 'Eli Editor' } } });
  });

  it('lets a newer studio decision win over an older Monday change', async () => {
    const h = await linked();
    const id = h.store.item('general', 'r1:t1').itemId;
    const mondayAt = h.now() - 30000;
    h.state.researchRuns[0].decisions.t1 = 'passed'; h.state.researchRuns[0].decisionsBy.t1 = { id: 'm1', name: 'Dana Lee', at: new Date(h.now()).toISOString() };
    h.store.patchItems('general', { 'r1:t1': { pushed: {} } }); // the studio's skip hasn't been sent yet
    h.fake.changeOnMonday(id, 'stage', { label: 'Approved' }, { at: mondayAt });
    await h.engine.pull('general');
    expect(h.workspace.decideResearchTheme).not.toHaveBeenCalled();
    expect(h.fake.items.get(id).columns.stage).toEqual({ label: 'Passed' });
  });

  it('stops changing a stage back after three reverts in an hour', async () => {
    const h = await linked();
    const id = h.store.item('general', 'r2:t4').itemId;
    for (let i = 0; i < 3; i++) { h.tick(60000); h.fake.changeOnMonday(id, 'stage', { label: 'Passed' }, { at: h.now() }); await h.engine.pull('general'); }
    expect(h.store.item('general', 'r2:t4')).toMatchObject({ state: 'conflict' });
    h.tick(60000); h.fake.changeOnMonday(id, 'stage', { label: 'Passed' }, { at: h.now() });
    await h.engine.pull('general');
    expect(h.fake.items.get(id).columns.stage).toEqual({ label: 'Passed' }); // left alone now
    expect(h.engine.publicState().link.problems.join(' ')).toMatch(/press Sync now/);
  });

  it('keeps Monday comments as notes, without the studio’s own posts, ten at most', async () => {
    const h = await linked();
    const id = h.store.item('general', 'r1:t1').itemId;
    h.fake.comment(id, 'Golden Thread · Dana Lee said Yes in the studio.', { by: '1', name: 'Studio Bot' });
    h.store.setAccount({ userId: '1', userName: 'Studio Bot' });
    for (let i = 0; i < 12; i++) h.fake.comment(id, `Comment ${i} ${'x'.repeat(600)}`);
    await h.engine.pull('general');
    const notes = h.store.item('general', 'r1:t1').notes;
    expect(notes).toHaveLength(10);
    expect(notes.every((note) => note.text.length <= 500 && !note.text.startsWith('Golden Thread'))).toBe(true);
    await h.engine.pull('general');
    expect(h.store.item('general', 'r1:t1').notes).toHaveLength(10);
    expect(h.engine.readItem({ key: 'r1:t1' }).notes[0]).toMatchObject({ by: 'Dana Lee' });
  });

  it('marks deleted and archived items removed and leaves them that way by default', async () => {
    const h = await linked();
    const t1 = h.store.item('general', 'r1:t1').itemId; const t2 = h.store.item('general', 'r1:t2').itemId;
    h.fake.items.get(t1).state = 'deleted'; h.fake.items.get(t2).state = 'archived';
    h.fake.changeOnMonday(t2, 'notes', { text: 'x' }, { at: h.now() });
    h.fake.activity.push({ id: 'del', event: 'delete_pulse', data: JSON.stringify({ pulse_id: Number(t1) }), created_at: String(h.now() * 10000), user_id: '55', isoAt: new Date(h.now() - 1000).toISOString() });
    await h.engine.pull('general');
    expect(h.store.item('general', 'r1:t1')).toMatchObject({ state: 'removed' });
    expect(h.store.item('general', 'r1:t2')).toMatchObject({ state: 'removed' });
    const count = h.fake.items.size;
    await h.engine.push('general', { force: true });
    expect(h.fake.items.size).toBe(count);
  });

  it('answers the webhook challenge, ignores other boards and queues a re-read for its own', async () => {
    const h = await linked();
    const secret = 'c'.repeat(64);
    h.store.updateLink('general', { hookSecretHash: storeModule.hashSecret(secret) });
    expect(h.engine.receiveHook('d'.repeat(64), { challenge: 'x' }).status).toBe(404);
    expect(h.engine.receiveHook(secret, { challenge: 'abc' })).toEqual({ status: 200, body: { challenge: 'abc' } });
    expect(h.engine.receiveHook(secret, { event: { boardId: 999, pulseId: 1 } })).toEqual({ status: 200, body: {} });
    const before = h.timers.length;
    expect(h.engine.receiveHook(secret, { event: { boardId: 42, pulseId: Number(h.store.item('general', 'r1:t1').itemId), value: { label: { text: 'Approved' } } } })).toEqual({ status: 200, body: {} });
    expect(h.timers.length).toBe(before + 1);
    expect(h.timers.at(-1).ms).toBe(3000);
    expect(h.workspace.decideResearchTheme).not.toHaveBeenCalled(); // the payload's value is never applied
  });
});
