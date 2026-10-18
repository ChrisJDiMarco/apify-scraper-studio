import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
import kit from '../src/shared/asset-kit.js';
import workspace from '../src/shared/workspace.js';
import validation from '../src/shared/validation.js';

// Files the studio writes for people to open on Windows: CSVs Excel reads as UTF-8, exports beside a file Excel has open,
// asset kit folders Explorer can open (paths under 260 characters), names that aren't Windows device names, no console
// window for git, and the setup export in Downloads.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const source = fs.readFileSync(mainPath, 'utf8');
const roots = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const temp = (prefix) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); roots.push(root); return root; };
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const busy = (file) => Object.assign(new Error(`EBUSY: resource busy or locked, open '${file}'`), { code: 'EBUSY' });

// The desktop main process (src/main/index.js) with Electron replaced; `platform` is what index.js sees as process.platform.
function desktop(root, { platform = 'darwin', fsModule, saveTo } = {}) {
  const handlers = new Map(); const downloads = path.join(root, 'Downloads'); fs.mkdirSync(downloads, { recursive: true });
  const app = Object.assign(new EventEmitter(), { getPath: (name) => (name === 'downloads' ? downloads : root), whenReady: () => ({ then() {} }), getVersion: () => 'test' });
  const dialog = { showErrorBox() {}, showSaveDialog: async () => ({ canceled: false, filePath: saveTo }) };
  vm.runInNewContext(source, {
    require: (name) => {
      if (name === 'electron') return { app, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, safeStorage: { isEncryptionAvailable: () => false }, dialog, shell: { showItemInFolder() {} } };
      if (name === 'electron-updater') return {};
      if (name === 'child_process') return { spawn: () => { throw new Error('No processes in this test.'); } };
      if (name === 'fs' && fsModule) return fsModule;
      return mainRequire(name);
    },
    process: { pid: process.pid, platform, env: { STUDIO_DISABLE_LOCAL_ENV: '1' }, argv: [] },
    __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setImmediate,
  }, { filename: mainPath });
  return { call: (channel, payload) => handlers.get(channel)(null, payload), close: () => { app.emit('before-quit'); app.emit('quit'); } };
}
// A studio with one collected dataset whose posts have accents, curly quotes and an emoji.
function withDataset(prefix) {
  const root = temp(prefix);
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ datasets: [{ id: 'dataset-1', name: 'Café posts', platform: 'x', itemCount: 1, createdAt: '2026-10-18T09:00:00Z' }] }));
  fs.mkdirSync(path.join(root, 'datasets'));
  fs.writeFileSync(path.join(root, 'datasets', 'dataset-1.json'), JSON.stringify({ items: [{ id: 'post-1', text: 'Riley’s café take 🚀', url: 'https://x.com/riley/status/1', author: 'Riley' }] }));
  return root;
}

