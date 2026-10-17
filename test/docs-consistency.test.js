import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import roles from '../src/main/roles.js';
import policy from '../src/shared/roles.json';
import ask from '../src/shared/ask-actions.json';

// The handoff docs drift in mechanical ways: a variable missing from the config table, a script renamed, a link to a
// moved file, an old page name, a method count. These checks catch each before it reaches the next team.
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const handoff = read('HANDOFF.md');

function walk(dir, keep, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, keep, out); else if (keep(rel)) out.push(rel);
  }
  return out;
}

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered.
function anchorsOf(markdown) {
  const seen = new Map(); const anchors = new Set();
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    const match = !fenced && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '');
    const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const count = seen.get(base) || 0; seen.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  }
  return anchors;
}

// [text](target) links outside code, minus web and mail links.
function linksOf(markdown) {
  const out = []; let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const prose = line.replace(/`[^`]*`/g, '');
    for (const match of prose.matchAll(/\]\(([^)\s]+)\)/g)) if (!/^(https?:|mailto:)/.test(match[1])) out.push(match[1]);
  }
  return out;
}

function brokenLinks(file) {
  const problems = [];
  for (const link of linksOf(read(file))) {
    const [target, anchor] = link.split('#');
    const resolved = target ? path.normalize(path.join(path.dirname(file), decodeURIComponent(target))) : file;
    if (!exists(resolved)) { problems.push(`${file}: ${link} (no such file)`); continue; }
    if (anchor && resolved.endsWith('.md') && !anchorsOf(read(resolved)).has(anchor)) problems.push(`${file}: ${link} (no such heading)`);
  }
  return problems;
}

const ROOT_DOCS = ['README.md', 'HANDOFF.md', 'ARCHITECTURE.md', 'RUNBOOK.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];
const CURRENT_DOCS = [...ROOT_DOCS, ...walk('docs', (file) => file.endsWith('.md') && !file.startsWith(path.join('docs', 'archive')))];

describe('handoff docs', () => {
  it('documents every variable in .env.example in HANDOFF.md', () => {
    const names = [...new Set([...read('.env.example').matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]{2,})=/gm)].map((match) => match[1]))];
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((name) => !handoff.includes(`\`${name}\``))).toEqual([]);
  });

  it('documents every environment variable the code reads in HANDOFF.md', () => {
    const files = [...walk('src', (file) => /\.(c?js|mjs)$/.test(file) && !file.startsWith(path.join('src', 'renderer'))), ...walk('scripts', (file) => /\.(c?js|mjs|sh)$/.test(file))];
    const names = new Set();
    for (const file of files) {
      const text = read(file);
      for (const match of text.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])|\benv\.([A-Z][A-Z0-9_]+)|\bnumber\('([A-Z][A-Z0-9_]+)'/g)) names.add(match[1] || match[2] || match[3] || match[4]);
    }
    const keyNames = JSON.parse(read('src/main/index.js').match(/const KEY_NAMES = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
    for (const name of keyNames) names.add(name);
    expect(names.size).toBeGreaterThan(30);
    expect([...names].filter((name) => !handoff.includes(`\`${name}\``)).sort()).toEqual([]);
  });

  it('lists every variable of HANDOFF.md’s Configuration reference in .env.example', () => {
    const section = handoff.split('\n## Configuration reference')[1].split('\n## ')[0];
    const names = new Set();
    for (const line of section.split('\n').filter((row) => row.startsWith('| `'))) for (const match of line.split('|')[1].matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)) names.add(match[1]);
    expect(names.size).toBeGreaterThan(30);
    const example = read('.env.example');
    expect([...names].filter((name) => !new RegExp(`\\b${name}=`).test(example)).sort()).toEqual([]);
  });

  it('quotes the real number of Ask AI action kinds', () => {
    const kinds = Object.keys(ask.actions).length; const aliases = Object.keys(ask.aliases || {}).length;
    expect(handoff).toContain(`${kinds} kinds of action buttons`);
    expect(read('ARCHITECTURE.md')).toContain(`lists ${kinds} action kinds (plus ${aliases} old names as aliases)`);
    expect(read('CHANGELOG.md')).toContain(`ask-actions.json\`, ${kinds} kinds)`);
    expect(read('docs/design-review/SPEC.md')).toContain(`(${kinds} kinds plus ${aliases} old names as aliases)`);
  });

  // The same key patterns scripts/make-handoff.sh fails on, over every file that could be committed, so a fixture that
  // looks like a key fails here instead of at handoff time.
  it.runIf(spawnSync('git', ['-C', root, 'rev-parse', '--git-dir']).status === 0)('has nothing the handoff script’s key scan would refuse', () => {
    const script = read('scripts/make-handoff.sh');
    const block = script.slice(script.indexOf('secrets=$(grep'), script.indexOf('"$work" || true)'));
    const patterns = [...block.matchAll(/-e '([^']+)'/g)].map((match) => new RegExp(match[1]));
    expect(patterns.length).toBeGreaterThan(8);
    const files = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
    const hits = [];
    for (const file of files) {
      let text; try { const buffer = fs.readFileSync(path.join(root, file)); if (buffer.includes(0)) continue; text = buffer.toString('utf8'); } catch { continue; }
      for (const pattern of patterns) if (pattern.test(text)) hits.push(`${file}: ${pattern.source}`);
    }
    expect(hits).toEqual([]);
  });

  it('names only package.json scripts that exist', () => {
    const { scripts } = JSON.parse(read('package.json'));
    const named = new Set();
    for (const file of ROOT_DOCS) for (const match of read(file).matchAll(/\bnpm (?:run ([a-z][\w:-]*)|(test)\b)/g)) named.add(match[1] || match[2]);
    expect(named.size).toBeGreaterThan(5);
    expect([...named].filter((name) => !scripts[name])).toEqual([]);
  });

  it('links only to files and headings that exist', () => {
    expect(linksOf(handoff).length).toBeGreaterThan(20);
    expect(CURRENT_DOCS.flatMap(brokenLinks)).toEqual([]);
  });

  it('keeps the method counts the docs quote in step with roles.json', () => {
    const counts = Object.fromEntries(roles.ROLE_IDS.map((role) => [role, roles.METHOD_NAMES.filter((method) => roles.canCall(role, method)).length]));
    const line = `admin ${counts.admin} methods, editor ${counts.editor}, channel owner ${counts.channel}`;
    expect(read('docs/roles-and-access.md')).toContain(line);
    expect(handoff).toContain(line);
    expect(handoff).toContain(`${policy.capabilities.length} capabilities over ${roles.METHOD_NAMES.length} RPC methods`);
    expect(read('ARCHITECTURE.md')).toContain(`every method the UI calls (${roles.METHOD_NAMES.length})`);
  });
});

describe('the app guide (Ask AI reads it on every question)', () => {
  const guide = read('docs/app-guide.md');

  it('stays small enough to send with every question', () => {
    expect(Buffer.byteLength(guide, 'utf8')).toBeLessThan(150000);
  });

  it('describes the studio as it is, not a tester build', () => {
    expect(guide).not.toMatch(/\btesters?\b/i);
    expect(guide).not.toMatch(/isn['’]t set up .* yet/i);
  });

  it('uses current page and button names outside "(formerly …)" notes', () => {
    const retired = ['More tools', 'Chat with findings', 'AI reports', 'People & roles', 'Write the reports', 'Find full trends on this topic', 'Approve themes & build reports'];
    const files = ['README.md', ...CURRENT_DOCS.filter((file) => file.startsWith('docs') && !file.startsWith(path.join('docs', 'design-review')))];
    const hits = [];
    for (const file of files) {
      const text = read(file).replace(/\(formerly [^)]*\)/g, '');
      for (const label of retired) if (text.includes(label)) hits.push(`${file}: ${label}`);
    }
    expect(hits).toEqual([]);
  });
});
