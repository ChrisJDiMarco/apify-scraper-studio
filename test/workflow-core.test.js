import { describe, expect, it } from 'vitest';
import core from '../src/shared/workflow-core.js';

const program = (extra = {}) => ({ id: 'program-a', name: 'SEO weekly', maxThemes: 6, budgets: { collectionUsd: 5, aiUsd: 10 }, ai: { models: { discovery: 'claude-opus-5-5' }, effort: { discovery: 'medium' } }, sourceGroups: [{ sourceId: 'x', platform: 'x', targets: ['a', 'b'], enabled: true }], schedule: { frequency: 'manual', enabled: false }, autoApproveThemes: false, ...extra });
const folders = ['blog', 'newsletter', 'social', 'pr', 'enterprise'];
const opts = (extra = {}) => ({ programs: [program()], kitFolderIds: folders, now: new Date('2026-10-17T12:00:00Z'), ...extra });
const research = [
  { kind: 'research', programId: 'program-a' },
  { kind: 'approve', mode: 'rules', rules: [{ momentum: ['rising', 'new'], priority: ['FAST-TRACK', 'STRONG'] }], maxApprove: 3 },
  { kind: 'reports' },
  { kind: 'assets', channels: ['blog', 'social'], pictures: true },
  { kind: 'monday' },
  { kind: 'notify', audience: ['editor'] },
];
const weekly = { kind: 'schedule', schedule: { frequency: 'weekly', time: '08:00', timeZone: 'America/New_York', weekday: 1 } };
const draft = (extra = {}) => ({ name: 'Weekly SEO watch', trigger: weekly, steps: research, ...extra });

describe('validateWorkflow grammar', () => {
  it('accepts the full research chain and numbers the steps', () => {
    const { workflow, warnings } = core.validateWorkflow(draft(), opts());
    expect(workflow.steps.map((step) => step.id)).toEqual(['step-1', 'step-2', 'step-3', 'step-4', 'step-5', 'step-6']);
    expect(workflow.steps[1]).toMatchObject({ mode: 'rules', maxApprove: 3, otherwise: 'review', waitHours: 48, afterWait: 'continue' });
    expect(warnings.join(' ')).toMatch(/Monday.com isn’t connected/);
    expect(warnings.join(' ')).toMatch(/Pictures are off/);
  });
  const refused = (steps, field, message, extra = {}) => {
    let error; try { core.validateWorkflow(draft({ steps, ...extra }), opts(extra.opts)); } catch (caught) { error = caught; }
    expect(error, message).toBeTruthy(); expect(error.message).toMatch(message); if (field) expect(error.field).toBe(field);
  };
  it('needs exactly one source step, first', () => {
    refused([{ kind: 'reports' }], 'steps.0.kind', /first step finds trends/);
    refused([research[0], research[1], { kind: 'quick-scan', programId: 'program-a', scan: { topic: 'SEO' } }], 'steps', /one research step/);
  });
  it('requires approve after research, and reports before assets', () => {
    refused([research[0], research[2]], 'steps.1.kind', /Approve trends/);
    refused([research[0], research[1], research[3]], 'steps', /Write reports/);
    refused([research[0], research[1], research[3], research[2]], 'steps.3.kind', /wrong place/);
  });
  it('allows only telling the team after a quick scan', () => {
    const scan = { kind: 'quick-scan', programId: 'program-a', scan: { topic: 'SEO', depth: 'standard' } };
    expect(core.validateWorkflow(draft({ steps: [scan, { kind: 'notify' }] }), opts()).workflow.steps[0].scan).toMatchObject({ topic: 'SEO', depth: 'standard', lookbackHours: 24 });
    refused([scan, research[4]], 'steps.1.kind', /Quick scan trends never reach/);
  });
  it('allows every few hours only for quick scans, ending within 31 days', () => {
    const scan = { kind: 'quick-scan', programId: 'program-a', scan: { topic: 'Launch' } };
    const hourly = (until) => ({ kind: 'schedule', schedule: { frequency: 'hourly', everyHours: 6, time: '08:00', timeZone: 'UTC', until } });
    expect(core.validateWorkflow(draft({ steps: [scan], trigger: hourly('2026-10-25') }), opts()).workflow.trigger.schedule).toMatchObject({ everyHours: 6, until: '2026-10-25' });
    refused([scan], 'trigger.schedule.until', /up to 31 days/, { trigger: hourly('2026-12-25') });
    refused(research, 'trigger.schedule.frequency', /Only quick scans/, { trigger: hourly('2026-10-25') });
  });
  it('checks step and rule limits', () => {
    refused(Array.from({ length: 9 }, () => research[0]), 'steps', /up to 8 steps/);
    refused([research[0], { ...research[1], rules: Array.from({ length: 5 }, () => ({ momentum: ['new'] })) }], 'steps.1.rules', /up to 4 rules/);
    refused([research[0], { ...research[1], rules: [{}] }], 'rules.0', /at least one condition/);
    refused([research[0], { ...research[1], maxApprove: 9 }], 'steps.1.maxApprove', /1 to 6/);
  });
  it('ties a program-run trigger to the same program, and forces “all” when the program approves itself', () => {
    refused(research, 'trigger.programId', /same program/, { trigger: { kind: 'program-run', programId: 'program-b' }, opts: { programs: [program(), program({ id: 'program-b' })] } });
    refused(research, 'steps.1.mode', /approves every trend itself/, { opts: { programs: [program({ autoApproveThemes: true })] } });
    expect(core.validateWorkflow(draft({ steps: [research[0], { kind: 'approve', mode: 'all' }] }), opts({ programs: [program({ autoApproveThemes: true })] })).workflow.steps[1].mode).toBe('all');
  });
  it('refuses a schedule on a program that has its own', () => {
    refused(research, 'trigger', /already runs on its own schedule/, { opts: { programs: [program({ schedule: { frequency: 'daily', enabled: true } })] } });
  });
  it('refuses notes that look like a key', () => {
    refused([research[0], research[1], research[2], { ...research[3], teamNotes: 'use sk-abcdefghijklmnopqrstuvwxyz' }], 'steps.3.teamNotes', /password, key or token/);
  });
});

