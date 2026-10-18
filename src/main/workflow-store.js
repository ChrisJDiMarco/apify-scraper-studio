'use strict';
// Workflows, their runs and the team's own playbooks: content-studio/workflows.json, inside the folder the studio owner
// lock protects (one writer). Synchronous and atomic: every change is written through the host's writeJson (temp file,
// fsync, rename) before change() returns. A file from a newer studio refuses to start, like team.json.
const fs = require('fs');
const { LIMITS } = require('../shared/workflow-core');

const STORE_VERSION = 1;
const fresh = () => ({ version: STORE_VERSION, workflows: [], runs: [], playbooks: [] });
const copy = (value) => JSON.parse(JSON.stringify(value));
const list = (value) => (Array.isArray(value) ? value : []);

function defaultWriteJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(require('path').dirname(file), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function createWorkflowStore({ file, writeJson = defaultWriteJson } = {}) {
  if (!file) throw new Error('The workflow store needs its file.');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Workflows could not be read (${error.code || 'damaged file'}). Nothing was changed. Restore content-studio/workflows.json from a backup, then start the studio again.`);
    data = fresh();
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = fresh();
  if (Number(data.version) > STORE_VERSION) throw new Error('This workflows file is from a newer Scraper Studio. Update the app or server.');
  data = { version: STORE_VERSION, workflows: list(data.workflows), runs: list(data.runs), playbooks: list(data.playbooks) };

  // Retention: 100 runs kept per workflow and 2,000 in all (newest first by createdAt); runs still going are always kept.
  function prune(next) {
    const live = new Set(['running', 'waiting-review', 'waiting-budget']);
    const sorted = [...next.runs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const perWorkflow = new Map(); const kept = [];
    for (const run of sorted) {
      const count = perWorkflow.get(run.workflowId) || 0;
      if (!live.has(run.status) && (count >= LIMITS.runsPerWorkflow || kept.length >= LIMITS.runsTotal)) continue;
      perWorkflow.set(run.workflowId, count + 1); kept.push(run);
    }
    next.runs = kept;
    return next;
  }

  return {
    read: () => copy(data),
    // mutator(draft) changes a copy and may return a value; the copy is written whole, then becomes the store. A mutator
    // that throws changes nothing.
    change(mutator) {
      const draft = copy(data);
      const result = mutator(draft);
      const next = prune({ version: STORE_VERSION, workflows: list(draft.workflows), runs: list(draft.runs), playbooks: list(draft.playbooks) });
      writeJson(file, next);
      data = next;
      return result === undefined ? undefined : copy(result);
    },
  };
}

module.exports = { createWorkflowStore, STORE_VERSION };
