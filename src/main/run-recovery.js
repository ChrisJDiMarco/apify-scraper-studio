// Scraper runs the studio lost track of. A run can fail on the studio's side (the connection dropped while it waited,
// the rows couldn't be downloaded, the app restarted) while the run itself carries on, or has finished, at Apify. Starting
// the scraper again would pay for the same collection twice, so such a run is marked resumable and the next Run picks
// that same Apify run up: it waits for it if it is still going and downloads what it collected. Electron-free.

// A run's saved status is Apify's own word for it while it is going (ready, running, timing-out, aborting), not only
// "running"; each of those is an unfinished run after a restart.
const UNFINISHED_RUN = new Set(['running', 'ready', 'timing-out', 'aborting']);
const RESUME_WITHIN_MS = 24 * 60 * 60 * 1000;
const RUN_ID = /^[a-zA-Z0-9_-]{1,100}$/;

// The scraper's newest run, when it failed with its Apify run still to collect from, within the last day. Only the
// newest counts: once a later run exists, an older lost one is history.
function resumableRun(runs, recipeId, now = Date.now()) {
  const newest = (Array.isArray(runs) ? runs : []).filter((run) => run && run.recipeId === recipeId).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
  if (!newest || newest.resumable !== true || newest.status !== 'failed' || !RUN_ID.test(String(newest.apifyRunId || ''))) return null;
  return now - (Date.parse(newest.finishedAt || newest.startedAt || '') || 0) <= RESUME_WITHIN_MS ? newest : null;
}

// Whether a run that just failed should be picked up by the next Run: Apify started it, Apify didn't say the run is
// gone, and this attempt wasn't itself a pick-up (a pick-up that fails again starts fresh next time, so a run that can
// never be collected doesn't block the scraper for a day).
function resumableAfterFailure(run, error) {
  return Boolean(run) && RUN_ID.test(String(run.apifyRunId || '')) && !run.resumedFrom && !/could not be found/i.test(String(error?.message || ''));
}

module.exports = { UNFINISHED_RUN, resumableRun, resumableAfterFailure };
