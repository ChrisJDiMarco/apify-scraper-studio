import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
import researchWorkbook from '../src/shared/research-workbook.js';
import storeModule from '../src/main/workbooks.js';
import fixture from './helpers/research-ai-fixture.js';
const { createContentWorkspace } = workspaceModule;
const { buildResearchWorkbook, RESEARCH_SHEETS } = researchWorkbook;
const { createWorkbookStore, sheetFromRows } = storeModule;

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); roots.push(dir); return dir; };

// Collected rows the way the studio host stores them: normalized fields plus the provider's raw record.
const collected = [
  { id: 'run1:1', runId: 'run1', externalId: '1', platform: 'x', author: 'aleyda', type: 'post', text: 'AI Overviews are eating branded clicks and our reporting cannot show it.', url: 'https://x.com/aleyda/status/1', publishedAt: '2026-09-22T12:00:00Z', raw: { createdAt: 'Tue Sep 22 12:00:00 +0000 2026', likeCount: 100, retweetCount: 10, replyCount: 20, quoteCount: 3, viewCount: 1000, bookmarkCount: 5, isReply: false, isRetweet: false, isQuote: true } },
  { id: 'run1:2', runId: 'run1', externalId: '2', platform: 'x', author: 'lily', type: 'post', text: 'Reporting AI visibility to clients is pure manual work right now.', url: 'https://x.com/lily/status/2', publishedAt: '2026-09-23T12:00:00Z', raw: { likeCount: 4, retweetCount: 0, replyCount: 1, quoteCount: 0, viewCount: 90, bookmarkCount: 0 } },
  { id: 'run2:3', runId: 'run2', externalId: '3', platform: 'linkedin', author: 'Eli Schwartz', type: 'post', text: 'Stop treating an inability to measure AI search as a reason to wait.', url: 'https://www.linkedin.com/posts/schwartze_stop-3', publishedAt: '2026-09-24T12:00:00Z', raw: { content: 'Stop treating an inability to measure AI search as a reason to wait.', author: { name: 'Eli Schwartz', publicIdentifier: 'schwartze', info: 'Author of Product-Led SEO', linkedinUrl: 'https://www.linkedin.com/in/schwartze?miniProfileUrn=abc' }, postedAt: { date: '2026-09-24T12:00:00.000Z' }, engagement: { likes: 40, comments: 9 } } },
  { id: 'run3:4', runId: 'run3', externalId: '4', platform: 'reddit', author: 'skrincher', type: 'post', text: 'SMS welcome flow made $4.48 per message Same pop-up, two welcome flows and the reporting is manual.', url: 'https://www.reddit.com/r/ecommerce/comments/4', publishedAt: '2026-09-25T12:00:00Z', raw: { title: 'SMS welcome flow made $4.48 per message', body: 'Same pop-up, two welcome flows and the reporting is manual.', communityName: 'r/ecommerce', dataType: 'post', numberOfComments: 2, upVotes: 2, upVoteRatio: 1, createdAt: '2026-09-25T12:00:00.000Z' } },
].map((row) => ({ ...row, metrics: row.platform === 'x' ? { likes: row.raw.likeCount, comments: row.raw.replyCount, shares: row.raw.retweetCount, views: row.raw.viewCount, quotes: row.raw.quoteCount, bookmarks: row.raw.bookmarkCount } : row.platform === 'linkedin' ? { likes: 40, comments: 9, shares: 0 } : { upvotes: 2, comments: 2, upvoteRatio: 1 } }));

