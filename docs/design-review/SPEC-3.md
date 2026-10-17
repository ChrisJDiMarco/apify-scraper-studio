# Studio redesign, wave 3: AI platform, streaming chat, auto reports, Monday, automations, Settings and Home

> **Status:** design record for the October 2026 wave 3 build. The code is the source of truth; HANDOFF.md and ARCHITECTURE.md describe what shipped. SPEC.md and SPEC-2.md still apply where this file is silent.

## What the owner asked for

1. When someone asks Ask AI for a scrape, the studio writes a trends report for that run on its own and posts it back into the conversation.
2. Brand reference images (Semrush campaign graphics and social graphics, SEL heroes and social graphics) are sent with **every** picture the studio makes, so pictures match the house style.
3. Settings gets a left-side section nav.
4. AI connections:
   - Subscription sign-in through **Claude Code** (Claude plan) and **Codex** (ChatGPT plan).
   - API keys for **Anthropic**, **OpenAI**, **OpenRouter** (any model) and **fal.ai** (images and videos).
   - An admin **Model routing** page that sets the route, model and effort for every AI task the studio runs.
5. Ask AI streams its answer smoothly and feels as polished as the Claude Code and Codex chat apps.
6. Monday.com works plug-and-play and stays in sync both ways.
7. Workflows and Playbooks are rebuilt so they fit the new app.
8. The Semrush package has a single workspace named **Main**, with no workspace switcher.
9. Admin Home gets a Research programs panel, with a quick-edit drawer that holds every program setting.

## Decisions

- **Connections and tasks.** A *connection* is how the studio reaches a vendor. The route ids are `claude`, `claude-api`, `codex`, `openai`, `openrouter` and `fal`, plus the pseudo-route `auto`. A *task* is one kind of AI work. *Routing* maps each task to its connection, model, and effort (or quality and video options).
  - Admins set routing studio-wide.
  - Research programs may override their own stages.
  - A run snapshots what it resolved when it started, so a retry never changes provider or price silently.
  - There is no silent cross-provider fallback. The only automatic fallback stays `auto`: Claude Code first, then the Anthropic key.
- **Subscription connections use the sign-in of the machine the studio runs on.** On the web build that is the server's sign-in, and the UI says so.
- **Spending.** Nothing paid starts without a click and an estimate. Codex is reported as *not metered*, and channel owners never see money. A workflow's paid steps run only inside an approved per-run and per-month budget.
- **Ask AI answer schema.** It stays small: at most 11 objects, and at most 10 values in any enum. Guard tests enforce this. Streaming must not add schema fields beyond what the guard allows.
- **Quick scans started from Ask AI write a short trends report by default.** The report is part of the scan estimate shown before **Start scan**. Full research runs keep the human review gate: Ask AI posts the trends that are ready for review back into the conversation, with Yes/Skip and Write reports.
- **The Semrush package runs in single-workspace mode.** It is turned on by a package.json field, or by an env var on the web build. Existing data is kept. Other workspaces are hidden, never deleted, and the Semrush workspace is shown as **Main**.

## Build waves and owners

Detailed designs live with the build agents; the outcomes are summarized in HANDOFF.md.

| Wave | Builder | Owns |
|---|---|---|
| A | AI platform | Connections, the task registry and routing, the OpenRouter/OpenAI/fal runners, the media router, video deliverables, **brand references on every image path**, Settings → AI connections and Model routing, and the streaming hooks in the runners (`structured-stream.js`). |
| A | Chat streaming | The streaming transport (desktop IPC events, web SSE), Ask AI progress, and the premium chat UI. |
| A | Scan reports | The auto trends report for quick scans, Ask AI follow-up messages, and follow-ups for full research runs started from chat. |
| B | Monday.com | Connect, board picker and creator, mapping, two-way sync, the sync log, and the UI. |
| B | Workflows and playbooks | The playbook catalog, the workflow engine and store, the UI, and their capabilities in `roles.json`. |
| B | Settings, workspace and Home | The Settings section nav, single-workspace mode, and the Home programs panel and drawer. |

## Contracts between builders

- **Structured output with a task id and streaming.** `generateStructuredOutput({ ..., taskId, onStream })`:
  - `taskId` selects the routing.
  - `onStream(event)` receives `{ type: 'text', delta }` for the streamed answer field and `{ type: 'status', text }` for progress.
  - Every route must call `onStream` at least once, with the whole answer when it can't stream.
- **Pushing Ask AI events.** Main-process `pushAskEvent(identityId, event)` delivers events to that person's open windows: IPC on the Mac, the person's SSE stream on the web. The event shapes are:
  - `{ type: 'progress', requestId, progress }`
  - `{ type: 'delta', requestId, text }`
  - `{ type: 'followup', conversationId, messageId }`
- **Follow-ups.** `ask-followups.js` appends an assistant message to the conversation that started a run (`run.quickScan.ask = { identityId, conversationId }`), then calls `pushAskEvent(..., { type: 'followup' })`.
- **Brand references.** Every image generation goes through the media router with `references` taken from the snapshotted brand set for that picture family. A guard test fails if any image path omits references when a set exists.
