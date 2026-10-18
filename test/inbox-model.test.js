import { describe, expect, it } from 'vitest';
import { INBOX_KIND_LABEL, buildInbox } from '../src/renderer/src/inbox-model.js';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const at = (day, time = '10:00:00') => `2026-10-${day}T${time}.000Z`;
const theme = (id, name) => ({ id, name });
// One workspace: a run waiting for review, a finished run with its report, a kit set, a stopped set, an edit by Sam,
// a channel answer and an older workspace's run that never shows.
function state(extra = {}) {
  return {
    team: { admins: [{ name: 'Alex' }] },
    contentStudio: {
      activeWorkspaceId: 'semrush',
      programs: [{ id: 'program-pulse', workspaceId: 'semrush', name: 'AI search pulse' }],
      researchRuns: [
        { id: 'research-review', workspaceId: 'semrush', programId: 'program-pulse', title: 'AI search pulse', status: 'awaiting-review', createdAt: at('14'), updatedAt: at('14', '11:00:00'), discoveredThemes: [theme('t-1', 'Agentic checkout'), theme('t-2', 'AI Overviews'), theme('t-3', 'Local packs')], decisions: { 't-1': 'approved' } },
        { id: 'research-done', workspaceId: 'semrush', programId: 'program-pulse', title: 'AI search pulse', status: 'succeeded', createdAt: at('10'), updatedAt: at('10', '13:00:00'), discoveredThemes: [theme('t-2', 'AI Overviews'), theme('t-4', 'Voice')], themes: [theme('t-2', 'AI Overviews')] },
        { id: 'research-failed', workspaceId: 'semrush', programId: 'program-pulse', title: 'AI search pulse', status: 'failed', createdAt: at('12'), updatedAt: at('12', '09:00:00'), error: 'The Apify token was refused.', discoveredThemes: [] },
        { id: 'research-scan', workspaceId: 'semrush', programId: 'program-pulse', origin: 'quick-scan', quickScan: { topic: 'SEO' }, title: 'Quick scan · SEO', status: 'succeeded', createdAt: at('15'), updatedAt: at('15', '10:30:00'), discoveredThemes: [theme('q-1', 'Zero click')] },
        { id: 'research-other', workspaceId: 'general', status: 'succeeded', createdAt: at('15'), discoveredThemes: [theme('x', 'Elsewhere')] },
        { id: 'research-old', workspaceId: 'semrush', status: 'succeeded', createdAt: '2026-08-01T10:00:00.000Z', discoveredThemes: [theme('o', 'Old')] },
      ],
      contentRuns: [
        { id: 'content-report', workspaceId: 'semrush', title: 'AI Overviews', themeId: 't-2', researchRunId: 'research-done', status: 'succeeded', createdAt: at('10', '14:00:00'), updatedAt: at('10', '15:00:00') },
        { id: 'content-kit', workspaceId: 'semrush', title: 'AI Overviews', status: 'succeeded', createdAt: at('13'), updatedAt: at('13', '12:00:00'), kit: { sourceKey: 'theme:t-2', sourceTitle: 'AI Overviews' } },
        { id: 'content-stopped', workspaceId: 'semrush', title: 'Local packs', status: 'partial', message: 'The Anthropic API key was refused.', createdAt: at('15'), updatedAt: at('15', '09:00:00'), kit: { sourceKey: 'theme:t-3', sourceTitle: 'Local packs' } },
        { id: 'content-live', workspaceId: 'semrush', title: 'Live', status: 'running', createdAt: at('16'), kit: { sourceKey: 'theme:t-1' } },
      ],
      assets: [
        { id: 'asset-report', workspaceId: 'semrush', runId: 'content-report', deliverableId: 'evidence-report', title: 'AI Overviews — Trends report', createdAt: at('10', '15:00:00'), edited: { at: at('15', '16:00:00'), by: { id: 'member-sam', name: 'Sam' } } },
        { id: 'asset-mine', workspaceId: 'semrush', runId: 'content-report', deliverableId: 'editorial-toolkit', title: 'TREND: AI Overviews', createdAt: at('10', '15:00:00'), edited: { at: at('15', '17:00:00'), by: { id: 'member-riley', name: 'Riley' } } },
        { id: 'asset-kit', workspaceId: 'semrush', runId: 'content-kit', deliverableId: 'social', title: 'Social posts', createdAt: at('13') },
      ],
      adoptionsByTheme: { 't-2': { social: { status: 'using', link: 'https://www.linkedin.com/posts/x', byName: 'Jordan', at: at('16', '08:00:00'), channelName: 'Semrush Social Team' } } },
      ...extra,
    },
  };
}
const riley = { id: 'member-riley', name: 'Riley', role: 'editor', allowed: ['decideResearchTheme', 'readTrendHistory'] };
const kinds = (result) => result.items.map((item) => [item.kind, item.title]);