function outputFor(request) {
  const props = request.schema.properties;
  const research = fixture.researchOutput(request, { candidateName: 'AI visibility reporting gap', offTopicEvery: 2, theme: { name: 'Generative Visibility Replaces Blue-Link Rankings', description: 'Practitioners measure visibility in AI answers, not rankings.', matchingKeywords: ['GEO', 'AI Overviews'], taxonomyCategory: 'AI Search / GEO / AIO' } });
  if (research && fixture.stageOf(request) === 'synthesis') research.themes[0] = { ...research.themes[0], matchingCriteria: 'Posts about optimizing for AI engines.', negativeCriteria: 'Exclude pure keyword tracking.', novelty: 'NEW ANGLE' };
  if (research && fixture.stageOf(request) === 'tagging') research.assignments = research.assignments.map((row) => ({ ...row, painPoint: 'Proving ROI/Attribution', entities: { tools: ['Google Search Console'], people: [], companies: ['Google'] } }));
  if (research) return research;
  const sectionIds = props.sections.items.properties.id.enum;
  const descriptor = content.CONTENT_DELIVERABLES.find((d) => d.kind === 'text' && JSON.stringify(d.sections.map((s) => s.id)) === JSON.stringify(sectionIds));
  const input = JSON.parse(request.prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1]);
  const evidenceId = input.source.evidence[1]?.id || input.source.evidence[0].id;
  const result = { title: 'Evidence', summary: 'A sampled observation.', sections: descriptor.sections.map((section) => ({ id: section.id, heading: section.heading, body: 'This is a sampled observation. Validate the next step with an editor.', items: Array.from({ length: section.minItems || 0 }, (_, i) => ({ label: `Action ${i + 1}`, text: 'Review it.', evidenceIds: [evidenceId], productIds: [] })), evidenceIds: [evidenceId], productIds: [] })), caveats: ['The sample does not establish market prevalence. No approved product registry or verified quotation set was supplied.'] };
  if (descriptor.id === 'evidence-report') result.quotes = [];
  return result;
}
function harness() {
  const root = tempDir('sheets-studio-');
  const api = createContentWorkspace({
    root, runAI: async (request) => ({ output: outputFor(request), receipt: { costUsd: 0.001, provider: 'fixture', paid: false } }), cancelProvider: vi.fn(),
    getDatasets: () => [{ id: 'dataset-a', name: 'Golden Thread sources', platform: 'mixed', itemCount: collected.length }],
    readDataset: async () => ({ items: collected }),
  });
  return { api, root };
}
const program = { id: 'program-a', name: 'Semrush social trends', sourceGroups: [{ platform: 'x', targets: ['aleyda'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 }, thresholds: { discovery: { x: 0, linkedin: 0, reddit: 0 }, tagging: { x: 0, linkedin: 0, reddit: 0 } } };
const sheet = (workbook, name) => workbook.sheets.find((entry) => entry.name === name);
const column = (entry, label) => entry.columns.indexOf(label);

describe('research run as a Golden Thread workbook', () => {
  it('opens a discovered run with the same tabs and headers as the Google Sheet', async () => {
    const { api } = harness();
    api.saveResearchProgram(program);
    const run = api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] }); await api.waitForIdle();
    expect(api.listResearchWorkbookSources()).toEqual([expect.objectContaining({ runId: run.id, title: 'Semrush social trends', status: 'awaiting-review', evidenceCount: 4, themeCount: 1 })]);
    const workbook = buildResearchWorkbook(await api.readResearchWorkbookSource({ runId: run.id }));
    expect(workbook.sheets.map((entry) => entry.name)).toEqual(['Theme Repository', 'Twitter', 'Reddit', 'LinkedIn', 'Theme Summary Data', 'Post Counts Reference', 'Trend Velocity', 'Taxonomy Lookup', 'Batch Analysis Log']);
    expect(sheet(workbook, 'Twitter').columns).toEqual(RESEARCH_SHEETS.x.columns);

    const themes = sheet(workbook, 'Theme Repository');
    expect(themes.rows[0].slice(0, 7)).toEqual(['Generative Visibility Replaces Blue-Link Rankings', 'Practitioners measure visibility in AI answers, not rankings.', '["GEO","AI Overviews"]', 'Posts about optimizing for AI engines.', 'Exclude pure keyword tracking.', 'NEW ANGLE', 'Needs your OK']);

    // Raw provider fields come through in the n8n column layout.
    const twitter = sheet(workbook, 'Twitter'); const first = twitter.rows.find((row) => row[0] === 'https://x.com/aleyda/status/1');
    expect(first.slice(0, 13)).toEqual(['https://x.com/aleyda/status/1', 'AI Overviews are eating branded clicks and our reporting cannot show it.', 'aleyda', 'Tue Sep 22 12:00:00 +0000 2026', '10', '20', '100', '3', '1000', '5', 'FALSE', 'FALSE', 'TRUE']);
    expect(Number(first[column(twitter, 'prevalence_score')])).toBeGreaterThan(0);
    const linkedin = sheet(workbook, 'LinkedIn').rows[0];
    expect(linkedin.slice(5, 10)).toEqual(['schwartze', 'Author of Product-Led SEO', 'Eli', 'Schwartz', 'https://www.linkedin.com/in/schwartze']);
    const reddit = sheet(workbook, 'Reddit').rows[0];
    expect(reddit.slice(1, 9)).toEqual(['Same pop-up, two welcome flows and the reporting is manual.', 'r/ecommerce', 'skrincher', 'post', 'SMS welcome flow made $4.48 per message', '2', '2', '1']);

    // Before tagging the totals explain how to fill in, instead of showing an empty grid.
    expect(sheet(workbook, 'Theme Summary Data').empty.title).toMatch(/after tagging/);
    const batches = sheet(workbook, 'Batch Analysis Log');
    expect(batches.rows[0][column(batches, 'status')]).toBe('Analyzed');
    expect(JSON.parse(batches.rows[0][0]).candidates[0].name).toBe('AI visibility reporting gap');
    expect(JSON.parse(batches.rows[0][column(batches, 'platform_breakdown')]).Twitter.total_posts).toBe(2);
  });

  it('fills theme tags, summary totals and velocity once the run is classified', async () => {
    const { api } = harness();
    api.saveResearchProgram(program);
    const started = api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] }); await api.waitForIdle();
    const run = api.readStudioRun({ runId: started.id });
    api.approveResearchThemes({ runId: run.id, themes: run.themes.map((theme) => theme.id) }); api.continueResearchRun({ runId: run.id }); await api.waitForIdle();
    const workbook = buildResearchWorkbook(await api.readResearchWorkbookSource({ runId: run.id }));

    const twitter = sheet(workbook, 'Twitter');
    const tagged = twitter.rows.filter((row) => row[column(twitter, 'Theme')] === 'Generative Visibility Replaces Blue-Link Rankings');
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged[0][column(twitter, 'Entities_Tools')]).toBe('Google Search Console');
    expect(tagged[0][column(twitter, 'Pain_Point_Type')]).toBe('Proving ROI/Attribution');

    const summary = sheet(workbook, 'Theme Summary Data'); const row = summary.rows[0];
    const value = (label) => Number(row[column(summary, label)]);
    expect(row[0]).toBe('Generative Visibility Replaces Blue-Link Rankings');
    expect(value('Overall Prevalence Score')).toBeCloseTo(value('X Prevalence Score') + value('LI Prevalence Score') + value('Reddit Prevalence Score'), 2);
    expect(value('Weighted Prevalence Score')).toBe(100);
    const counts = sheet(workbook, 'Post Counts Reference');
    expect(counts.rows[0].slice(1).map(Number).reduce((a, b) => a + b, 0)).toBe(value('X Post Count') + value('LI Post Count') + value('Reddit Post Count'));

    const velocity = sheet(workbook, 'Trend Velocity');
    expect(velocity.rows[0][column(velocity, 'Novelty')]).toBe('NEW ANGLE');
    expect(velocity.rows[0][column(velocity, 'Taxonomy Category')]).toBe('AI Search / GEO / AIO');
    expect(Number(velocity.rows[0][column(velocity, 'Count')])).toBeGreaterThan(0);
  }, 30000); // a research run through classification; slow when the suite runs in parallel.

  it('never reads runs from another workspace', async () => {
    const { api } = harness();
    api.saveResearchProgram(program);
    const run = api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] }); await api.waitForIdle();
    api.selectContentWorkspace('semrush');
    expect(api.listResearchWorkbookSources()).toEqual([]);
    await expect(api.readResearchWorkbookSource({ runId: run.id })).rejects.toThrow(/workspace/);
  });

  // Skip on the Trend board reads 'Skipped' everywhere else (board, Home, Inbox, Trend tracker); the run workbook said 'Passed'.
  it('labels a skipped trend Skipped and an undecided one Needs your OK in Theme Repository', async () => {
    const { api } = harness();
    api.saveResearchProgram(program);
    const run = api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] }); await api.waitForIdle();
    const statusOf = async () => { const themes = sheet(buildResearchWorkbook(await api.readResearchWorkbookSource({ runId: run.id })), 'Theme Repository'); return themes.rows[0][column(themes, 'Status')]; };
    expect(await statusOf()).toBe('Needs your OK');
    const themeId = (await api.readResearchWorkbookSource({ runId: run.id })).run.discoveredThemes[0].id;
    api.decideResearchTheme({ runId: run.id, themeId, decision: 'passed' });
    expect(await statusOf()).toBe('Skipped');
    api.decideResearchTheme({ runId: run.id, themeId, decision: 'approved' });
    expect(await statusOf()).toBe('Approved');
  });
});

