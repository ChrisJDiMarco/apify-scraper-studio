import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// The email admins get when a run stops (email-templates.js runStoppedEmail) and who gets it, when, and how often
// (run-alerts.js). The studio's own wiring is in email-hooks.test.js and content-workspace.test.js.
const require = createRequire(import.meta.url);
const { runStoppedEmail, scrubError } = require('../src/main/email-templates.js');
const { createRunAlerts, DEDUPE_MS } = require('../src/main/run-alerts.js');

const ADMINS = [{ id: 'member-chris', name: 'Chris', email: 'chris@semrush.com' }, { id: 'member-john', name: 'John', email: 'John@Semrush.com' }];
const MEMBERS = { 'member-riley': { id: 'member-riley', email: 'riley@semrush.com', disabled: false }, 'member-off': { id: 'member-off', email: 'off@semrush.com', disabled: true }, 'member-john': { id: 'member-john', email: 'john@semrush.com', disabled: false } };
const run = (extra = {}) => ({ id: 'research-1', type: 'research', title: 'AI search pulse', status: 'failed', message: 'Provider down', costUsd: 40.125, createdBy: { id: 'member-riley', name: 'Riley' }, ...extra });
function alerts({ ready = true, clock = { at: 1_000_000 } } = {}) {
  const sent = []; const logs = [];
  const api = createRunAlerts({ ready: () => ready, adminContacts: () => ADMINS, memberById: (id) => MEMBERS[id] || null, send: (kind, to, message, fields) => sent.push({ kind, to, message, fields }), origin: () => 'https://studio.example.com', now: () => clock.at, log: (event) => logs.push(event) });
  return { api, sent, logs, clock };
}

describe('the stopped-run email', () => {
  it('says what stopped, how far it got, what it cost and that Retry keeps finished work', () => {
    const email = runStoppedEmail({ title: 'AI search pulse', type: 'research', status: 'failed', reached: 'Tagging posts · batch 64 of 65', error: 'The AI provider stopped answering.', costUsd: 40.125, startedBy: 'Riley', origin: 'https://studio.example.com' });
    expect(email.subject).toBe('Research run failed: AI search pulse');
    expect(email.text).toContain('The research run “AI search pulse”, started by Riley, stopped before it finished.');
    expect(email.text).toContain('It got as far as: Tagging posts · batch 64 of 65');
    expect(email.text).toContain('What went wrong: The AI provider stopped answering.');
    expect(email.text).toContain('Cost so far: $40.13');
    expect(email.text).toContain('choose “Retry unfinished outputs”: work that already finished is kept and isn’t paid for again.');
    expect(email.text).toContain('Open Golden Thread: https://studio.example.com');
    expect(email.html).toContain('href="https://studio.example.com"');
    expect(email.html).toContain('Tagging posts · batch 64 of 65');
  });

  it('words a partial run, a quick scan and a content run', () => {
    expect(runStoppedEmail({ title: 'Weekly', type: 'research', status: 'partial' })).toMatchObject({ subject: 'Research run partly finished: Weekly' });
    expect(runStoppedEmail({ title: 'Weekly', type: 'research', status: 'partial' }).text).toContain('finished, but some of its outputs didn’t.');
    expect(runStoppedEmail({ title: 'Quick scan · AEO', type: 'research', quickScan: true }).subject).toBe('Quick scan failed: Quick scan · AEO');
    expect(runStoppedEmail({ title: 'Kit', type: 'content' }).subject).toBe('Content run failed: Kit');
    expect(runStoppedEmail({ title: '', type: 'content' }).text).toContain('Cost so far: $0.00');
  });

  it('escapes the title and error in the HTML and keeps the subject on one line', () => {
    const email = runStoppedEmail({ title: '<img src=x onerror=alert(1)>\r\nBcc: x@y.com', type: 'research', error: 'Bad <b>JSON</b> & more', reached: '"quoted"' });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('Bad &lt;b&gt;JSON&lt;/b&gt; &amp; more');
    expect(email.html).toContain('&quot;quoted&quot;');
  });

  it('keeps file paths, link queries, keys and tokens out of the error', () => {
    const error = 'Failed reading /app/data/content-studio/runs/research-1/evidence.json and C:\\Users\\chris\\AppData\\x.json: '
      + 'GET https://api.apify.com/v2/datasets/abc?token=apify_api_SECRETSECRETSECRET1234 401 '
      + 'Authorization: Bearer sk-ant-api03-SECRETVALUE123456 api_key=hunter2hunter2 re_ABCDEFGH12345678 '
      + `hash ${'f'.repeat(64)} and/or 3/4 done`;
    const clean = scrubError(error);
    expect(clean).not.toMatch(/\/app\/data|AppData|SECRET|hunter2|re_ABCDEFGH|f{32}|token=/);
    expect(clean).toContain('https://api.apify.com');
    expect(clean).toContain('[file]');
    expect(clean).toContain('and/or 3/4 done');
    expect(scrubError('x'.repeat(2000) + ' y').length).toBeLessThanOrEqual(400);
    const email = runStoppedEmail({ title: 'T', type: 'research', error, reached: 'Tagging posts' });
    expect(email.text + email.html).not.toMatch(/SECRET|hunter2|\/app\/data|f{32}/);
  });
});