describe('the inbox', () => {
  it('lists what changed for an editor, newest first, from this workspace and the last 30 days', () => {
    const inbox = buildInbox({ state: state(), viewer: riley, seenAt: '', now: NOW });
    expect(kinds(inbox)).toEqual([
      ['adoption', 'Semrush Social Team used “AI Overviews”'],
      ['edit', 'Sam edited “AI Overviews — Trends report”'],
      ['run-finished', 'Quick scan finished · “SEO”'],
      ['run-stopped', 'Channel assets stopped · “Local packs”'],
      ['needs-ok', '2 trends need your OK'],
      ['run-finished', 'Channel assets ready · “AI Overviews”'],
      ['run-stopped', 'Research run stopped: The Apify token was refused.'],
      ['run-finished', 'Report ready · “AI Overviews”'],
      ['run-finished', 'Research run finished · 2 trends'],
    ]);
    const byId = Object.fromEntries(inbox.items.map((item) => [item.id, item]));
    expect(byId['needs-ok:research-review']).toMatchObject({ detail: expect.stringMatching(/^AI search pulse · \w+’s run$/), target: { kind: 'trend', id: 't-2', page: 'trends' } });
    expect(byId['run:research-failed'].detail).toBe('AI search pulse · ask Alex'); // only an admin can fix a refused token
    expect(byId['run:content-stopped']).toMatchObject({ detail: 'The Anthropic API key was refused. · ask Alex', target: { kind: 'folder', id: 'theme:t-3', page: 'assets' } });
    expect(byId['run:content-report'].target).toEqual({ kind: 'report', id: 'asset-report', page: 'reports' });
    expect(byId['adoption:t-2:social:2026-10-16T08:00:00.000Z']).toMatchObject({ detail: 'https://www.linkedin.com/posts/x', target: { kind: 'trend', id: 't-2', page: 'trends' } });
    // Riley's own edit and the running set aren't news to Riley.
    expect(inbox.items.some((item) => item.id.startsWith('edit:asset-mine'))).toBe(false);
    expect(inbox.items.some((item) => item.id === 'run:content-live')).toBe(false);
  });

  it('counts unread rows from inboxSeenAt, or the last 7 days when it was never set', () => {
    expect(buildInbox({ state: state(), viewer: riley, seenAt: at('15', '12:00:00'), now: NOW }).unread).toBe(2);
    expect(buildInbox({ state: state(), viewer: riley, seenAt: '2026-10-17T00:00:00.000Z', now: NOW }).unread).toBe(0);
    const fresh = buildInbox({ state: state(), viewer: riley, seenAt: '', now: NOW });
    expect(fresh.unread).toBe(fresh.items.filter((item) => Date.parse(item.at) > NOW - 7 * 86400000).length);
    expect(fresh.items.find((item) => item.id === 'run:research-done').unread).toBe(true);
  });

  it('leaves out trends to decide for someone who can’t decide them, and the admin note for admins', () => {
    const viewer = { id: 'member-pat', role: 'editor', allowed: ['readTrendHistory'] };
    expect(buildInbox({ state: state(), viewer, now: NOW }).items.some((item) => item.kind === 'needs-ok')).toBe(false);
    const admin = { id: 'member-alex', role: 'admin', allowed: null };
    expect(buildInbox({ state: state(), viewer: admin, now: NOW }).items.find((item) => item.id === 'run:research-failed').detail).toBe('AI search pulse');
  });

  it('shows a channel owner the trends routed to them and their own sets', () => {
    const channelState = { team: { admins: [] }, contentStudio: { activeWorkspaceId: 'semrush', channelView: { channel: { id: 'social', name: 'Semrush Social Team' }, trends: [
      { themeId: 't-2', name: 'AI Overviews', readyAt: at('15'), isNew: true, forUs: true, suggestion: { byName: 'Riley', note: 'Lead with the CTR data.', channels: [{ id: 'social', name: 'Semrush Social Team' }] } },
      { themeId: 't-3', name: 'Local packs', readyAt: at('14'), isNew: true, forUs: false, suggestion: null },
      { themeId: 't-4', name: 'Answered', readyAt: at('13'), isNew: false, forUs: false },
    ], runs: [{ id: 'kit-1', title: 'AI Overviews', status: 'succeeded', createdAt: at('15', '11:00:00'), finishedAt: at('15', '12:00:00'), message: 'All 2 files are ready.', kit: { themeId: 't-2' } }, { id: 'kit-2', title: 'Local packs', status: 'running', createdAt: at('16') }] } } };
    const inbox = buildInbox({ state: channelState, viewer: { id: 'member-sam', role: 'channel', allowed: ['setTrendAdoption'] }, now: NOW });
    expect(kinds(inbox)).toEqual([
      ['run-finished', 'Drafts ready · “AI Overviews”'],
      ['routed', 'Riley suggested “AI Overviews” for Semrush Social Team'],
      ['routed', 'New trend for Semrush Social Team: “Local packs”'],
    ]);
    expect(inbox.items[1]).toMatchObject({ detail: '“Lead with the CTR data.”', target: { kind: 'trend', id: 't-2', page: 'trends' } });
  });

  it('shows prompt changes when the studio pushes them, never one’s own', () => {
    const changes = [{ promptId: 'trends-report', promptName: 'Trends report', version: 3, at: at('15'), by: { id: 'member-alex', name: 'Alex' }, note: 'Shorter intro' }, { promptId: 'synthesis', version: 2, at: at('15'), by: { id: 'member-riley', name: 'Riley' } }];
    const inbox = buildInbox({ state: state({ promptChanges: changes }), viewer: riley, now: NOW });
    const rows = inbox.items.filter((item) => item.kind === 'prompt-change');
    expect(rows).toEqual([expect.objectContaining({ title: 'Alex changed the “Trends report” prompt', detail: 'Version 3 · Shorter intro', target: { kind: 'prompt', id: 'trends-report', page: 'prompts' } })]);
    expect(INBOX_KIND_LABEL['prompt-change']).toBe('Prompt change');
  });

  it('is empty, not broken, for an empty studio', () => {
    expect(buildInbox({ state: {}, viewer: {}, now: NOW })).toEqual({ items: [], unread: 0 });
  });
});