describe('workbook store', () => {
  function store(overrides = {}) {
    const sources = [{ runId: 'research-1', title: 'Weekly trends', status: 'succeeded', stage: 'reports', createdAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:30:00Z', evidenceCount: 1, themeCount: 0, version: 'v1' }];
    const workspace = { activeWorkspaceId: () => 'general', listResearchWorkbookSources: vi.fn(() => sources), readResearchWorkbookSource: vi.fn(async () => ({ run: { id: 'research-1', title: 'Weekly trends', status: 'succeeded' }, evidence: [{ id: 'evidence-1', platform: 'x', author: 'a', text: 'post', url: 'https://x.com/a/1', publishedAt: '2026-09-27T00:00:00Z', metrics: { likes: 1 }, engagement: { value: 3.01 } }] })) };
    const root = tempDir('sheets-store-');
    return { root, workspace, sources, api: createWorkbookStore({ root, contentWorkspace: workspace, activeWorkspaceId: () => workspace.activeWorkspaceId(), ...overrides }) };
  }

  it('lists research runs and builds each workbook once per saved version', async () => {
    const { api, workspace, sources } = store();
    expect(api.list()).toEqual([expect.objectContaining({ id: 'research-1', kind: 'research', name: 'Weekly trends' })]);
    await api.read({ workbookId: 'research-1' }); await api.read({ workbookId: 'research-1' });
    expect(workspace.readResearchWorkbookSource).toHaveBeenCalledTimes(1);
    sources[0].version = 'v2'; await api.read({ workbookId: 'research-1' });
    expect(workspace.readResearchWorkbookSource).toHaveBeenCalledTimes(2);
    await expect(api.read({ workbookId: 'research-elsewhere' })).rejects.toThrow(/not in the selected workspace/);
    await expect(api.read({ workbookId: '../escape' })).rejects.toThrow(/Choose a workbook/);
  });

  it('imports a spreadsheet, keys rows by post_url, and keeps reviewer edits across a re-import', async () => {
    const { api, root } = store();
    const file = path.join(root, 'Golden Thread.csv');
    fs.writeFileSync(file, 'post_url,Theme,likeCount\nhttps://x.com/a/1,,4\nhttps://x.com/b/2,GEO,9\n');
    const meta = await api.importFile({ filePath: file });
    expect(meta).toEqual(expect.objectContaining({ kind: 'import', name: 'Golden Thread', sheets: [{ id: 'golden-thread', name: 'Golden Thread', rowCount: 2, columnCount: 3 }] }));
    const workbook = await api.read({ workbookId: meta.id });
    expect(workbook.sheets[0].rowKeys).toEqual(['k:https://x.com/a/1', 'k:https://x.com/b/2']);
    api.saveEdits({ workbookId: meta.id, edits: { version: 1, sheets: { 'golden-thread': { 'k:https://x.com/a/1': { Theme: 'AI Overviews' } } } } });
    fs.writeFileSync(file, 'post_url,Theme,likeCount\nhttps://x.com/b/2,GEO,9\nhttps://x.com/a/1,,5\n');
    await api.importFile({ filePath: file, workbookId: meta.id });
    const updated = await api.read({ workbookId: meta.id });
    expect(updated.edits.sheets['golden-thread']['k:https://x.com/a/1'].Theme).toBe('AI Overviews');
    expect(updated.sheets[0].rows[1]).toEqual(['https://x.com/a/1', '', '5']);
    expect(api.list().map((entry) => entry.kind)).toEqual(expect.arrayContaining(['research', 'import']));
  });

  // Replace with a newer file… on a sheet with no unique ID column: rows are keyed by position, and the old edit used to stay
  // on its row number, so a row added above put the note on a different post.
  it('moves position-keyed edits with their rows when a newer file adds or re-sorts rows', async () => {
    const { api, root } = store();
    const file = path.join(root, 'posts.csv');
    const editedNote = (workbook, name) => { const sheetOf = workbook.sheets[0]; const index = sheetOf.rows.findIndex((row) => row[0] === name); return workbook.edits.sheets[sheetOf.id]?.[sheetOf.rowKeys[index]]?.notes; };
    fs.writeFileSync(file, 'name,notes\nAlpha,a\nBravo,b\nCharlie,c\n');
    const meta = await api.importFile({ filePath: file });
    expect((await api.read({ workbookId: meta.id })).sheets[0].rowKeys).toEqual(['r2', 'r3', 'r4']);
    api.saveEdits({ workbookId: meta.id, changes: [{ sheetId: 'posts', rowKey: 'r3', columnKey: 'notes', value: 'BRAVO NOTE', base: null }] });

    fs.writeFileSync(file, 'name,notes\nZulu,z\nCharlie,c\nAlpha,a\nBravo,b\n');
    const replaced = await api.importFile({ filePath: file, workbookId: meta.id });
    expect(replaced.warnings).toEqual([]);
    let workbook = await api.read({ workbookId: meta.id });
    expect(editedNote(workbook, 'Bravo')).toBe('BRAVO NOTE');
    expect(['Zulu', 'Charlie', 'Alpha'].map((name) => editedNote(workbook, name))).toEqual([undefined, undefined, undefined]);
    expect(workbook.edits.sheets).toEqual({ posts: { r5: { notes: 'BRAVO NOTE' } } });

    // A CSV's tab is named after its file, so "posts (2).csv" is a new tab id; its one tab still carries the edits.
    const renamed = path.join(root, 'posts (2).csv');
    fs.writeFileSync(renamed, 'name,notes\nBravo,b\nZulu,z\nCharlie,c\nAlpha,a\n');
    await api.importFile({ filePath: renamed, workbookId: meta.id });
    workbook = await api.read({ workbookId: meta.id });
    expect(workbook.sheets[0].id).toBe('posts-2');
    expect(editedNote(workbook, 'Bravo')).toBe('BRAVO NOTE');

    // When the edited row itself changed in the new file, the edit is cleared and the person is told, not left on another post.
    fs.writeFileSync(renamed, 'name,notes\nZulu,z\nBravo,b (updated)\nCharlie,c\nAlpha,a\n');
    const changed = await api.importFile({ filePath: renamed, workbookId: meta.id });
    expect(changed.warnings).toEqual(['1 edited cell was cleared because its row or column changed in the new file.']);
    workbook = await api.read({ workbookId: meta.id });
    expect(workbook.edits.sheets).toEqual({});
  });

  it('pairs repeated identical rows in order and clears edits whose column is gone', async () => {
    const { api, root } = store();
    const file = path.join(root, 'notes.csv');
    fs.writeFileSync(file, 'Note,Owner\nsame,\nsame,\nother,\n');
    const meta = await api.importFile({ filePath: file });
    api.saveEdits({ workbookId: meta.id, changes: [{ sheetId: 'notes', rowKey: 'r3', columnKey: 'Owner', value: 'Sam', base: null }, { sheetId: 'notes', rowKey: 'r4', columnKey: 'Owner', value: 'Riley', base: null }] });
    fs.writeFileSync(file, 'Note,Owner\nnew,\nsame,\nsame,\nother,\n');
    expect((await api.importFile({ filePath: file, workbookId: meta.id })).warnings).toEqual([]);
    expect((await api.read({ workbookId: meta.id })).edits.sheets).toEqual({ notes: { r4: { Owner: 'Sam' }, r5: { Owner: 'Riley' } } });
    // The Owner column is gone from the newest file: both edits are cleared and counted.
    fs.writeFileSync(file, 'Note\nnew\nsame\nsame\nother\n');
    expect((await api.importFile({ filePath: file, workbookId: meta.id })).warnings).toEqual(['2 edited cells were cleared because their rows or columns changed in the new file.']);
    expect((await api.read({ workbookId: meta.id })).edits.sheets).toEqual({});
  });

  it('validates edits before saving them', () => {
    const { api } = store();
    expect(() => api.saveEdits({ workbookId: 'research-1', edits: { sheets: { x: { row: { A: 5 } } } } })).toThrow(/50,000 characters/);
    expect(() => api.saveEdits({ workbookId: 'research-1', edits: [] })).toThrow(/grouped by sheet/);
    expect(api.saveEdits({ workbookId: 'research-1', edits: { sheets: { x: { 'evidence-1': { Theme: 'GEO' } } } } })).toEqual(expect.objectContaining({ workbookId: 'research-1' }));
  });

  // Two editors on one shared sheet (fortify D4): each save writes only the cells that person changed.
  it('merges two people’s whole-sheet saves cell by cell instead of the last one replacing the file', async () => {
    let who = { id: 'member-sam', name: 'Sam' };
    const { api } = store({ caller: () => who });
    const as = async (person, work) => { who = person; return work(); };
    const sam = { id: 'member-sam', name: 'Sam' }; const riley = { id: 'member-riley', name: 'Riley' };
    await as(sam, () => api.read({ workbookId: 'research-1' }));
    await as(riley, () => api.read({ workbookId: 'research-1' })); // Riley's page loaded before Sam saved anything
    await as(sam, () => api.saveEdits({ workbookId: 'research-1', edits: { version: 1, sheets: { themes: { r3: { Owner: 'Sam' } } } } }));
    await as(riley, () => api.saveEdits({ workbookId: 'research-1', edits: { version: 1, sheets: { themes: { r7: { Owner: 'Riley' } } } } }));
    expect((await as(sam, () => api.read({ workbookId: 'research-1' }))).edits.sheets).toEqual({ themes: { r3: { Owner: 'Sam' }, r7: { Owner: 'Riley' } } });
    // Riley edits the cell Sam already changed: Sam's value stays, Riley is told who changed it, and her other cell saves.
    await expect(as(riley, () => api.saveEdits({ workbookId: 'research-1', edits: { version: 1, sheets: { themes: { r3: { Owner: 'Riley' }, r7: { Owner: 'Riley' }, r9: { Owner: 'Riley' } } } } }))).rejects.toMatchObject({ status: 409, code: 'sheetConflict', message: expect.stringMatching(/^Sam changed 1 cell you edited, so their value was kept\. Reopen the sheet/) });
    const after = (await as(sam, () => api.read({ workbookId: 'research-1' }))).edits;
    expect(after.sheets).toEqual({ themes: { r3: { Owner: 'Sam' }, r7: { Owner: 'Riley' }, r9: { Owner: 'Riley' } } });
    expect(after.meta).toBeUndefined(); // who changed each cell stays on the server
    // Sam clears his own cell (a cell missing from his snapshot): only that cell goes. An older page can't clear Riley's
    // cells that way (it may simply have missed a refresh); it is told, and her cell stays.
    await as(sam, () => api.saveEdits({ workbookId: 'research-1', edits: { version: 1, sheets: { themes: { r7: { Owner: 'Riley' }, r9: { Owner: 'Riley' } } } } }));
    expect((await as(riley, () => api.read({ workbookId: 'research-1' }))).edits.sheets).toEqual({ themes: { r7: { Owner: 'Riley' }, r9: { Owner: 'Riley' } } });
    await as(sam, () => api.read({ workbookId: 'research-1' }));
    await expect(as(sam, () => api.saveEdits({ workbookId: 'research-1', edits: { version: 1, sheets: { themes: { r7: { Owner: 'Riley' } } } } }))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Riley changed 1 cell you edited/) });
    expect((await as(riley, () => api.read({ workbookId: 'research-1' }))).edits.sheets.themes.r9).toEqual({ Owner: 'Riley' });
  });

  it('applies cell changes against the value each page saw and returns conflicts as data', async () => {
    let who = { id: 'member-sam', name: 'Sam' };
    const { api } = store({ caller: () => who });
    const first = api.saveEdits({ workbookId: 'research-1', changes: [{ sheetId: 'themes', rowKey: 'r1', columnKey: 'Owner', value: 'Sam', base: null }] });
    expect(first).toMatchObject({ workbookId: 'research-1', conflicts: [], edits: { version: 1, sheets: { themes: { r1: { Owner: 'Sam' } } } } });
    who = { id: 'member-riley', name: 'Riley' };
    const second = api.saveEdits({ workbookId: 'research-1', changes: [{ sheetId: 'themes', rowKey: 'r1', columnKey: 'Owner', value: 'Riley', base: null }, { sheetId: 'themes', rowKey: 'r2', columnKey: 'Owner', value: 'Riley', base: null }] });
    expect(second.conflicts).toEqual([{ sheetId: 'themes', rowKey: 'r1', columnKey: 'Owner', stored: 'Sam', by: 'Sam' }]);
    expect(second.edits.sheets).toEqual({ themes: { r1: { Owner: 'Sam' }, r2: { Owner: 'Riley' } } });
    // A revert (value null) against the right base removes the cell; a snapshot with its own base works the same way.
    expect(api.saveEdits({ workbookId: 'research-1', changes: [{ sheetId: 'themes', rowKey: 'r2', columnKey: 'Owner', value: null, base: 'Riley' }] }).edits.sheets).toEqual({ themes: { r1: { Owner: 'Sam' } } });
    expect(api.saveEdits({ workbookId: 'research-1', base: { sheets: { themes: { r1: { Owner: 'Sam' } } } }, edits: { sheets: { themes: { r1: { Owner: 'Sam' }, r4: { Note: 'x' } } } } }).edits.sheets).toEqual({ themes: { r1: { Owner: 'Sam' }, r4: { Note: 'x' } } });
    expect(() => api.saveEdits({ workbookId: 'research-1', changes: [{ sheetId: 'themes', rowKey: 'r1' }] })).toThrow(/sheet, row and column/);
  });

  it('pulls Google Sheets tabs through the bridge in the workbook’s own order', async () => {
    const readGoogleTabs = vi.fn(async () => ({ title: 'Internal NEW - Golden Thread Data Sheet', order: ['Theme Repository', 'Twitter'], tabs: { Twitter: [{ post_url: 'https://x.com/a/1', likeCount: 3, isQuote: true }], 'Theme Repository': [{ Theme: 'GEO', Novelty: 'NEW ANGLE' }], Empty: [] } }));
    const { api } = store({ readGoogleTabs });
    await expect(api.pullGoogleSheet({ spreadsheetUrl: 'https://example.com/sheet' })).rejects.toThrow(/full Google Sheets link/);
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/1FixtureSheetIdForTests_0123456789abcdefABCD/edit';
    const meta = await api.pullGoogleSheet({ spreadsheetUrl: sheetUrl });
    expect(readGoogleTabs).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetUrl: sheetUrl })); // the link the person pasted is the one read
    expect(meta.name).toBe('Internal NEW - Golden Thread Data Sheet');
    expect(meta.sheets.map((entry) => entry.name)).toEqual(['Theme Repository', 'Twitter']);
    const workbook = await api.read({ workbookId: meta.id });
    expect(workbook.sheets[1]).toEqual(expect.objectContaining({ columns: ['post_url', 'likeCount', 'isQuote'], rows: [['https://x.com/a/1', '3', 'TRUE']] }));
    expect(readGoogleTabs).toHaveBeenCalledWith(expect.objectContaining({ tabs: expect.arrayContaining(['Theme Repository', 'Twitter', 'Trend Velocity']) }));
  });

  it('renames and removes only imported workbooks', async () => {
    const { api, root } = store();
    const file = path.join(root, 'notes.csv'); fs.writeFileSync(file, 'a\n1\n');
    const meta = await api.importFile({ filePath: file });
    expect(api.rename({ workbookId: meta.id, name: '  Pilot notes ' }).name).toBe('Pilot notes');
    expect(() => api.rename({ workbookId: 'research-1', name: 'x' })).toThrow(/Only imported/);
    expect(() => api.remove({ workbookId: 'research-1' })).toThrow(/Only imported/);
    api.remove({ workbookId: meta.id });
    expect(api.list().some((entry) => entry.id === meta.id)).toBe(false);
  });

  it('keys rows by position when no column is a stable identifier', () => {
    expect(sheetFromRows('Notes', [['Note'], ['same'], ['same']], new Set()).rowKeys).toEqual(['r2', 'r3']);
  });
});

describe('first launch edition', () => {
  it('opens a fresh install in the packaged edition and never overrides a saved choice', () => {
    const root = tempDir('edition-');
    const deps = { root, runAI: async () => ({}), cancelProvider: vi.fn() };
    expect(createContentWorkspace({ ...deps, defaultWorkspaceId: 'semrush' }).publicState().activeWorkspaceId).toBe('semrush');
    const existing = tempDir('edition-saved-');
    createContentWorkspace({ ...deps, root: existing, defaultWorkspaceId: 'semrush' }).selectContentWorkspace('general');
    expect(createContentWorkspace({ ...deps, root: existing, defaultWorkspaceId: 'semrush' }).publicState().activeWorkspaceId).toBe('general');
    expect(createContentWorkspace({ ...deps, root: tempDir('edition-bad-'), defaultWorkspaceId: 'nope' }).publicState().activeWorkspaceId).toBe('general');
  });
});