describe('who hears about a stopped run, and when', () => {
  it('emails every admin and the member who started it, once each', () => {
    const { api, sent } = alerts();
    expect(api.runEnded({ run: run(), reached: 'Tagging posts · batch 64 of 65', error: 'Provider down' })).toEqual(['chris@semrush.com', 'john@semrush.com', 'riley@semrush.com']);
    expect(sent.map((email) => [email.kind, email.to, email.fields])).toEqual([
      ['run-stopped', 'chris@semrush.com', { runId: 'research-1', memberId: 'member-chris' }],
      ['run-stopped', 'john@semrush.com', { runId: 'research-1', memberId: 'member-john' }],
      ['run-stopped', 'riley@semrush.com', { runId: 'research-1', memberId: 'member-riley' }],
    ]);
    expect(sent[0].message.text).toContain('It got as far as: Tagging posts · batch 64 of 65');
    // An admin who started it gets one email; a disabled member or a non-member (the server owner) gets none.
    expect(alerts().api.runEnded({ run: run({ createdBy: { id: 'member-john', name: 'John' } }) })).toHaveLength(2);
    expect(alerts().api.runEnded({ run: run({ createdBy: { id: 'member-off', name: 'Off' } }) })).toHaveLength(2);
    expect(alerts().api.runEnded({ run: run({ createdBy: { id: 'owner', name: 'Owner' } }) })).toHaveLength(2);
  });

  it('emails for failed and partial runs, never a cancel, a success or a report run inside a research run', () => {
    for (const status of ['cancelled', 'succeeded', 'running', 'awaiting-review']) expect(alerts().api.runEnded({ run: run({ status }) })).toEqual([]);
    expect(alerts().api.runEnded({ run: run({ status: 'partial' }) })).toHaveLength(3);
    expect(alerts().api.runEnded({ run: run({ id: 'content-1', type: 'content', researchRunId: 'research-1' }) })).toEqual([]);
    expect(alerts().api.runEnded({ run: run({ id: 'content-2', type: 'content', researchRunId: 'research-1', scanReport: true }) })).toHaveLength(3);
  });

  it('sends nothing while email is off', () => {
    const { api, sent } = alerts({ ready: false });
    expect(api.runEnded({ run: run() })).toEqual([]); expect(sent).toEqual([]);
  });

  it('stays quiet when a retry fails again soon after, and speaks up once the window has passed', () => {
    const { api, sent, logs, clock } = alerts();
    api.runEnded({ run: run() }); expect(sent).toHaveLength(3);
    clock.at += 5 * 60 * 1000; api.runEnded({ run: run({ status: 'partial' }) });
    expect(sent).toHaveLength(3); expect(logs).toEqual([{ event: 'run-email-skipped', reason: 'recent', runId: 'research-1' }]);
    api.runEnded({ run: run({ id: 'research-2' }) }); expect(sent).toHaveLength(6); // another run is its own news
    clock.at += DEDUPE_MS; api.runEnded({ run: run() }); expect(sent).toHaveLength(9);
  });

  it('never throws into the run', () => {
    const api = createRunAlerts({ ready: () => true, adminContacts: () => { throw new Error('team.json'); }, send: () => {}, log: () => {} });
    expect(api.runEnded({ run: run() })).toEqual([]);
    expect(createRunAlerts().runEnded()).toEqual([]);
  });
});
