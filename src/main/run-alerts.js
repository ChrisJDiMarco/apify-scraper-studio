'use strict';
// When a research or content run ends failed or partial, its admins (and whoever started it) hear by email
// (email-templates.js runStoppedEmail). Never for a cancel. A report run inside a research run is left to that run,
// which ends partial too. One email per run in DEDUPE_MS, so a retry that fails again soon after is quiet. Fire and
// forget: send() never throws, and nothing here changes the run. CommonJS, Electron-free.
const { runStoppedEmail } = require('./email-templates');

const DEDUPE_MS = 30 * 60 * 1000;

// ready(): email is on (and this is the browser studio). adminContacts(): [{ id, email }]. memberById(id): a member or
// null. send(kind, to, message, fields). origin(): the studio's address for the button.
function createRunAlerts({ ready = () => false, adminContacts = () => [], memberById = () => null, send, origin = () => '', now = () => Date.now(), log = () => {}, windowMs = DEDUPE_MS } = {}) {
  const recent = new Map(); // run id → when its email went out
  // runEnded({ run, reached, error }): run as the studio shows it (cost includes its report runs); reached is the step it
  // showed last; error what stopped it (else run.message). Answers the addresses it emailed.
  function runEnded({ run, reached = '', error = '' } = {}) {
    try {
      if (!run?.id || !['failed', 'partial'].includes(run.status)) return [];
      if (run.researchRunId && !run.scanReport) return [];
      if (!ready()) return [];
      const at = now();
      for (const [id, sentAt] of recent) if (at - sentAt >= windowMs) recent.delete(id);
      if (recent.has(run.id)) { log({ event: 'run-email-skipped', reason: 'recent', runId: run.id }); return []; }
      const to = new Map();
      for (const admin of adminContacts()) if (admin?.email) to.set(admin.email.toLowerCase(), admin.id);
      const starter = run.createdBy?.id ? memberById(run.createdBy.id) : null;
      if (starter?.email && !starter.disabled && !to.has(starter.email.toLowerCase())) to.set(starter.email.toLowerCase(), starter.id);
      if (!to.size) return [];
      recent.set(run.id, at);
      const message = runStoppedEmail({ title: run.title, type: run.type, quickScan: Boolean(run.quickScan), scanReport: Boolean(run.scanReport), status: run.status, reached, error: error || run.message, costUsd: run.costUsd, startedBy: run.createdBy?.name || '', origin: origin() });
      for (const [email, memberId] of to) send('run-stopped', email, message, { runId: run.id, memberId });
      return [...to.keys()];
    } catch (error) { log({ event: 'email-failed', kind: 'run-stopped', code: error?.code || '' }); return []; }
  }
  return { runEnded };
}

module.exports = { createRunAlerts, DEDUPE_MS };