describe('dataset exports', () => {
  it('start a CSV with a UTF-8 byte-order mark so Excel shows accents and emoji; JSONL stays plain', () => {
    const root = withDataset('win-export-bom-'); const app = desktop(root);
    try {
      const csv = app.call('export-dataset', { datasetId: 'dataset-1', format: 'csv', reveal: false });
      expect(path.basename(csv.filePath)).toBe('Caf-posts.csv');
      const bytes = fs.readFileSync(csv.filePath);
      expect(bytes.subarray(0, 3)).toEqual(BOM);
      expect(bytes.subarray(3).toString('utf8')).toContain('Riley’s café take 🚀');
      const jsonl = app.call('export-dataset', { datasetId: 'dataset-1', format: 'jsonl', reveal: false });
      expect(fs.readFileSync(jsonl.filePath).subarray(0, 1).toString()).toBe('{');
    } finally { app.close(); }
  });

  it('on Windows, go to "<name> (2).csv" when the last export is still open in Excel; on the Mac the error stands', () => {
    const root = withDataset('win-export-busy-'); const locked = path.join(root, 'exports', 'Caf-posts.csv');
    fs.mkdirSync(path.dirname(locked), { recursive: true }); fs.writeFileSync(locked, 'open in Excel');
    const fsModule = { ...fs, writeFileSync: (file, ...rest) => { if (String(file) === locked) throw busy(file); return fs.writeFileSync(file, ...rest); } };
    const windows = desktop(root, { platform: 'win32', fsModule });
    try {
      const result = windows.call('export-dataset', { datasetId: 'dataset-1', format: 'csv', reveal: false });
      expect(result.filePath).toBe(path.join(root, 'exports', 'Caf-posts (2).csv'));
      expect(fs.readFileSync(result.filePath).subarray(0, 3)).toEqual(BOM);
      expect(fs.readFileSync(locked, 'utf8')).toBe('open in Excel');
    } finally { windows.close(); }
    const mac = desktop(withDataset('win-export-mac-'), { fsModule: { ...fs, writeFileSync: (file, ...rest) => { if (String(file).endsWith('Caf-posts.csv')) throw busy(file); return fs.writeFileSync(file, ...rest); } } });
    try { expect(() => mac.call('export-dataset', { datasetId: 'dataset-1', format: 'csv', reveal: false })).toThrow('EBUSY'); } finally { mac.close(); }
  });
});

describe('workbook downloads', () => {
  const workbook = { name: 'Posts', sheets: [{ name: 'Sheet1', columns: ['author'], rows: [['Sam']] }] };
  it('on Windows, ask to close the workbook in Excel when saving over it fails', async () => {
    const root = temp('win-xlsx-'); const target = path.join(root, 'Downloads', 'Posts.xlsx');
    const fsModule = { ...fs, writeFileSync: (file, ...rest) => { if (String(file) === target) throw busy(file); return fs.writeFileSync(file, ...rest); } };
    const windows = desktop(root, { platform: 'win32', fsModule, saveTo: target });
    try { await expect(windows.call('workbooks:export-xlsx', workbook)).rejects.toThrow('Close “Posts.xlsx” in Excel (or whatever app has it open) and try again.'); } finally { windows.close(); }
    const macTarget = path.join(temp('win-xlsx-mac-'), 'Posts.xlsx');
    const mac = desktop(path.dirname(macTarget), { fsModule: { ...fs, writeFileSync: (file, ...rest) => { if (String(file) === macTarget) throw busy(file); return fs.writeFileSync(file, ...rest); } }, saveTo: macTarget });
    try { await expect(mac.call('workbooks:export-xlsx', workbook)).rejects.toThrow('EBUSY'); } finally { mac.close(); }
  });

  it('saves normally when the file is free', async () => {
    const root = temp('win-xlsx-free-'); const target = path.join(root, 'Downloads', 'Posts.xlsx');
    const app = desktop(root, { platform: 'win32', saveTo: target });
    try { expect(await app.call('workbooks:export-xlsx', workbook)).toMatchObject({ fileName: 'Posts.xlsx', sheetCount: 1 }); expect(fs.existsSync(target)).toBe(true); } finally { app.close(); }
  });
});

describe('setup export', () => {
  it('suggests Downloads (not Documents, often synced to OneDrive) and says "this computer"', () => {
    const handler = source.slice(source.indexOf("handle('setup:export'"), source.indexOf("handle('setup:open'"));
    expect(handler).toContain("defaultPath: path.join(app.getPath('downloads'), fileName)");
    expect(handler).not.toContain("getPath('documents')");
    expect(handler).toContain('No Apify token is saved on this computer to include.');
  });
});

