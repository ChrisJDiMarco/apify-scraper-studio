import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import roles from '../src/main/roles.js';
import accessModule from '../src/main/access.js';
import askChannel from '../src/main/ask-channel.js';
import help from '../src/main/help-assistant.js';
import fixture from './fixtures/roles-state.js';

// A channel owner's Ask AI is built only from their channel's projected view (src/main/ask-channel.js). The fixture is
// a Semrush studio with two channels' work: Blog's own set and a set shared by Blog and Social, Social's own set still
// running, trends at every stage, research runs, programs, costs and receipts. Blog's owner must see Blog's share and
// nothing else: no Social files or answers, no unapproved trends, no research, no money.
const { createAccess, ASK_METHODS } = accessModule;
const at = fixture.at;
const ALEX = { id: 'member-alex', name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', via: 'link', disabled: false, memberSince: at('10-01') };
const SAM = { id: 'member-sam', name: 'Sam', email: 'sam@semrush.com', role: 'channel', channelId: 'social', via: 'link', disabled: false, memberSince: at('10-05') };
const CHRIS = { id: 'member-chris', name: 'Chris', email: 'chris@semrush.com', role: 'admin', channelId: null, via: 'proxy', disabled: false, memberSince: at('08-01') };
const RILEY = { id: 'member-riley', name: 'Riley', email: 'riley@semrush.com', role: 'editor', channelId: null, via: 'link', disabled: false, memberSince: at('08-02') };
const admins = [{ id: 'member-chris', name: 'Chris' }];
const mentions = [{ id: 'inbox-1', kind: 'mention', assetId: 'asset-kit-blog-short', noteId: 'note-1', assetTitle: 'AI Overviews: a short news update', by: { id: 'member-riley', name: 'Riley' }, excerpt: 'Can we lead with the CTR drop?', at: at('10-15'), read: false }];

function viewerOf(identity, { policy = null, access = null, session = null } = {}) {
  return roles.buildViewer({ identity, session, prefs: {}, editionId: 'semrush', web: true, admins, policy, access });
}
// What the channel owner's `state` call returns, as access.project builds it.
function projected(viewer) {
  return roles.projectState(fixture.baseState(), viewer, { adoptions: fixture.adoptions(), admins, editionId: 'semrush', noteInbox: { items: viewer.channelId === 'blog' ? mentions : [] } });
}
const contextFor = (identity, extra = {}) => {
  const viewer = viewerOf(identity); const state = projected(viewer);
  return askChannel.channelContext({ view: state.contentStudio.channelView, noteMentions: state.contentStudio.noteMentions, viewer, page: { tab: 'trends' }, workspaceName: 'Semrush workspace', appVersion: 'test', edition: 'browser studio', pictures: { available: true, families: [{ family: 'campaign', set: 'Semrush campaign graphics' }] }, now: Date.parse(at('10-16')), ...extra });
};
// Money, research, other channels and studio settings, as they appear in the fixture.
const MONEY = /costUsd|maxBudgetUsd|reservedUsd|estimateUsd|receipts?"|budget|\$\d|"usd"|aiUsd|collectionUsd/i;
const STUDIO_WIDE = ['program-pulse', 'AI search pulse', 'research-', 'Agentic checkout', 'Voice search returns', 'Zero-click searches', 'Old idea', 'Private positioning notes', 'Enterprise SEO', 'claude-opus', 'gpt-image', 'X posts', 'dataset-1', 'Pasted brief', 'Newsletter draft', 'Run budget exhausted', 'No product registry'];
const SOCIAL = ['Semrush Social Team', 'LinkedIn + X + FB Captions', 'Hero Graphic', 'asset-kit-shared-social', 'image-shared-', 'content-kit-local', 'Not our audience', 'Sam'];
const BLOG = ['Short News Update', 'Long-form Article', 'AI Overviews: a short news update'];

describe('a channel owner’s LIVE CONTEXT', () => {
  it('holds their channel’s trends, drafts, answers, plan and inbox, and nothing of another channel, research or money', () => {
    const blog = contextFor(ALEX); const text = JSON.stringify(blog);
    expect(blog).toMatchObject({ role: 'channel owner', layout: 'channel', channel: { name: 'Semrush Blog' }, askAdmin: 'Chris', workspace: { name: 'Semrush workspace' }, currentPage: { tab: 'trends' } });
    expect(blog.trends.map((trend) => trend.name).sort()).toEqual(['AI Overviews eat clicks', 'Local packs shrink']);
    expect(blog.trends.find((trend) => trend.name === 'AI Overviews eat clicks')).toMatchObject({ answer: 'using it', link: 'https://www.semrush.com/blog/ai-overviews/', brief: 'TREND: AI Overviews eat clicks', drafts: { sets: 2 } });
    expect(blog.trends.find((trend) => trend.name === 'Local packs shrink')).toMatchObject({ answer: '', new: true, drafts: null });
    // Blog's own set and its part of the shared set, with Blog's files only.
    expect(blog.drafts.map((set) => [set.trend, set.status, set.sharedWithOtherChannels])).toEqual([['AI Overviews eat clicks', 'failed', true], ['AI Overviews eat clicks', 'succeeded', false]]);
    expect(blog.drafts[1].files.map((file) => file.file)).toEqual(['Short News Update', 'Long-form Article']);
    expect(blog.plan).toEqual([{ trend: 'AI Overviews eat clicks', plannedFor: 'no date yet', link: 'https://www.semrush.com/blog/ai-overviews/' }]);
    expect(blog.inbox).toEqual([expect.objectContaining({ kind: 'mention', on: 'AI Overviews: a short news update', from: 'Riley', unread: true })]);
    expect(blog.attention.map((row) => row.kind)).toEqual(expect.arrayContaining(['open-tab']));
    expect(blog.canDo).toEqual(expect.arrayContaining(['Generate drafts for their channel from a brief', 'Say whether their channel is using a trend, with its live link and planned date', 'Make pictures here in Ask AI']));
    for (const word of BLOG) expect(text).toContain(word);
    for (const word of [...SOCIAL, ...STUDIO_WIDE]) expect(text, word).not.toContain(word);
    expect(text).not.toMatch(MONEY);
  });

  it('gives Social’s owner Social’s share and none of Blog’s', () => {
    const social = contextFor(SAM); const text = JSON.stringify(social);
    expect(social.channel.name).toBe('Semrush Social Team');
    expect(social.trends.find((trend) => trend.name === 'Local packs shrink')).toMatchObject({ answer: 'not for us', drafts: { sets: 1, latest: 'running' } });
    expect(social.drafts.find((set) => set.status === 'running').files.map((file) => file.file)).toEqual(['LinkedIn + X + FB Captions', 'Hero Graphic']);
    expect(social.inbox).toEqual([]);
    for (const word of BLOG) expect(text, word).not.toContain(word);
    for (const word of STUDIO_WIDE) expect(text, word).not.toContain(word);
    expect(text).not.toMatch(MONEY);
  });

  it('says what their role can do, and offers no pictures without Make channel assets', () => {
    const viewer = viewerOf(ALEX, { access: { grants: [], denies: ['makeAssets', 'markTrendsUsed'] } });
    const context = askChannel.channelContext({ view: projected(viewer).contentStudio.channelView, viewer, pictures: { available: false, families: [{ family: 'campaign', set: 'Campaign' }] } });
    expect(context.canDo).toEqual(['Read the briefs of the trends offered to their channel', 'Stop a set of drafts being made for their channel only', 'Finish drafts that didn’t make it in a set made for their channel only', 'Leave notes on their channel’s briefs and drafts']);
    expect(context.pictures).toEqual({ available: false, brandReferenceImages: [] });
    // Generate makes only the written drafts when pictures are off.
    expect(context.channel.generateMakes.every((label) => !/graphic|image|picture/i.test(label))).toBe(true);
  });

  it('lists a planned day coming up only for a role with My plan (Mark trends used)', () => {
    const plannedFor = '2026-10-18';
    const view = { channel: { name: 'Semrush Blog' }, trends: [{ themeId: 'theme-local', name: 'Local packs shrink', adoption: { status: 'using', plannedFor, link: '' } }], runs: [], assets: [] };
    const now = Date.parse(at('10-16'));
    const withPlan = askChannel.channelContext({ view, viewer: { allowed: ['setTrendAdoption'] }, now });
    expect(withPlan.attention).toEqual([{ what: `You planned “Local packs shrink” for ${plannedFor}`, why: 'Add the live link once it’s out.', kind: 'mark-used', target: 'Local packs shrink' }]);
    expect(askChannel.channelContext({ view, viewer: { allowed: [] }, now }).attention).toEqual([]);
  });
});

describe('a channel owner’s lookups', () => {
  const lookup = (identity, row, extra = {}) => {
    const viewer = viewerOf(identity); const view = projected(viewer).contentStudio.channelView;
    const readText = vi.fn((assetId) => `# Text of ${assetId}\n\nBody.`);
    return { readText, result: askChannel.channelLookup(row, { view, readText, ...extra }) };
  };

  it('reads a trend’s brief and one of their drafts, through the files their view lists only', async () => {
    const brief = lookup(ALEX, { kind: 'trend', target: 'AI Overviews eat clicks' });
    expect(await brief.result).toMatchObject({ found: true, title: 'AI Overviews eat clicks', trend: { answer: 'using it' }, brief: { title: 'TREND: AI Overviews eat clicks', text: expect.stringContaining('asset-aio-toolkit-2') } });
    expect(brief.readText.mock.calls).toEqual([['asset-aio-toolkit-2']]);
    // A brief's own title finds it too ("report", the kind an attached brief arrives as).
    expect(await lookup(ALEX, { kind: 'report', target: 'TREND: AI Overviews eat clicks' }).result).toMatchObject({ found: true, title: 'AI Overviews eat clicks' });
    const draft = lookup(ALEX, { kind: 'asset', target: 'AI Overviews eat clicks › Short News Update' });
    expect(await draft.result).toMatchObject({ found: true, title: 'AI Overviews eat clicks › Short News Update', status: 'draft', text: expect.stringContaining('asset-kit-blog-short') });
    expect(draft.readText.mock.calls).toEqual([['asset-kit-blog-short']]);
  });

  it('can’t reach another channel’s drafts, unapproved trends or research, and reads nothing for them', async () => {
    for (const row of [{ kind: 'trend', target: 'Agentic checkout' }, { kind: 'trend', target: 'Zero-click searches' }, { kind: 'trend', target: 'Voice search returns' }, { kind: 'asset-folder', target: 'Local packs shrink' }, { kind: 'run', target: 'AI search pulse' }, { kind: 'posts', target: 'ai' }, { kind: 'spend', target: 'month' }, { kind: 'prompt', target: 'Trends report' }]) {
      const { result, readText } = lookup(ALEX, row);
      expect(await result, `${row.kind} ${row.target}`).toMatchObject({ found: false });
      expect(readText).not.toHaveBeenCalled();
    }
    // Social's file in the shared set isn't one of Blog's: the set lists Blog's files only, and no text is read.
    const shared = lookup(ALEX, { kind: 'asset', target: 'AI Overviews eat clicks › LinkedIn + X + FB Captions' });
    const { target: _asked, ...result } = await shared.result; // the lookup repeats the words it was asked with
    expect(result.files.map((row) => row.file).sort()).toEqual(['AI Overviews eat clicks › Long-form Article', 'AI Overviews eat clicks › Short News Update']);
    expect(JSON.stringify(result)).not.toMatch(/Captions|asset-kit-shared-social|image-shared|Hero Graphic/);
    expect(shared.readText).not.toHaveBeenCalled();
    const folder = await lookup(ALEX, { kind: 'asset-folder', target: 'AI Overviews eat clicks' }).result;
    expect(folder).toMatchObject({ found: true, sets: 2 });
    expect(JSON.stringify(folder)).not.toMatch(/Social|Captions|Hero Graphic|costUsd|budget/);
    const found = await lookup(ALEX, { kind: 'find', target: 'social captions local packs' }).result;
    expect(found.matches.map((row) => row.title)).toEqual(['Local packs shrink']);
  });

  it('searches only the conversations and memory it is given (their own channel space)', async () => {
    const conversations = vi.fn(() => [{ id: 'ask-1', title: 'Blog plans', updatedAt: at('10-14') }]);
    const memory = vi.fn(() => [{ kind: 'preference', text: 'Keep posts short.', scope: 'me', updatedAt: at('10-14') }]);
    expect(await lookup(ALEX, { kind: 'conversation', target: 'plans' }, { conversations, memory }).result).toMatchObject({ found: true, conversations: [{ title: 'Blog plans' }] });
    expect(await lookup(ALEX, { kind: 'memory', target: 'posts' }, { conversations, memory }).result).toMatchObject({ found: true, items: [{ text: 'Keep posts short.' }] });
    expect(conversations).toHaveBeenCalledWith('plans', 5);
  });
});

describe('a channel owner’s buttons, links and cards', () => {
  const blogView = () => projected(viewerOf(ALEX)).contentStudio.channelView;

  it('resolves each button to their channel’s trend or set, always for their own channel, and drops the rest', () => {
    const view = blogView();
    const { actions, answer, unresolved } = askChannel.channelResolve({
      actions: [
        { kind: 'make-assets', label: 'Generate', target: 'AI Overviews eat clicks' },
        { kind: 'mark-used', label: 'Using it', target: 'Local packs shrink', params: { channel: 'social', status: 'using' }, problems: ['I left out “Social”: not one of this workspace’s channels.'] },
        { kind: 'finish-assets', label: 'Finish', target: 'AI Overviews eat clicks' },
        { kind: 'save-folder', label: 'Save', target: 'AI Overviews eat clicks' },
        { kind: 'stop-run', label: 'Stop', target: 'Local packs shrink' },
        { kind: 'open', label: 'Open', target: 'Agentic checkout' },
        { kind: 'open', label: 'Open plan', target: 'My plan' },
        { kind: 'open', label: 'Drafts', target: 'AI Overviews eat clicks', params: { type: 'folder' } },
        { kind: 'open-tab', label: 'Inbox', target: 'inbox' },
        { kind: 'approve-trend', label: 'Yes', target: 'Agentic checkout' },
      ],
      answer: 'Read [[AI Overviews eat clicks]] and [[Agentic checkout]].',
    }, { view, channelId: 'blog' });
    expect(actions[0]).toMatchObject({ kind: 'make-assets', themeId: 'theme-aio', assetId: 'asset-aio-toolkit-2', title: 'AI Overviews eat clicks' });
    expect(actions[1]).toMatchObject({ kind: 'mark-used', themeId: 'theme-local', params: { channel: 'blog', status: 'using' } });
    expect(actions[1]).not.toHaveProperty('problems');
    expect(actions[2]).toBeNull(); // the unfinished set is shared with Social: an editor finishes it
    expect(actions[3]).toMatchObject({ kind: 'save-folder', runId: 'content-kit-blog' });
    expect(actions[4]).toBeNull(); // Social's running set isn't Blog's to stop
    expect(actions[5]).toBeNull(); // still waiting for an OK: not on Blog's list
    expect(actions[6]).toMatchObject({ page: 'plan', ref: { kind: 'page', id: 'plan' } });
    expect(actions[7]).toMatchObject({ themeId: 'theme-aio', ref: { kind: 'folder', id: 'theme-aio' } });
    expect(actions[8]).toMatchObject({ target: 'inbox' });
    expect(actions[9]).toBeNull();
    expect(unresolved).toEqual(expect.arrayContaining(['AI Overviews eat clicks', 'Local packs shrink', 'Agentic checkout']));
    expect(answer).toBe('Read [AI Overviews eat clicks](studio:trend/theme-aio) and Agentic checkout.');
  });

  it('fills trend and folder cards from the view, and checks a channel answer on a card with only their channel', () => {
    const view = blogView();
    const actions = [{ kind: 'mark-used', label: 'We’re using it', target: 'AI Overviews eat clicks', themeId: 'theme-aio', title: 'AI Overviews eat clicks', params: { channel: 'blog', status: 'using' } }];
    const cards = askChannel.channelHydrate({ cards: [
      { type: 'trend', ref: 'AI Overviews eat clicks', title: '', note: '', items: [], actionIndexes: [] },
      { type: 'asset-folder', ref: 'AI Overviews eat clicks', title: '', note: '', items: [], actionIndexes: [] },
      { type: 'run', ref: 'AI search pulse', title: '', note: '', items: [], actionIndexes: [] },
      { type: 'trend', ref: 'Agentic checkout', title: '', note: '', items: [], actionIndexes: [] },
      { type: 'checklist', ref: '', title: 'Next', note: '', items: ['✓ Read the brief', 'Generate drafts'], actionIndexes: [] },
    ], actions }, { view });
    expect(cards.map((card) => card.type)).toEqual(['trend', 'asset-folder', 'checklist', 'action']);
    expect(cards[0].data).toMatchObject({ themeId: 'theme-aio', name: 'AI Overviews eat clicks', reportAssetId: 'asset-aio-toolkit-2', answer: 'Using it', priorityTier: 'Top priority' });
    expect(cards[1].data).toMatchObject({ sourceKey: 'theme-aio', latestRunId: 'content-kit-shared', channels: [{ name: 'Semrush Blog' }] });
    expect(cards[3].data.fields.find((field) => field.key === 'channel')).toMatchObject({ value: 'blog', options: [{ value: 'blog', label: 'Semrush Blog' }] });
    expect(JSON.stringify(cards)).not.toMatch(/Social|costUsd|budget|receipt/);
  });

  it('builds the channel prompt with its own buttons and lookups, and none of the studio-wide sections', () => {
    const context = contextFor(ALEX);
    const allowed = roles.allowedMethods('channel');
    const { prefix, body } = help.helpPromptParts({ question: 'What’s new?', role: 'channel', context, guide: 'GUIDE', access: { allowed, hiddenPages: [] } });
    for (const line of ['channel owner for Semrush Blog', 'make-assets: target = a trend name from trends whose brief is ready', 'mark-used: target = a trend name from trends', 'Never mention a price, cost, budget, spend or dollar amount', 'APP GUIDE (the parts for channel owners):\nGUIDE']) expect(prefix).toContain(line);
    for (const line of ['QUICK SCANS', 'SHOW ME', 'PROMPTS (the instructions', 'spend: target', 'posts: target', 'start-research:', 'approve-trend:', 'invite-people:', 'SPOTS (', 'PAGES:']) expect(prefix, line).not.toContain(line);
    expect(body).toContain('"name": "Semrush Blog"');
    expect(`${prefix}${body}`).not.toMatch(/Semrush Social Team|costUsd|maxBudgetUsd/);
    // The schema has no pages, quick scan, edit or tour; the cleaner keeps only what a channel owner can have.
    const schema = help.helpSchema(undefined, { role: 'channel', access: { allowed } });
    expect(Object.keys(schema.properties)).toEqual(['answer', 'image', 'followUps', 'actions', 'lookups', 'cards', 'remember', 'summary', 'title']);
    const reply = help.cleanReply({ answer: 'Here.', pages: [{ page: 'research', label: 'Open' }], show: { autoStart: true, steps: [{ target: 'nav.settings', item: '', say: 'Here' }] }, actions: [{ kind: 'start-research', label: 'Go', target: 'AI search pulse', params: [] }, { kind: 'mark-used', label: 'Using it', target: 'Local packs shrink', params: ['status=using'] }], cards: [{ type: 'run', ref: 'x', title: '', note: '', items: [], actionIndexes: [] }, { type: 'trend', ref: 'Local packs shrink', title: '', note: '', items: [], actionIndexes: [0] }], image: { create: true, title: 'Hero', prompt: 'A hero', size: '1536x1024', family: 'none' } }, { role: 'channel', imagesOn: false, access: { allowed } });
    expect(reply).toMatchObject({ pages: [], show: null, image: null, actions: [{ kind: 'mark-used', params: { status: 'using' } }] });
    expect(reply.cards.map((card) => card.type)).toEqual(['trend']);
    expect(help.lookupKindsFor(help.promptRights({ view: true }), help.reachOf({ costs: true }), 'channel')).toEqual(['trend', 'report', 'asset-folder', 'asset', 'find', 'conversation', 'memory']);
    expect(help.lookupLabel({ kind: 'trend', target: 'AI Overviews eat clicks' }, 'running', 'channel')).toBe('Reading the brief for “AI Overviews eat clicks”');
  });

  it('sends the app guide’s channel owner sections only', () => {
    const guide = askChannel.channelGuide(fs.readFileSync('docs/app-guide.md', 'utf8'));
    expect(guide).toMatch(/^## For channel owners\n/);
    expect(guide).toContain('### Ask AI for channel owners');
    expect(guide).toContain('### Inbox');
    expect(guide).toContain('### Calendar and My plan');
    for (const heading of ['## Research programs', '## Settings', '## Costs and budgets', '## Prompts', '### Quick scans from Ask AI']) expect(guide).not.toContain(heading);
    expect(guide).not.toMatch(/\$\d/);
    expect(Buffer.byteLength(guide, 'utf8')).toBeLessThan(12000);
    expect(askChannel.channelGuide('')).toBe('');
  });
});

// The gate (access.js) for Ask AI on a channel base: every method is channel-safe with its own scope, the payload is
// rebuilt, money never comes back, and a role with Ask AI off, a preview or a picture without Make channel assets is
// refused before the handler runs.
describe('the gate for a channel owner’s Ask AI', () => {
  function setup({ identity = ALEX, viewAs = null, policy = null, access = {} } = {}) {
    const team = {
      prefsFor: () => ({}), admins: () => admins, logEvent: () => {}, log: () => ({}), adoptionsFor: () => fixture.adoptions(), listMembers: () => fixture.members(),
      ...(policy ? { accessPolicy: () => policy } : {}), accessFor: (id) => access[id] || { grants: [], denies: [] }, memberById: () => null,
    };
    const studio = fixture.contentStudio();
    const workspace = { activeEditionId: () => 'semrush', activeWorkspace: () => ({ id: 'semrush', editionId: 'semrush' }), workspaceById: () => ({ id: 'semrush', editionId: 'semrush' }), findAsset: () => null, findRun: () => null, isTrendReport: () => false, kitRunsFor: () => [], picturesReady: () => true, studio };
    const call = { user: identity, session: { viewAs } };
    const gate = createAccess({ teamStore: team, workspace, web: true, currentCall: () => call });
    return { gate, viewer: () => gate.currentViewer() };
  }
  const refused = (fn) => { try { fn(); } catch (error) { return error; } throw new Error('Expected a refusal.'); };

  it('lets every Ask AI method through for a channel owner, with only the fields it reads', () => {
    const { gate, viewer } = setup();
    expect(ASK_METHODS).toEqual(roles.CAPABILITIES.find((cap) => cap.id === 'askAi').methods);
    for (const method of ASK_METHODS) expect(roles.CHANNEL_SAFE_METHODS).toContain(method);
    expect(gate.check('askHelp', { question: 'Hi', requestId: 'req-1234567890', page: { tab: 'trends' }, history: [{ role: 'user', content: 'x' }], workspaceId: 'general', role: 'admin', channelId: 'social', attachments: [] }, viewer())).toEqual({ question: 'Hi', requestId: 'req-1234567890', page: { tab: 'trends' }, attachments: [], conversationId: '' });
    expect(gate.check('listAskConversations', { allWorkspaces: true, limit: 5, channelId: 'social' }, viewer())).toEqual({ limit: 5 });
    expect(gate.check('saveAskMemory', { text: 'Short posts', scope: 'me', workspaceId: 'general', channelId: 'social' }, viewer())).toEqual({ text: 'Short posts', scope: 'me' });
    expect(gate.check('createHelpImage', { prompt: 'A hero', size: '1024x1024', title: 'Hero', family: 'campaign', maxBudgetUsd: 50 }, viewer())).toEqual({ prompt: 'A hero', size: '1024x1024', title: 'Hero', family: 'campaign' });
    expect(gate.check('listHelpImages', { ownerId: 'member-sam' }, viewer())).toEqual({});
    expect(gate.check('readHelpImage', { id: 'help-image-1', ownerId: 'member-sam' }, viewer())).toEqual({ id: 'help-image-1' });
  });

  it('keeps the same 15 methods on the Mac and the web: registered channels, the preload and the browser bridge', () => {
    const { methods } = JSON.parse(fs.readFileSync('src/shared/studio-api-channels.json', 'utf8'));
    const preload = fs.readFileSync('src/preload/index.js', 'utf8'); const bridge = fs.readFileSync('src/web/web-api.js', 'utf8');
    for (const method of ASK_METHODS) {
      expect(methods[method], method).toMatch(/^help:/);
      expect(preload, method).toContain(`${method}: (payload) => invoke('${methods[method]}', payload)`);
      expect(roles.CAP_OF_METHOD[method], method).toBe('askAi'); // in exactly one capability
    }
    expect(bridge).toContain('studio-api-channels.json'); // the browser bridge is built from the same table
  });

  it('refuses what Ask AI might offer but the channel role can’t do, at the gate', () => {
    const { gate, viewer } = setup();
    for (const [method, payload] of [['setAssetStatus', { assetId: 'asset-kit-blog-short', status: 'published' }], ['decideResearchTheme', { runId: 'research-review', themeId: 'theme-aio', decision: 'approved' }], ['startQuickScan', { scan: { topic: 'AI' } }], ['readTrendPosts', { themeId: 'theme-aio' }], ['listPrompts', {}], ['editStudioAsset', { assetId: 'asset-aio-toolkit-2', markdown: '# x' }]]) {
      expect(refused(() => gate.check(method, payload, viewer())), method).toMatchObject({ status: 403 });
    }
  });

  it('refuses a picture to a channel role without Make channel assets, naming it', () => {
    const { gate, viewer } = setup({ access: { 'member-alex': { grants: [], denies: ['makeAssets'] } }, policy: roles.compilePolicy(null) });
    expect(viewer().capabilities).toContain('askAi');
    expect(refused(() => gate.check('createHelpImage', { prompt: 'A hero' }, viewer()))).toMatchObject({ status: 403, code: 'capabilityOff', message: 'Your access doesn’t include “Make channel assets”. Ask Chris if you need it.' });
    expect(gate.check('askHelp', { question: 'Hi', requestId: 'req-1234567890' }, viewer())).toMatchObject({ question: 'Hi' });
  });

  it('refuses every Ask AI method when an admin turned it off for the role, or for one person', () => {
    const off = setup({ policy: roles.compilePolicy({ rev: 1, builtIn: { channel: { grant: [], deny: ['askAi'] } } }) });
    expect(off.viewer().nav.main).not.toContain('ask');
    for (const method of ASK_METHODS) expect(refused(() => off.gate.check(method, {}, off.viewer())), method).toMatchObject({ status: 403, code: 'capabilityOff', message: 'Your access doesn’t include “Use Ask AI”. Ask Chris if you need it.' });
    const person = setup({ policy: roles.compilePolicy(null), access: { 'member-alex': { grants: [], denies: ['askAi'] } } });
    expect(refused(() => person.gate.check('askHelp', { question: 'Hi' }, person.viewer()))).toMatchObject({ code: 'capabilityOff' });
    // An editor with it off is refused the same way, and an editor without See costs keeps it.
    const editorOff = setup({ identity: RILEY, policy: roles.compilePolicy(null), access: { 'member-riley': { grants: [], denies: ['askAi'] } } });
    expect(refused(() => editorOff.gate.check('askHelp', { question: 'Hi' }, editorOff.viewer()))).toMatchObject({ code: 'capabilityOff' });
    const noCosts = setup({ identity: RILEY, policy: roles.compilePolicy(null), access: { 'member-riley': { grants: [], denies: ['seeCosts'] } } });
    expect(noCosts.gate.check('askHelp', { question: 'Hi' }, noCosts.viewer())).toEqual({ question: 'Hi' });
  });

  it('keeps an admin’s preview of a channel owner read-only: the page reads, a question is refused', () => {
    const { gate, viewer } = setup({ identity: CHRIS, viewAs: { role: 'channel', channelId: 'blog' } });
    expect(viewer()).toMatchObject({ preview: true, base: 'channel', channelId: 'blog' });
    expect(viewer().roleAllowed).toEqual(expect.arrayContaining(['askHelp', 'createHelpImage']));
    expect(refused(() => gate.check('askHelp', { question: 'Hi', requestId: 'req-1234567890' }, viewer()))).toMatchObject({ status: 403, code: 'preview', message: 'You’re previewing as Semrush Blog’s channel owner. Switch back to Admin to make changes.' });
    for (const method of ['createHelpImage', 'saveAskMemory', 'deleteAskConversation', 'renameAskConversation', 'recordAskOutcome', 'cancelAsk']) expect(refused(() => gate.check(method, {}, viewer())), method).toMatchObject({ code: 'preview' });
    for (const method of ['listAskConversations', 'readAskConversation', 'listAskMemory', 'readAskProgress', 'listHelpImages', 'readHelpImage']) expect(() => gate.check(method, {}, viewer()), method).not.toThrow();
  });

  it('never sends money back to a channel owner from Ask AI, nor to an editor without See costs', () => {
    const reply = { message: { content: 'Done.', receipt: { costUsd: 0.12, model: 'claude-opus-5-5' }, cards: [{ type: 'run', data: { costUsd: 2, budgetUsd: 5 } }] }, conversation: { id: 'ask-1' } };
    const owner = setup();
    for (const method of ['askHelp', 'readAskConversation', 'readAskProgress', 'createHelpImage']) {
      const shown = owner.gate.projectResult(method, reply, owner.viewer());
      expect(JSON.stringify(shown), method).not.toMatch(/costUsd|budgetUsd|receipt/);
      expect(shown.message.content).toBe('Done.');
    }
    // A new picture names the model and connection that drew it; a channel owner gets neither (nor its cost).
    const picture = { id: 'help-image-1', title: 'Hero', size: '1024x1024', prompt: 'A hero', family: 'none', dataUrl: 'data:image/png;base64,AA==', costUsd: 0.17, model: 'gpt-image-1.5', provider: 'openai' };
    expect(owner.gate.projectResult('createHelpImage', picture, owner.viewer())).toEqual({ id: 'help-image-1', title: 'Hero', size: '1024x1024', prompt: 'A hero', family: 'none', dataUrl: 'data:image/png;base64,AA==' });
    const editor = setup({ identity: RILEY, policy: roles.compilePolicy(null), access: { 'member-riley': { grants: [], denies: ['seeCosts'] } } });
    expect(JSON.stringify(editor.gate.projectResult('askHelp', reply, editor.viewer()))).not.toMatch(/costUsd|budgetUsd|receipt/);
    const admin = setup({ identity: CHRIS });
    expect(admin.gate.projectResult('askHelp', reply, admin.viewer())).toBe(reply);
  });
});