describe('budgetHash', () => {
  const byId = { 'program-a': program() };
  const hash = (workflow, programs = byId) => core.budgetHash(core.validateWorkflow(workflow, opts({ programs: Object.values(programs) })).workflow, programs);
  it('is stable across key order and ignores notes, Monday.com, telling the team and the time of day', () => {
    const base = hash(draft());
    const reordered = { steps: research.map((step) => Object.fromEntries(Object.entries(step).reverse())), trigger: weekly, name: 'Weekly SEO watch' };
    expect(hash(reordered)).toBe(base);
    expect(hash(draft({ steps: research.map((step) => (step.kind === 'assets' ? { ...step, teamNotes: 'Shorter' } : step.kind === 'notify' ? { ...step, audience: ['admin'] } : step.kind === 'monday' ? { ...step, alsoAtReview: true } : step)) }))).toBe(base);
    expect(hash(draft({ trigger: { kind: 'schedule', schedule: { ...weekly.schedule, time: '10:00' } } }))).toBe(base);
    expect(hash(draft({ name: 'Renamed' }))).toBe(base);
  });
  it('changes with channels, pictures, maxApprove, the program’s budgets and models, and the cadence', () => {
    const base = hash(draft());
    expect(hash(draft({ steps: research.map((step) => (step.kind === 'assets' ? { ...step, channels: ['blog'] } : step)) }))).not.toBe(base);
    expect(hash(draft({ steps: research.map((step) => (step.kind === 'assets' ? { ...step, pictures: false } : step)) }))).not.toBe(base);
    expect(hash(draft({ steps: research.map((step) => (step.kind === 'approve' ? { ...step, maxApprove: 4 } : step)) }))).not.toBe(base);
    expect(hash(draft(), { 'program-a': program({ budgets: { collectionUsd: 5, aiUsd: 11 } }) })).not.toBe(base);
    expect(hash(draft(), { 'program-a': program({ ai: { models: { discovery: 'claude-sonnet-5' }, effort: { discovery: 'medium' } } }) })).not.toBe(base);
    expect(hash(draft({ trigger: { kind: 'schedule', schedule: { ...weekly.schedule, frequency: 'daily' } } }))).not.toBe(base);
  });
});

