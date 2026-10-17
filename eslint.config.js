// ESLint flat config. Deliberately small: catch real errors (undefined names, broken hook order), warn on dead variables.
// Run with `npm run lint`; CI fails on errors only.
const fs = require('node:fs');
const path = require('node:path');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');

// src/shared mixes ES modules (imported by the renderer) and CommonJS (required by main) under one .js extension.
// Classify each file by its contents so it is parsed the way it actually runs.
const sharedDir = path.join(__dirname, 'src/shared');
const sharedEsm = fs.readdirSync(sharedDir).filter((name) => name.endsWith('.js') && /^\s*(import|export)\s/m.test(fs.readFileSync(path.join(sharedDir, name), 'utf8'))).map((name) => `src/shared/${name}`);

const rules = {
  'no-undef': 'error',
  // React stays imported by convention although the automatic JSX runtime doesn't need it.
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^React$' }],
};
const hookRules = { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' };
const jsx = { ecmaFeatures: { jsx: true } };

module.exports = [
  { ignores: ['out/', 'dist/', 'coverage/', 'node_modules/', '.claude/', 'resources/'] },
  { linterOptions: { reportUnusedDisableDirectives: 'warn' } },
  // Main process, preload, CommonJS shared modules, .cjs scripts and root configs: Node, CommonJS.
  { files: ['src/main/**/*.js', 'src/preload/**/*.js', 'src/shared/**/*.js', '**/*.cjs', 'electron.vite.config.js', 'eslint.config.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } }, rules },
  // ES-module shared files run in both the renderer and Node.
  { files: sharedEsm, languageOptions: { sourceType: 'module', globals: { ...globals.browser, ...globals.node } } },
  // Renderer and browser studio: React in the browser.
  { files: ['src/renderer/**/*.{js,jsx}', 'src/web/**/*.{js,jsx}'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: jsx, globals: { ...globals.browser } }, plugins: { 'react-hooks': reactHooks }, rules: { ...rules, ...hookRules } },
  // False positives: plain async handlers named useReport / useWorkbook (not hooks) trip rules-of-hooks.
  // Follow-up: rename them (e.g. startFromReport, loadWorkbook) and delete this block; the files had other owners during the final build-out.
  { files: ['src/renderer/src/content-studio-view.jsx', 'src/renderer/src/research-knowledge.jsx'], rules: { 'react-hooks/rules-of-hooks': 'off' } },
  // .mjs scripts and configs: Node, ES modules.
  { files: ['**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } }, rules },
  // Tests: ES modules on Node with jsdom, some load CommonJS main modules through createRequire.
  { files: ['test/**/*.{js,jsx}'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: jsx, globals: { ...globals.node, ...globals.browser } }, plugins: { 'react-hooks': reactHooks }, rules: { ...rules, ...hookRules } },
];