describe('file and folder names', () => {
  it('are never ".", "..", end in a dot, or a Windows device name', () => {
    const { safeFilename } = workspace;
    expect(safeFilename('..')).toBe('file'); expect(safeFilename('.')).toBe('file');
    expect(safeFilename('CON')).toBe('_CON'); expect(safeFilename('nul')).toBe('_nul'); expect(safeFilename('Aux')).toBe('_Aux');
    expect(safeFilename('con.txt')).toBe('_con.txt'); expect(safeFilename('COM1')).toBe('_COM1'); expect(safeFilename('lpt9.csv')).toBe('_lpt9.csv');
    expect(safeFilename('x.')).toBe('x'); expect(safeFilename('report...')).toBe('report'); expect(safeFilename('.hidden')).toBe('hidden');
    expect(safeFilename('console')).toBe('console'); expect(safeFilename('COM10')).toBe('COM10');
    expect(safeFilename(`${'a'.repeat(79)}.b`)).toBe('a'.repeat(79)); // cut to 80, then no trailing dot
    expect(safeFilename('bad/name with spaces')).toBe('bad-name-with-spaces'); expect(safeFilename('!!!')).toBe('file');
  });

  it('refuse "." and ".." as record IDs', () => {
    const { validateId } = validation;
    expect(() => validateId('..', 'Card ID')).toThrow('Card ID is invalid.');
    expect(() => validateId('.', 'Card ID')).toThrow('Card ID is invalid.');
    expect(validateId('card.1', 'Card ID')).toBe('card.1'); expect(validateId('dataset-1')).toBe('dataset-1');
  });

  it('keep asset Markdown inside the assets folder', () => {
    const fn = source.slice(source.indexOf('function assetMarkdownPath('), source.indexOf('function localAssetPath('));
    expect(fn).toContain("containedDataPath('assets', path.join(cardDir, `${fileName}.md`))");
  });

  it('cut long asset kit names before trimming, so none ends in a space or dot', () => {
    expect(kit.safeFileName(`${'Word '.repeat(35)}x`).length).toBeLessThanOrEqual(180);
    expect(kit.safeFileName(`${'a'.repeat(179)} tail`)).toBe('a'.repeat(179));
    expect(kit.safeFileName(`${'a'.repeat(179)}.tail`)).toBe('a'.repeat(179));
  });
});

describe('git in a new workspace folder', () => {
  it('starts without a console window on Windows', () => {
    const calls = []; vi.spyOn(childProcess, 'execFileSync').mockImplementation((...args) => { calls.push(args); return Buffer.alloc(0); });
    const root = temp('win-git-');
    expect(workspace.ensureWorkspace(root, 'project-1')).toBe(path.join(root, 'project-1'));
    expect(calls).toEqual([['git', ['init'], { cwd: path.join(root, 'project-1'), stdio: 'ignore', windowsHide: true }]]);
  });
});