describe('selectByRules', () => {
  const themes = [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }, { id: 't3', name: 'Three' }, { id: 't4', name: 'Four' }];
  const signals = {
    t1: { momentum: 'rising', priorityTier: 'STRONG', priorityScore: 50, velocity: 'EMERGING', posts: 30, platforms: ['x'] },
    t2: { momentum: 'new', priorityTier: 'FAST-TRACK', priorityScore: 90, velocity: 'NEW', posts: 10, platforms: ['x', 'reddit'] },
    t3: { momentum: 'steady', priorityTier: 'STRONG', priorityScore: 70, velocity: 'NEW', posts: 5, platforms: ['x'] },
    t4: { momentum: 'rising', priorityTier: 'LOW', priorityScore: 99, velocity: 'NEW', posts: 50, platforms: ['x'] },
  };
  it('ANDs fields inside a rule, ORs the rules, strongest first, up to maxApprove', () => {
    const approve = { mode: 'rules', rules: [{ momentum: ['rising', 'new'], priority: ['FAST-TRACK', 'STRONG'] }], maxApprove: 3 };
    expect(core.selectByRules(themes, signals, approve).approved).toEqual([{ themeId: 't2', name: 'Two', reason: 'New · Fast-track' }, { themeId: 't1', name: 'One', reason: 'Rising · Strong' }]);
    const either = { ...approve, rules: [...approve.rules, { velocity: ['NEW'], minPlatforms: 1 }], maxApprove: 2 };
    expect(core.selectByRules(themes, signals, either).approved.map((row) => row.themeId)).toEqual(['t4', 't2']);
  });
  it('never decides a trend a person already decided', () => {
    const approve = { mode: 'rules', rules: [{ momentum: ['rising', 'new'] }], maxApprove: 6 };
    const { approved, rest } = core.selectByRules(themes, signals, approve, ['t2']);
    expect(approved.map((row) => row.themeId)).toEqual(['t4', 't1']);
    expect(rest).toEqual(['t3']);
  });
  it('mode all takes every undecided trend', () => {
    expect(core.selectByRules(themes, signals, { mode: 'all' }, ['t1']).approved).toHaveLength(3);
  });
  it('minPosts needs at least that many posts', () => {
    expect(core.selectByRules(themes, signals, { mode: 'rules', rules: [{ minPosts: 30 }], maxApprove: 6 }).approved.map((row) => row.reason)).toEqual(['50 posts', '30 posts']);
  });
});

describe('nextTriggerAt and runsPerMonth', () => {
  it('weekly and monthly follow research schedules, across daylight saving', () => {
    expect(core.nextTriggerAt(weekly, { from: '2026-10-17T12:00:00Z' })).toBe('2026-10-19T12:00:00.000Z');
    expect(core.nextTriggerAt(weekly, { from: '2026-10-31T12:00:00Z' })).toBe('2026-11-02T13:00:00.000Z');
    expect(core.nextTriggerAt({ kind: 'schedule', schedule: { frequency: 'monthly', time: '09:00', timeZone: 'UTC', dayOfMonth: 31 } }, { from: '2026-11-01T00:00:00Z' })).toBe('2026-11-30T09:00:00.000Z');
  });
  it('every few hours lines up on the day’s time and stops after the last day', () => {
    const trigger = { kind: 'schedule', schedule: { frequency: 'hourly', everyHours: 6, time: '08:00', timeZone: 'UTC', until: '2026-10-18' } };
    expect(core.nextTriggerAt(trigger, { from: '2026-10-17T09:00:00Z' })).toBe('2026-10-17T14:00:00.000Z');
    expect(core.nextTriggerAt(trigger, { from: '2026-10-18T21:00:00Z' })).toBe('');
    expect(core.nextTriggerAt({ kind: 'manual' })).toBe('');
  });
  it('estimates runs a month', () => {
    expect(core.runsPerMonth(weekly)).toEqual({ min: 4, max: 5 });
    expect(core.runsPerMonth({ kind: 'schedule', schedule: { frequency: 'daily' } })).toEqual({ min: 28, max: 31 });
    expect(core.runsPerMonth({ kind: 'schedule', schedule: { frequency: 'hourly', everyHours: 6, until: '2026-10-20' } }, [], { now: new Date('2026-10-17T00:00:00Z') })).toEqual({ min: 16, max: 16 });
    expect(core.runsPerMonth({ kind: 'manual' })).toBeNull();
    expect(core.runsPerMonth({ kind: 'program-run', programId: 'program-a' }, [program({ schedule: { frequency: 'weekly', enabled: true } })])).toEqual({ min: 4, max: 5 });
  });
  it('names the month in the schedule’s time zone', () => {
    expect(core.monthKey('2026-11-01T02:00:00Z', 'America/New_York')).toBe('2026-10');
    expect(core.monthKey('2026-11-01T02:00:00Z', 'UTC')).toBe('2026-11');
  });
});

describe('parseAccounts', () => {
  it('sorts handles, communities and LinkedIn pages into source groups', () => {
    expect(core.parseAccounts('@acme, r/acme\nhttps://www.linkedin.com/company/acme globex')).toEqual([
      { sourceId: 'x', platform: 'x', targets: ['@acme', 'globex'], enabled: true },
      { sourceId: 'reddit', platform: 'reddit', targets: ['r/acme'], enabled: true },
      { sourceId: 'linkedin-profile', platform: 'linkedin', targets: ['https://www.linkedin.com/company/acme'], enabled: true },
    ]);
  });
});
