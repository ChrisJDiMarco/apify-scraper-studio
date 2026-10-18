# Contributing to Scraper Studio

The codebase has a few cross-file contracts that tests enforce. This file lists the change checklists that keep them
intact. Orientation first: [HANDOFF.md](HANDOFF.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup and everyday commands

```bash
nvm use && npm ci
npm run dev                                   # the desktop app with hot reload
npm test                                      # all Vitest suites (offline, free)
npx vitest run test/<file>                    # one suite
npm run lint                                  # ESLint; 0 errors required
node scripts/prompt-goldens.mjs --check       # every prompt byte-for-byte against test/fixtures/prompts
npm run check                                 # lint + test + build:web, what CI runs (plus goldens and the audit)
```

package.json makes this a one-workspace build (`studioWorkspace`), so the first `npm run dev` hides every workspace but
Main in your data folder (nothing is deleted). Use `STUDIO_WORKSPACE_MODE=multi npm run dev` to keep several; see
[RUNBOOK.md](RUNBOOK.md#one-workspace-builds-semrush-package).

On Windows the commands are the same in PowerShell (install Node 24 first: nvm-windows ignores `.nvmrc`, so run
`nvm install 24` and `nvm use 24`, or use `fnm use`). Environment variables are set before the command, for example
`$env:STUDIO_WORKSPACE_MODE='multi'; npm run dev`. The variable stays set for the rest of that PowerShell window;
`Remove-Item Env:STUDIO_WORKSPACE_MODE` clears it. In `cmd.exe` it is `set "STUDIO_WORKSPACE_MODE=multi" && npm run dev`
(the quotes keep a trailing space out of the value).

## Conventions

- **Module systems.** `src/main` is CommonJS. `src/renderer` is ESM and **can't import CommonJS from `src/shared`**
  (the Vite build fails). Data both sides need goes in JSON under `src/shared` (main `require`s it, the renderer
  `import`s it); renderer-only pure logic is ESM; main-only logic is CommonJS.
- **Lazy requires.** Any file main loads lazily (inside a function, or by a computed path) must be listed in
  `scripts/copy-main-modules.mjs`; `test/build-modules.test.js` fails otherwise.
- **Style.** Match the surrounding code: dense single-line JSX where the file already uses it, a short comment saying
  *why* above anything non-obvious, CSS tokens (`--s-*`) instead of new hex values; light and dark must both work.
- **Copy.** Plain, specific language with the studio's vocabulary (Trend, Research run, Quick scan, Trends report,
  Editorial toolkit, Channel assets; stages Needs your OK · Approved · Being written · Ready · Skipped; buttons Yes /
  Skip, Write reports). No jargon, no kid-level analogies.
- **People in examples, fixtures and copy** are always the placeholders Alex, Sam, Riley and Jordan. Never real names.
- **Dialogs.** Use `useConfirm()` (`confirm-dialog.jsx`), never `window.confirm`/`alert`/`prompt`
  (`test/no-native-dialogs.test.js`).
- **Roles in the UI.** Show a control when `can(viewer, method)`, run it when `canRun(viewer, method)`, and spread
  `writeProps(viewer)` on write buttons so previews show them disabled. The server enforces regardless.
- **Money.** Nothing paid runs without a click and a confirmation that shows the estimate (not just the cap). Use the
  shared confirmations in `studio-actions.js` and `cost-lines.js`, and the Codex note (`CODEX_UNCAPPED`).
- **AI.** New AI work goes through `generateStructuredOutput` with a strict schema (every property required,
  `additionalProperties: false`, no `anyOf`) and must work on the Claude CLI, the API key and Codex, on the Mac,
  Windows and the web.
- **Windows.** The suites that load `src/main/index.js` in a `vm` give it a fake `process.platform`, so a Windows branch
  in the main process reads that file's own `process.platform` and passes it down (or takes a `platform` option), never
  a module-level check elsewhere. Start AI tools through `spawnCliProcess` in `index.js` (it resolves npm's `.cmd`
  shims to the real program; never `shell: true`). In tests, skip only the POSIX file-mode check on Windows
  (`if (process.platform !== 'win32')`), and gate symlink tests with `it.runIf(canSymlink)` from
  `test/helpers/can-symlink.js`. Build paths with `path.join` and `fileURLToPath`, never `URL.pathname` or a hard-coded
  `/tmp`.
- **Never commit** `.env*` (except `.env.example`), setup files, `.claude/launch.json`, receipts or screenshots with
  local paths or keys.

## Change checklists

### A new RPC method

1. `src/shared/studio-api-channels.json` `methods`: `"myMethod": "studio:myMethod"` (or `{ channel, args }`).
2. `src/preload/index.js`: `myMethod: (payload) => invoke('studio:myMethod', payload)`. (`src/web/web-api.js` derives
   from the JSON; add a `FILE_PICKERS` entry if it takes a file.)
3. The handler: add the name to `studioMethods` in `src/main/index.js` and implement `contentWorkspace.myMethod`, or
   register `handle('studio:myMethod', fn)`. `handle` wraps it in the gate; keep it synchronous where callers expect a
   plain value.
4. `src/shared/roles.json`: put it in **exactly one** capability; also in `readMethods` if it never writes (reads run
   in previews). If channel owners may call it: a scope in `access.js` `SCOPES` that rebuilds the payload, the name in
   `SCOPE_METHODS.channel` and `channelSafeMethods`, and a result projection in `RESULTS` if needed.
5. If it spends AI: an entry in `STUDIO_PREFLIGHT` (`index.js`) listing the models it needs, and a confirmation with
   an estimate in the UI. A paid method is refused automatically during a drain (`DRAIN_REFUSED` in
   `studio-server.js` derives from capabilities with `spends`).
6. The method counts change: update `test/roles.test.js` and the counts in `docs/roles-and-access.md` and `HANDOFF.md`
   (`test/docs-consistency.test.js` compares them with `roles.json`).
7. Run `npx vitest run test/roles.test.js test/web-parity.test.js test/build-modules.test.js test/docs-consistency.test.js`.

### A new capability

Add it to `roles.json` `capabilities` with `id`, `group`, `label`, `description`, `defaults` (built-in role ids),
`bases`, `methods`, and `requires`/`spends`/`lock` as needed (`requiresByBase` when one kind of role needs less, as
Ask AI on a channel base does; `costsOptional` only for small, capped paid work a role may use without See costs). A
capability a channel base may hold needs every method in `channelSafeMethods` with a channel scope in `access.js`, and
a handler that reads only that person's channel view. Give it `since` above `policyVersion` and raise
`policyVersion`, so existing custom roles show it as New and off. Pages it shows go in `pages`. Update the capability
table in `docs/roles-and-access.md` and the capability list in `docs/app-guide.md` (Roles and access).

### A new or changed prompt

1. Prompt text lives in `src/shared/prompt-registry.json` (blocks: fixed, data, editable) and
   `src/shared/prompt-defaults.json` (default block text); builders render through `src/shared/prompt-template.js`.
2. With no saved versions every prompt must stay byte-identical: run `node scripts/prompt-goldens.mjs --check`.
3. For an intended change only, regenerate the affected cases and review the diff:
   `node scripts/prompt-goldens.mjs --only <prefix>` (for example `--only assistant.ask-ai`).
4. Required `{{variables}}` and words are part of the contract the Prompt Library validates; keep them.

### A new Ask AI action

1. One entry in `src/shared/ask-actions.json` `actions`: `label`, `target` (the kind of item), `params` (flat
   `key=value` inputs and their types), `methods` (a role needs all of them), optional `needs` (prompt view or edit,
   Google Drive), `spends`, `destructive`, `confirm`, `form`, `layouts` and the `prompt` line. Old names go in `aliases`.
2. An executor in `src/renderer/src/studio-actions.js` (`executors`); paid kinds confirm with an estimate. For a channel
   owner's Ask AI too, add `channel` to `layouts`, a `channelPrompt` when its line differs, an executor in
   `src/renderer/src/channel-ask.jsx` and its target in `channelResolve` (`src/main/ask-channel.js`); every method it
   calls must be channel-safe.
3. If it targets a new kind of item, resolve it in `helpResolveActions` (`src/main/index.js`).
4. The ACTIONS prompt changes, so regenerate `node scripts/prompt-goldens.mjs --only assistant.ask-ai`.
5. **Never add objects to the answer schema**: inputs travel as `params` strings (see the schema rule below).
6. Tests: `test/ask-actions-registry.test.js`, `test/studio-actions.test.jsx`, `test/help-assistant-prompts.test.js`.

### A new Ask AI card type

Add it to `CARD_TYPES` (and `MODEL_CARDS` if the model fills it) in `src/main/help-assistant.js` and to the CARDS rules
in the prompt; parse its `items` lines (model cards) or build it in `hydrateCards` (studio cards, `index.js`); render it
in `chat-cards.jsx` inside the shared card shell (`ReplyCard`; the shell, chips, badges, progress and buttons are styled
once in `ask-reply.css`, and only what that card draws itself goes in `chat-cards.css`; a reply has one primary button at
most, see `primaryCard`, whose `wantsPrimary` case for the card must follow the same rules the card uses to draw its
buttons, permissions included); add a case to `test/chat-cards.test.jsx`. The card wire shape stays
`{ type, ref, title, note, items: [string], actionIndexes }`; never a nested `data` object.

**The schema rule.** The Anthropic API refuses a structured-output schema whose compiled grammar is too large. Keep
Ask AI's answer schema at 11 objects or fewer, at most 10 values per enum and 40 in total, no nested objects inside
repeated items; long lists (pages, spots, kinds, card types) stay plain strings that the prompt lists and `cleanReply`
checks. `test/help-assistant-prompts.test.js` enforces it.

### A new Show me target

Put a `data-spot="<id>"` (and `data-spot-item` for repeated items) on the element and add the spot to
`src/shared/help-spots.json`. Steps that exist in only one layout are filtered by layout.

### A UI change

`docs/app-guide.md` is Ask AI's runtime knowledge: update it with the exact labels in the same change, and keep it
short (every byte is sent with every question; `test/docs-consistency.test.js` keeps it under 150,000 bytes). It is
copied into the build, so a guide change ships with the next build and restart.

### A new environment variable

Read it in one place, document it in [HANDOFF.md](HANDOFF.md#configuration-reference) (the docs test fails if a
`STUDIO_*` variable the code reads is missing there), in `docs/web-deploy.md` if it is a server setting, and in
`.env.example`. Secrets never become environment variables: add them to `SECRET_NAMES` in `src/main/web-secrets.js`.

### A new channel

An entry in `src/shared/kit-folders.json` `folders` (`id`, `semrush`, `general`, `semrushShort`, `generalShort`,
`deliverables`). Ids are permanent. Details: [docs/roles-and-access.md](docs/roles-and-access.md#adding-things).

## Dependencies

- Stay within the newest two Electron majors; after an Electron upgrade run `npm test`, `npm run test:desktop`, and
  install over the previous version to confirm saved keys still decrypt.
- `npm audit --omit=dev --audit-level=high` must pass (CI checks it). Dependabot groups updates weekly.
- Never run `npm audit fix` or `npm install --omit=dev` in a development checkout.

## Pull request checklist

- [ ] `npm run check` passes (lint 0 errors, tests, web build).
- [ ] `node scripts/prompt-goldens.mjs --check` shows 0 differences, or the regenerated cases are intended and reviewed.
- [ ] `npm run build` passes if main-process files or `copy-main-modules.mjs` changed.
- [ ] The app guide, `HANDOFF.md` and the relevant doc changed with any behaviour, label, variable or count change.
- [ ] Role, sign-in or navigation changes: run [docs/verification/roles-acceptance.md](docs/verification/roles-acceptance.md).
- [ ] Paid flows show an estimate before spending; nothing spends without a click.
- [ ] No real names, keys or local paths in code, fixtures or docs.

Terms in the UI differ from code identifiers; the glossary is in [HANDOFF.md](HANDOFF.md#glossary-ui-term-and-code-identifier).