// ---------- Asset kit folders on Windows ----------
// A finished trend (its report and editorial toolkit) to make a kit from, titled `title`; as in test/asset-kit.test.js.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
function kitStudio(title) {
  const root = temp('win-kit-'); const at = '2026-10-10T10:00:00.000Z';
  const space = (id, editionId) => ({ id, name: editionId === 'semrush' ? 'Semrush workspace' : 'Your workspace', editionId, knowledge: content.validateBrandKnowledge(editionId === 'semrush' ? content.SEMRUSH_KNOWLEDGE_PRESET : {}, { editionId }), products: [], createdAt: at, updatedAt: at });
  const asset = (id, deliverableId, assetTitle, channel) => ({ id, workspaceId: 'semrush', runId: 'content-trend', deliverableId, title: assetTitle, kind: 'text', channel, format: 'markdown', createdAt: at });
  const post = { id: 'post-1', text: 'We still cannot prove ROI from AI citations.', url: 'https://x.com/sam/status/1', platform: 'x', author: 'sam', publishedAt: '2026-10-01' };
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ version: 1, activeWorkspaceId: 'semrush', workspaces: [space('general', 'general'), space('semrush', 'semrush')], programs: [], researchRuns: [], contentRuns: [{ id: 'content-trend', workspaceId: 'semrush', type: 'content', title, researchRunId: 'research-1', themeId: 'theme-1', status: 'succeeded', stage: 'content', createdAt: at, maxBudgetUsd: 5, reservedUsd: 1, costUsd: 1, receipts: [], jobs: [{ id: 'evidence-report', status: 'succeeded' }, { id: 'editorial-toolkit', status: 'succeeded' }] }], themes: [], history: [], detections: [], assets: [asset('asset-report', 'evidence-report', `${title} — Comprehensive Trends Report`, 'Research'), asset('asset-toolkit', 'editorial-toolkit', `TREND: ${title}`, 'Strategy')], exports: [], datasetOwners: {} }));
  const dir = path.join(root, 'runs', 'content-trend'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify({ editionId: 'semrush', research: true, source: { id: 'theme-1', kind: 'research-theme', title, text: 'Theme evidence package.', evidence: [post], research: { themeId: 'theme-1' } } }));
  const doc = (docTitle, body, extra = {}) => ({ title: docTitle, summary: `${docTitle} summary.`, sections: [{ id: 'main', heading: 'What happened', body, items: [], evidenceIds: [], productIds: [] }], caveats: [], theme: { name: title }, ...extra });
  fs.writeFileSync(path.join(dir, 'asset-toolkit.json'), JSON.stringify(doc(`TREND: ${title}`, 'Toolkit: lead with the measurement gap.')));
  fs.writeFileSync(path.join(dir, 'asset-report.json'), JSON.stringify(doc(`${title} — Comprehensive Trends Report`, 'Report: practitioners cannot tie AI citations to revenue.', { evidenceRegister: [post] })));
  const brief = { headline: 'AI citations now decide which brands get seen', subtitle: 'What the data shows', callouts: [{ text: 'Teams cannot prove AI citation ROI', evidenceId: 'E1' }], visualIdea: 'A search result fading into an AI answer card.', symbols: ['answer card'], avoid: ['charts without data'] };
  const draft = (request) => {
    if (!request.schema.properties.sections) return brief;
    const context = JSON.parse(request.prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1].split('\n\nYOUR PREVIOUS RESPONSE')[0]);
    const ids = request.schema.properties.sections.items.properties.id.enum;
    const descriptor = content.CONTENT_DELIVERABLES.find((value) => value.kind === 'text' && JSON.stringify(value.sections.map((section) => section.id)) === JSON.stringify(ids));
    const cite = context.source.evidence[0].id;
    return { title: `${descriptor.label} draft`, summary: 'Fixture summary.', sections: descriptor.sections.map((section) => ({ id: section.id, heading: section.heading, body: 'Sourced fixture body.', items: Array.from({ length: section.minItems || 0 }, (_, i) => ({ label: `Item ${i + 1}`, text: 'Review it', evidenceIds: [cite], productIds: [] })), evidenceIds: [cite], productIds: [] })), caveats: ['Fixture only.'], ...(descriptor.id === 'pr' ? { journalists: [] } : {}) };
  };
  const api = workspaceModule.createContentWorkspace({ root, runAI: async (request) => ({ output: draft(request), receipt: { provider: 'fixture', costUsd: 0.05 } }), generateImage: async ({ deliverable }) => deliverable.variantPrompts.map((_, i) => ({ title: `${deliverable.label} · ${i + 1}`, png: Buffer.from(png), receipt: { provider: 'fixture', costUsd: 0.04 } })), capabilities: () => ({ aiProvider: 'auto' }), clock: () => new Date('2026-10-16T13:52:00.000Z') });
  return api;
}
async function finishedKit(title) {
  const api = kitStudio(title);
  // The longest Semrush labels: Search Engine Land's news update and its hero pictures, Exploding Topics, the blog.
  const run = api.createAssetKit({ source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['sel', 'sel-image', 'explodingtopics', 'blogshort'] });
  await api.waitForIdle();
  expect(api.readStudioRun({ runId: run.id }).status).toBe('succeeded');
  return { api, runId: run.id };
}
const everyPath = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const full = path.join(dir, entry.name); return entry.isDirectory() ? [full, ...everyPath(full)] : [full]; });
// 80 characters, the length at which every file of a Semrush kit in Downloads used to pass 260.
const LONG = 'How Answer Engines Quietly Rewrote Search Attribution For Enterprise Teams Today';

