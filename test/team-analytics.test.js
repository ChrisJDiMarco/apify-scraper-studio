import { describe, expect, it } from 'vitest';
import analytics from '../src/main/team-analytics.js';
import fixture from './fixtures/roles-state.js';
const { buildTrendAnalytics } = analytics;

const NOW = new Date('2026-10-16T12:00:00.000Z');
const build = (extra = {}) => buildTrendAnalytics({ contentStudio: fixture.contentStudio(), adoptions: fixture.adoptions(), activity: [], members: fixture.members(), editionId: 'semrush', workspace: { id: 'semrush', name: 'Semrush workspace' }, now: NOW, days: 7, ...extra });
const row = (report, themeId) => report.trends.find((trend) => trend.themeId === themeId);
const channel = (report, id) => report.byChannel.find((entry) => entry.id === id);

describe('trend analytics', () => {
  it('reports the window, the workspace and every channel with its owners', () => {
    const report = build();
    expect(report).toMatchObject({ generatedAt: '2026-10-16T12:00:00.000Z', days: 7, since: '2026-10-10T00:00:00.000Z', workspace: { id: 'semrush', name: 'Semrush workspace' } });
    expect(report.channels).toHaveLength(10);
    expect(report.channels[0]).toEqual({ id: 'blog', name: 'Semrush Blog', short: 'Blog', owners: [{ id: 'member-alex', name: 'Alex' }], ownerSince: fixture.at('10-01') });
    expect(build({ days: 30 }).since).toBe('2026-09-17T00:00:00.000Z');
    expect(build({ days: 12 }).days).toBe(90); // only 7, 30, 90 or 365
    expect(build({ workspace: null }).workspace).toEqual({ id: 'semrush', name: 'Semrush workspace' });
  });

  it('ownerSince: the earliest enabled owner’s createdAt, or null without an owner', () => {
    const members = [...fixture.members(), { id: 'member-ana', name: 'Ana', role: 'channel', channelId: 'blog', disabled: false, createdAt: fixture.at('09-20') }];
    const report = build({ members });
    expect(report.channels.find((entry) => entry.id === 'blog')).toMatchObject({ owners: [{ name: 'Alex' }, { name: 'Ana' }], ownerSince: fixture.at('09-20') });
    // Olive owns PR but is disabled.
    expect(report.channels.find((entry) => entry.id === 'pr')).toMatchObject({ owners: [], ownerSince: null });
    expect(report.channels.find((entry) => entry.id === 'newsletter').ownerSince).toBeNull();
  });

  it('decision: from the newest research run that recorded one, with who decided', () => {
    const report = build({ days: 90, includeAll: true });
    // Found again by a run still waiting for review, it keeps the newest decision a run recorded.
    expect(row(report, 'theme-aio')).toMatchObject({ decision: 'approved', decidedBy: { name: 'Riley', at: fixture.at('10-10', '10:55:00') }, ready: true });
    expect(row(report, 'theme-voice')).toMatchObject({ decision: 'passed', decidedBy: { name: 'Riley', at: fixture.at('10-10', '10:56:00') } });
    expect(row(report, 'theme-agents')).toMatchObject({ decision: 'approved', decidedBy: { name: 'Riley' } });
    expect(row(report, 'theme-zero')).toMatchObject({ decision: 'approved', decidedBy: { name: 'Automatic' } });
    expect(row(report, 'theme-local')).toMatchObject({ decision: 'approved', decidedBy: null }); // not recorded
    expect(row(report, 'theme-old')).toMatchObject({ decision: 'pending' }); // cancelled during review
    // After review the approved list is authoritative, whatever an old decisions map says.
    const studio = fixture.contentStudio(); const run = studio.researchRuns.find((entry) => entry.id === 'research-new'); run.decisions['theme-local'] = 'passed';
    expect(row(buildTrendAnalytics({ contentStudio: studio, now: NOW, days: 90, editionId: 'semrush' }), 'theme-local').decision).toBe('approved');
    // A brief written without any recorded decision (an older record) counts as approved; nothing ready stays pending.
    const older = fixture.contentStudio(); const newRun = older.researchRuns.find((entry) => entry.id === 'research-new'); delete newRun.approvedAt; newRun.decisions = {}; delete newRun.decisionsBy;
    const unrecorded = buildTrendAnalytics({ contentStudio: older, now: NOW, days: 90, includeAll: true, editionId: 'semrush' });
    expect(row(unrecorded, 'theme-local')).toMatchObject({ ready: true, decision: 'approved', decidedBy: null });
    expect(row(unrecorded, 'theme-voice')).toMatchObject({ ready: false, decision: 'pending', decidedBy: null });
  });

  it('trendsFound, approved, passed and pending: themes first detected in the window', () => {
    expect(build().totals).toMatchObject({ trendsFound: 3, approved: 2, passed: 1, pending: 0 });
    expect(build({ days: 90 }).totals).toMatchObject({ trendsFound: 6, approved: 4, passed: 1, pending: 1 });
    expect(build({ now: new Date('2026-10-13T12:00:00.000Z'), days: 7 }).totals).toMatchObject({ trendsFound: 2, approved: 1, passed: 1, pending: 0 });
  });

  it('ready and readyAt: as readyTrends defines them', () => {
    const report = build({ days: 90, includeAll: true });
    expect(row(report, 'theme-aio')).toMatchObject({ ready: true, readyAt: fixture.at('10-11', '09:30:00'), firstDetectedAt: fixture.at('09-01'), priority: 'top', name: 'AI Overviews eat clicks' });
    expect(row(report, 'theme-zero')).toMatchObject({ ready: false, readyAt: null, priority: 'strong' }); // its report failed
  });

  it('briefsReady: ready themes whose readyAt falls in the window', () => {
    expect(build().totals.briefsReady).toBe(2);
    expect(build({ now: new Date('2026-10-25T12:00:00.000Z') }).totals.briefsReady).toBe(0);
  });

  it('matrix rows: ready trends in the window, plus found-but-not-ready ones with includeAll', () => {
    expect(build().trends.map((trend) => trend.themeId)).toEqual(['theme-local', 'theme-aio']);
    expect(build({ includeAll: true }).trends.map((trend) => [trend.themeId, trend.ready])).toEqual([['theme-local', true], ['theme-aio', true], ['theme-agents', false], ['theme-voice', false]]);
    expect(build({ now: new Date('2026-10-25T12:00:00.000Z') }).trends).toEqual([]);
  });

  it('offered: ready no more than 14 days before the channel’s owner joined; never without an owner', () => {
    const report = build();
    expect(row(report, 'theme-aio').cells.blog.offered).toBe(true);
    expect(row(report, 'theme-aio').cells.pr.offered).toBe(false);
    const late = fixture.members().map((member) => (member.id === 'member-alex' ? { ...member, createdAt: '2026-10-25T09:30:00.000Z' } : member));
    expect(row(build({ members: late }), 'theme-aio').cells.blog.offered).toBe(true); // ready Oct 11 09:30, joined exactly 14 days later
    const later = fixture.members().map((member) => (member.id === 'member-alex' ? { ...member, createdAt: '2026-10-25T09:30:00.001Z' } : member));
    expect(row(build({ members: later }), 'theme-aio').cells.blog.offered).toBe(false);
    expect(channel(build({ members: later }), 'blog')).toMatchObject({ offered: 1, using: 0, noAnswer: 1 }); // only Local packs is offered now
  });

  it('generated cell: a succeeded job for the channel in a kit made from the trend', () => {
    const cells = row(build(), 'theme-aio').cells;
    expect(cells.social).toEqual({ status: 'generated', link: '', byName: 'Jordan', at: fixture.at('10-13'), assetCount: 4, offered: true });
    // The blog's job in the same shared kit failed, but its own kit succeeded earlier.
    const studio = fixture.contentStudio(); studio.contentRuns = studio.contentRuns.filter((run) => run.id !== 'content-kit-blog');
    expect(row(buildTrendAnalytics({ contentStudio: studio, members: fixture.members(), editionId: 'semrush', now: NOW, days: 7 }), 'theme-aio').cells.blog).toMatchObject({ status: 'none', assetCount: 0 });
    // A running kit has made nothing yet.
    expect(row(build({ adoptions: [] }), 'theme-local').cells.social).toMatchObject({ status: 'none', assetCount: 0 });
  });

  it('cell status: the answer if there is one, else generated, else none', () => {
    const cells = row(build(), 'theme-aio').cells;
    expect(cells.blog).toEqual({ status: 'using', link: 'https://www.semrush.com/blog/ai-overviews/', byName: 'Alex', at: fixture.at('10-13', '16:00:00'), assetCount: 2, offered: true });
    expect(cells.newsletter).toEqual({ status: 'none', link: '', byName: '', at: null, assetCount: 0, offered: false });
    expect(row(build(), 'theme-local').cells.social).toMatchObject({ status: 'not-using', byName: 'Sam' });
    const answered = [...fixture.adoptions(), { workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'social', status: 'not-using', link: '', by: { name: 'Sam' }, at: fixture.at('10-14') }];
    expect(row(build({ adoptions: answered }), 'theme-aio').cells.social).toMatchObject({ status: 'not-using', byName: 'Sam', assetCount: 4 });
    // Sam's answer in the other workspace doesn't count here.
    expect(row(build(), 'theme-aio').cells.social.status).toBe('generated');
  });

  it('inUse and linksAdded: among the briefs ready in the window', () => {
    expect(build().totals).toMatchObject({ inUse: 1, linksAdded: 1 });
    const more = [...fixture.adoptions(), { workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'social', status: 'using', link: '', by: { name: 'Sam' }, at: fixture.at('10-14') }, { workspaceId: 'semrush', themeId: 'theme-local', channelId: 'blog', status: 'using', link: 'https://semrush.com/blog/local', by: { name: 'Alex' }, at: fixture.at('10-14') }, { workspaceId: 'semrush', themeId: 'theme-zero', channelId: 'pr', status: 'using', link: 'https://semrush.com/pr', by: { name: 'Olive' }, at: fixture.at('10-14') }];
    expect(build({ adoptions: more }).totals).toMatchObject({ inUse: 2, linksAdded: 2 }); // zero-click has no brief, so its answer is left out
    expect(build({ now: new Date('2026-10-25T12:00:00.000Z'), adoptions: more }).totals).toMatchObject({ inUse: 0, linksAdded: 0 });
  });

  it('assetsGenerated: kit files created in the window', () => {
    expect(build().totals.assetsGenerated).toBe(6);
    expect(build({ now: new Date('2026-10-19T12:00:00.000Z'), days: 7 }).totals.assetsGenerated).toBe(4); // the window starts Oct 13 00:00
    expect(build({ now: new Date('2026-10-30T12:00:00.000Z'), days: 7 }).totals.assetsGenerated).toBe(0);
  });

  it('byChannel: counts over the offered briefs, adding up, with no answer count only for owned channels', () => {
    const report = build();
    expect(channel(report, 'blog')).toEqual({ id: 'blog', name: 'Semrush Blog', short: 'Blog', owners: [{ id: 'member-alex', name: 'Alex' }], offered: 2, using: 1, notUsing: 0, generatedOnly: 0, noAnswer: 1, assets: 2, lastActivityAt: fixture.at('10-13', '16:05:00') });
    expect(channel(report, 'social')).toMatchObject({ offered: 2, using: 0, notUsing: 1, generatedOnly: 1, noAnswer: 0, assets: 4, lastActivityAt: fixture.at('10-15', '11:00:00') });
    expect(channel(report, 'pr')).toMatchObject({ owners: [], offered: 0, using: 0, noAnswer: null, assets: 0, lastActivityAt: null });
    for (const entry of report.byChannel) if (entry.noAnswer !== null) expect(entry.using + entry.notUsing + entry.generatedOnly + entry.noAnswer).toBe(entry.offered);
    const activity = [{ id: 'a1', workspaceId: 'semrush', at: fixture.at('10-16', '08:00:00'), by: { id: 'member-ana', name: 'Ana' }, kind: 'kit-created', detail: { channels: ['blog', 'pr'], themeId: 'theme-aio' } }];
    expect(channel(build({ activity }), 'pr').lastActivityAt).toBe(fixture.at('10-16', '08:00:00'));
  });

  it('recent: the newest 50 activity rows in plain words', () => {
    const entry = (index, kind, detail, name = 'Alex', workspaceId = 'semrush') => ({ id: `a${index}`, workspaceId, at: new Date(Date.parse('2026-10-16T00:00:00.000Z') + index * 60000).toISOString(), by: { id: `member-${name.toLowerCase()}`, name }, kind, detail });
    const activity = [
      entry(1, 'adoption', { themeId: 'theme-aio', trendName: 'AI Overviews', channelId: 'blog', status: 'using' }),
      entry(2, 'adoption', { themeId: 'theme-aio', channelId: 'blog', status: 'using', link: 'https://semrush.com/blog/x' }),
      entry(3, 'adoption', { themeId: 'theme-local', channelId: 'social', status: 'not-using' }, 'Sam'),
      entry(4, 'adoption', { themeId: 'theme-local', channelId: 'social', status: 'clear' }, 'Sam'),
      entry(5, 'trend-decision', { themeId: 'theme-agents', decision: 'approved' }, 'Riley'),
      entry(6, 'trend-decision', { themeId: 'theme-voice', trendName: 'Voice search returns', decision: 'passed' }, 'Riley'),
      entry(7, 'trend-decision', { themeId: 'theme-voice', decision: 'pending' }, 'Riley'),
      entry(8, 'trend-decision', { runId: 'research-review', approved: 3, passed: 1 }, 'Riley'),
      entry(9, 'kit-created', { themeId: 'theme-aio', trendName: 'AI Overviews', channels: ['blog', 'social'], estimateUsd: 4.2 }, 'Jordan'),
      entry(10, 'kit-created', { themeId: 'theme-aio', channels: ['blog', 'social', 'pr', 'newsletter'] }, 'Jordan'),
      entry(11, 'report-edited', { assetId: 'asset-aio-toolkit-2', title: 'TREND: AI Overviews' }, 'Riley'),
      entry(12, 'report-restored', { assetId: 'asset-aio-toolkit-2', title: 'TREND: AI Overviews' }, 'Riley'),
      entry(13, 'member-changed', { action: 'added', name: 'Pat', role: 'channel', channelId: 'pr' }, 'Chris', ''),
      entry(14, 'member-changed', { action: 'changed', name: 'Pat', role: 'editor' }, 'Chris', ''),
      entry(15, 'member-changed', { action: 'disabled', name: 'Pat' }, 'Chris', ''),
      entry(16, 'member-changed', { action: 'removed', name: 'Pat' }, 'Chris', ''),
      entry(17, 'link-issued', { memberId: 'member-pat', name: 'Pat' }, 'Chris', ''),
      entry(18, 'research-started', { programName: 'AI search pulse', runId: 'research-running' }, 'Riley'),
      entry(19, 'adoption', { themeId: 'theme-aio', channelId: 'blog', status: 'using' }, 'Alex', 'general'),
      { id: 'a20', workspaceId: 'semrush', at: fixture.at('10-16', '06:00:00'), kind: 'report-edited', detail: {} },
    ];
    const recent = build({ activity }).recent;
    expect(recent.map((item) => item.text)).toEqual([
      'Someone edited a trend',
      'Riley started a search with “AI search pulse”',
      'Chris made a new sign-in link for Pat',
      'Chris removed Pat',
      'Chris paused Pat’s access',
      'Chris changed Pat’s access to an editor',
      'Chris added Pat as a channel owner for Semrush PR',
      'Riley restored the original of “TREND: AI Overviews”',
      'Riley edited “TREND: AI Overviews”',
      'Jordan generated drafts of “AI Overviews eat clicks” for 4 channels',
      'Jordan generated drafts of “AI Overviews” for Semrush Blog and Semrush Social Team',
      'Riley approved 3 trends and passed on 1 trend',
      'Riley put “Voice search returns” back up for review',
      'Riley passed on “Voice search returns”',
      'Riley approved “Agentic checkout”',
      'Sam cleared the answer on “Local packs shrink” for Semrush Social Team',
      'Sam said “Local packs shrink” isn’t for Semrush Social Team',
      'Alex marked “AI Overviews eat clicks” as used for Semrush Blog and added the link',
      'Alex marked “AI Overviews” as used for Semrush Blog',
    ]);
    expect(recent[1]).toEqual({ at: '2026-10-16T00:18:00.000Z', byName: 'Riley', kind: 'research-started', text: 'Riley started a search with “AI search pulse”' });
    expect(recent[0].byName).toBe('Someone');
    const many = Array.from({ length: 80 }, (_, index) => entry(index, 'research-started', { programName: `Program ${index}` }));
    expect(build({ activity: many }).recent).toHaveLength(50);
    expect(build({ activity: many }).recent[0].text).toBe('Alex started a search with “Program 79”');
  });

  it('copes with an empty studio', () => {
    const report = buildTrendAnalytics({ now: NOW });
    expect(report).toMatchObject({ days: 90, workspace: { id: '', name: '' }, totals: { trendsFound: 0, approved: 0, passed: 0, pending: 0, briefsReady: 0, inUse: 0, linksAdded: 0, assetsGenerated: 0 }, trends: [], recent: [] });
    expect(report.channels.map((entry) => entry.name)).toContain('Blog');
    expect(report.byChannel.every((entry) => entry.noAnswer === null && entry.lastActivityAt === null)).toBe(true);
  });
});