describe('workflow rows', () => {
  const flows = (extra = {}) => ({ team: { admins: [{ name: 'Alex' }] }, contentStudio: {
    activeWorkspaceId: 'semrush',
    workflows: [
      { id: 'workflow-a', workspaceId: 'semrush', name: 'Weekly SEO watch', status: 'active', needsBudget: false, updatedAt: at('14') },
      { id: 'workflow-b', workspaceId: 'semrush', name: 'PR angles', status: 'draft', needsBudget: true, approvalRequested: { by: { id: 'm-riley', name: 'Riley' }, at: at('15') }, updatedAt: at('15') },
    ],
    workflowRuns: [
      { id: 'wfrun-review', workflowId: 'workflow-a', workspaceId: 'semrush', status: 'waiting-review', waiting: { kind: 'review', since: at('16', '08:00:00'), count: 2, untilAt: at('18', '08:00:00') }, steps: [], createdAt: at('16', '08:00:00') },
      { id: 'wfrun-budget', workflowId: 'workflow-a', workspaceId: 'semrush', status: 'waiting-budget', message: 'Needs a bigger budget: the next set can cost about $4.00.', waiting: { kind: 'budget', since: at('15', '08:00:00') }, steps: [], createdAt: at('15', '08:00:00') },
      { id: 'wfrun-done', workflowId: 'workflow-a', workspaceId: 'semrush', status: 'succeeded', notify: { audience: ['editor'], summary: 'Weekly SEO watch: 2 trends, 2 reports.' }, steps: [{ kind: 'notify', status: 'done' }], createdAt: at('13'), finishedAt: at('13', '12:00:00') },
      { id: 'wfrun-stopped', workflowId: 'workflow-a', workspaceId: 'semrush', status: 'partial', message: 'Stopped at Make channel assets: the writer stopped.', steps: [{ kind: 'assets', status: 'failed' }], createdAt: at('12'), finishedAt: at('12', '12:00:00') },
    ],
    ...extra,
  } });
  const admin = { id: 'local', role: 'admin', base: 'admin', allowed: null };
  const editor = { id: 'm-riley', role: 'editor', base: 'editor', capabilities: ['readWorkflows', 'manageWorkflows', 'seeCosts'], allowed: ['decideResearchTheme', 'retryWorkflowRun', 'estimateWorkflow'] };
  const reader = { id: 'm-viewer', role: 'editor', base: 'editor', capabilities: ['readWorkflows'], allowed: ['estimateWorkflow'] };
  const kinds = (viewer) => buildInbox({ state: flows(), viewer, now: NOW }).items.map((item) => item.kind).sort();
  it('shows each person the workflow rows their role acts on', () => {
    expect(kinds(admin)).toEqual(['workflow-budget', 'workflow-draft', 'workflow-review', 'workflow-stopped']);
    expect(kinds(editor)).toEqual(['workflow-finished', 'workflow-review', 'workflow-stopped']);
    // Finished rows follow the notify audience (editors here); nothing to act on otherwise.
    expect(kinds(reader)).toEqual(['workflow-finished']);
  });
  it('words the rows plainly and points them at the workflow or Trends', () => {
    const items = buildInbox({ state: flows(), viewer: admin, now: NOW }).items;
    expect(items.find((item) => item.kind === 'workflow-review')).toMatchObject({ title: '“Weekly SEO watch” is waiting for your OK on 2 trends', target: { kind: 'page', page: 'trends' } });
    expect(items.find((item) => item.kind === 'workflow-budget')).toMatchObject({ title: '“Weekly SEO watch” needs a bigger budget to carry on', target: { kind: 'workflow', id: 'workflow-a', runId: 'wfrun-budget' } });
    expect(items.find((item) => item.kind === 'workflow-draft')).toMatchObject({ title: 'Riley asked you to approve “PR angles”', target: { kind: 'workflow', id: 'workflow-b' } });
    expect(INBOX_KIND_LABEL['workflow-finished']).toBe('Workflow finished');
  });
});