describe('asset kit folders on Windows', () => {
  it('fit an 80-character title so every path stays within 240 characters and no name ends in a dot or space', async () => {
    expect(LONG).toHaveLength(80);
    const { api, runId } = await finishedKit(LONG);
    const downloads = temp('win-kit-downloads-');
    const exported = api.exportAssetKit({ runId }, { into: downloads, platform: 'win32' });
    const paths = everyPath(exported.path);
    expect(paths.filter((file) => !fs.statSync(file).isDirectory()).length).toBeGreaterThanOrEqual(8);
    // On Windows the same folder sits in a user's Downloads; the separators are one character either way.
    const windowsRoot = 'C:\\Users\\alex.riley-jordan\\Downloads';
    for (const file of [exported.path, ...paths]) {
      expect(file.length, file).toBeLessThanOrEqual(240);
      expect(path.win32.join(windowsRoot, ...path.relative(downloads, file).split(path.sep)).length, file).toBeLessThanOrEqual(240);
      for (const name of path.relative(downloads, file).split(path.sep)) expect(name, file).not.toMatch(/[. ]$/);
    }
    // The title is cut at a word and marked, in the folder and the file names; labels and dates stay whole.
    expect(path.basename(exported.path)).toMatch(/^Golden Thread — How Answer.*… \(2026-10-16\)$/);
    expect(exported.folderName).toBe(path.basename(exported.path));
    const sel = fs.readdirSync(path.join(exported.path, 'Search Engine Land - MarTech'));
    expect(sel.some((name) => name.startsWith('Search Engine Land — News Update + Video Script — ') && name.endsWith(' (2026-10-16).md'))).toBe(true);
    expect(fs.readdirSync(exported.path).some((name) => /^Source — How .*…\.md$/.test(name))).toBe(true);
  });

  it('leave names exactly as they were on the Mac, and on Windows when they already fit', async () => {
    const { api, runId } = await finishedKit(LONG);
    for (const platform of ['darwin', undefined]) {
      const mac = api.exportAssetKit({ runId }, { into: temp('win-kit-mac-'), platform });
      expect(path.basename(mac.path)).toBe(`Golden Thread — ${LONG} (2026-10-16)`); expect(mac.folderName).toBe(`Golden Thread — ${LONG} (2026-10-16)`);
      expect(fs.readdirSync(path.join(mac.path, 'Semrush Blog'))).toContain(`Blog — Short News Update — ${LONG} (2026-10-16).md`);
    }
    // Short enough for any temp folder this test runs in (a Mac's is about 70 characters).
    const short = await finishedKit('AI ROI');
    const windows = short.api.exportAssetKit({ runId: short.runId }, { into: temp('win-kit-short-'), platform: 'win32' });
    expect(path.basename(windows.path)).toBe('Golden Thread — AI ROI (2026-10-16)'); expect(windows.folderName).toBe('Golden Thread — AI ROI (2026-10-16)');
    expect(fs.readdirSync(path.join(windows.path, 'Semrush Blog'))).toContain('Blog — Short News Update — AI ROI (2026-10-16).md');
  });

  it('fitTitle keeps a title that fits and otherwise cuts at a word', () => {
    expect(kit.fitTitle('Answer engines rewrote search', () => true)).toBe('Answer engines rewrote search');
    expect(kit.fitTitle('Answer engines rewrote search', (title) => title.length <= 16)).toBe('Answer engines…');
    expect(kit.fitTitle('Answer engines, rewrote search', (title) => title.length <= 16)).toBe('Answer engines…');
    expect(kit.fitTitle('Supercalifragilistic', (title) => title.length <= 6)).toBe('Super…');
    expect(kit.fitTitle('Answer engines', () => false)).toBe('');
  });
});
