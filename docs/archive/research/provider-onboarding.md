# Provider connections for Content Studio

Research checked September 27, 2026. This document distinguishes current official provider capabilities from recommendations for this app. It does not record a successful provider call, create credentials, or change the selected text engine.

## Recommended product decision

Keep **Claude Opus 5.5 as the primary text engine** for research, classification, report drafting, and content generation. Add a separate **Images** connection, defaulting to the direct OpenAI Images API with **GPT Image 2.5 Flare**. Offer Sunburst when reference editing precision matters, and fal.ai as an optional image provider. Connecting images must not change the text engine.

The official OpenAI guide recommends the direct Image API for one-prompt generation/editing, and the Responses API for conversational image editing. Flare is positioned for fast everyday generation; Sunburst for precise editing. Both are current GPT Image 2.5 models. These are product recommendations, not a claim that a live comparison has been run. [Image API guidance](https://developers.openai.com/api/docs/guides/image-generation), [Flare model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare), [Sunburst model](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)

## Capability and deployment matrix

| Connection | Text/report role | Image role | Runs locally? | Hosted app fit | Authentication and app status |
| --- | --- | --- | --- | --- | --- |
| Claude CLI / Opus 5.5 | Existing primary structured-output route | Current runner has no image-generation tool | Requires an installed, authenticated CLI on its host | Existing trusted-host route; assess a production Anthropic API adapter separately before public deployment | App source uses `claude-opus-5-5`, JSON schema, disabled tools, and per-call budget. Preserve this selection. |
| Codex CLI with ChatGPT sign-in | Optional trusted local agent workflow | Official interactive CLI supports `$imagegen`; current app's older Codex runner is a structured text/JSON path, not a verified PNG adapter | Yes, with CLI installed and signed in | Do not expose a personal Codex process to public/untrusted callers | `codex login` and `codex login status`; subscription entitlements and workspace policies apply. |
| Codex CLI with an API key | Optional trusted automation route | Image generation has API pricing when authenticated this way | Yes | Suitable for trusted automation; not a substitute for an isolated public product API | Separate from the app's direct Image API connector. |
| OpenAI Images API | Does not replace Claude text | Recommended direct generation/editing route | Desktop main process can use the owner's key | Backend service holds the key and enforces workspace quotas | `OPENAI_API_KEY`; model permission and billing must be verified independently. |
| OpenAI Responses API | Optional future text choice only when explicitly selected | Conversational image tool, if needed later | Host/backend only | Supported API route; extra mainline-model usage applies | Separate model and image-tool configuration. No need for this extra hop in the current batch generator. |
| fal.ai model API | No text-route change proposed | Optional model-specific image generation/editing | Desktop host with owner's key | Backend queue worker or proxy | `FAL_KEY` with API scope; account/team-scoped billing. Model schemas differ. |

Local runner evidence: `src/shared/claude-runner.js`, `src/shared/codex-runner.js`, and `src/main/studio-host.js`. This is a snapshot of the current code, not a provider-access test. The desktop and hosted production adapters remain different trust boundaries.

Codex supports ChatGPT sign-in and API-key sign-in. Its documentation recommends API keys for programmatic workflows and cautions against exposing Codex execution to public or untrusted environments. A Codex access token is for trusted Codex automation; general OpenAI API calls use Platform credentials. Do not extract `~/.codex/auth.json` and repurpose its session tokens as an image API key. [Codex authentication](https://learn.chatgpt.com/docs/auth)

Codex's interactive CLI can invoke `$imagegen`, with `-i`/`--image` for a reference. Its built-in image route is currently documented as GPT Image 2, while the API guide recommends GPT Image 2.5 for new integrations. These are distinct surfaces. Built-in images consume Codex usage, on average faster than turns without images; a signed-in session does not mean unlimited images or general API access. [Codex image generation](https://learn.chatgpt.com/docs/image-generation), [Codex image usage](https://learn.chatgpt.com/docs/pricing#how-does-image-generation-count-toward-usage-limits)

## Connection flow that ordinary users can understand

Recommended Settings layout:

1. **Writing and analysis — Claude Opus 5.5.** Show connection state, actual resolved model, and a small text test. Optional Codex belongs under a separate advanced text choice; never auto-switch after a failure.
2. **Images — OpenAI / fal.ai.** Provider selector, secure credential action, selected model, and connection state. Keep the model hidden behind “Advanced” after setup.
3. **Delivery — Google Drive.** Keep its permissions, status, and explicit publish action separate from generation.

Use meaningful states: **Not connected**, **Credential saved**, **Access verified**, **Image generation verified**, **Needs attention**. Saving a key or listing models cannot honestly prove image generation, billing, or organization verification works. Make a small paid generation test an explicit action showing provider, output count, quality, and a budget allowance first. Keep its PNG and receipt so the user can inspect a real result.

Suggested image controls: **Draft / Standard / Detailed** mapped to explicit `low / medium / high`, **1 / 2 / 3 variations**, and Square / Landscape / Portrait. Default to one low-quality image for a connection test and medium-quality production drafts; allow the existing three distinct creative directions when the user selects the full pack. Keep `xhigh`, `max`, custom resolution, and editing references under Advanced. These defaults are app recommendations, not provider guarantees about cost or quality.

For enterprise teams, let an administrator connect the provider once per workspace and let members choose approved outputs. Add an allowed-model list, per-run reservations, per-user/workspace quotas, usage receipts, and a clear route label. Never silently fail over from one provider to another: this changes data destination, billing, and output behavior.

## Exact OpenAI generation contract

Use the fixed endpoint `POST https://api.openai.com/v1/images/generations`, JSON content type, and `Authorization: Bearer <server-loaded credential>`.

```json
{
  "model": "gpt-image-2.5-flare",
  "prompt": "The validated brand-aware image brief for one selected direction.",
  "n": 1,
  "size": "1536x1024",
  "quality": "medium",
  "output_format": "png",
  "background": "opaque",
  "moderation": "auto"
}
```

Use a separate request per distinct variant prompt. `n: 3` repeats the same prompt; it does not transmit the three distinct directions already in the content plan. Pin `gpt-image-2.5-flare-2026-09-08` when reproducible model identity is more important than tracking the alias; Sunburst's snapshot is `gpt-image-2.5-sunburst-2026-09-08`. [Flare snapshot](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare), [Sunburst snapshot](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)

The request prompt limit is 32,000 characters; `n` accepts 1–10. Omit `response_format`: GPT Image returns base64 and does not support that DALL-E parameter. The response has `data[]` with `b64_json`; it may include `created`, `size`, `quality`, `output_format`, and `usage`. Decode only after validating the response and expected output count. [Image generation reference](https://developers.openai.com/api/reference/cli/resources/images/methods/generate)

Example response shape, with illustrative token counts rather than a real generation:

```json
{
  "created": 1790520000,
  "data": [{ "b64_json": "<encoded PNG bytes>" }],
  "size": "1536x1024",
  "quality": "medium",
  "output_format": "png",
  "usage": {
    "input_tokens": 1000,
    "input_tokens_details": { "text_tokens": 1000, "image_tokens": 0 },
    "output_tokens": 4096,
    "total_tokens": 5096
  }
}
```

The current guide supports low, medium, high, xhigh, max, and auto quality for both 2.5 models. PNG, JPEG, and WebP are supported; transparency requires PNG or WebP. Standard sizes are 1024×1024, 1536×1024, and 1024×1536. Prefer these explicit presets for this app. Reference images require an edits request or the Responses image tool; mentioning an unsent local path in a generation prompt does not upload a reference. [Image generation options and editing](https://developers.openai.com/api/docs/guides/image-generation)

Host recommendations: bound request/response sizes, enforce HTTPS without redirects to arbitrary hosts, keep credentials out of renderer state and logs, validate decoded PNG dimensions and signature, retain output bytes before declaring success, and record request ID/model/usage. Allow a several-minute host timeout, preserve unknown-spend reservations on interruption, and do not blindly repeat an ambiguous paid generation. Authentication, missing model access, quota, and a user-correctable rejected prompt need actionable errors rather than repeated retries. These are implementation recommendations.

## OpenAI pricing and spend accounting

Standard rates for **both GPT Image 2.5 models**, in USD per million tokens:

| Usage | Direct Image API | Cached input rate, Responses image tool only |
| --- | ---: | ---: |
| Text input | $5 | $1.25 |
| Image input | $8 | $2 |
| Image output | $30 | — |

The direct `/v1/images/generations` and `/v1/images/edits` routes do not receive the GPT Image 2/2.5 cached-input rates. A Responses workflow also adds its mainline-model usage. [Official image pricing](https://developers.openai.com/api/docs/pricing#image-generation), [Caching scope](https://developers.openai.com/api/docs/guides/image-generation#cached-input-pricing)

For a direct request with a complete usage breakdown:

```text
estimatedCostUsd = (
  inputTextTokens * 5 +
  inputImageTokens * 8 +
  outputImageTokens * 30
) / 1_000_000
```

Read input counts from `usage.input_tokens_details`; use image output details when supplied, otherwise the image-only response's `output_tokens`. The illustrative 1,000-text-input / 4,096-image-output example above gives **$0.12788**, not a price promise for a medium image. Missing or inconsistent usage means **cost unknown**, with the allowance still reserved. Preserve the pricing version/date with the estimate and reconcile against billing for authoritative spend.

Do not copy GPT Image 2 per-image prices or calculator results onto GPT Image 2.5: the model pages explicitly say the older calculator does not estimate 2.5 consumption, and equal token rates do not imply equal tokens per image. Reserve before dispatch; stop further variants when remaining allowance is insufficient. A local allowance controls additional dispatch, not an already-running request's final charge. Do not promise an exact hard cap without a verified maximum request cost or provider-enforced limit. [Flare pricing caveat](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare), [Sunburst pricing caveat](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)

## Practical fal.ai adapter

Use an **API-scoped** team key, not an ADMIN key intended for model deployment. Store it as `FAL_KEY` on the host. Choose the intended team before creating its key. [fal key setup and scopes](https://fal.ai/docs/documentation/setting-up/authentication)

A concrete optional model is `fal-ai/flux-2-pro`. Its generation schema supports `prompt`, custom `image_size`, `seed`, and `output_format`; choose PNG explicitly because its default is JPEG. Its result contains `images[]` entries with URLs and optional dimensions/type metadata. [FLUX.2 Pro API schema](https://fal.ai/models/fal-ai/flux-2-pro/api)

```json
{
  "prompt": "One validated creative direction from the campaign plan.",
  "image_size": { "width": 1536, "height": 1024 },
  "output_format": "png",
  "enable_safety_checker": true
}
```

Submit to `https://queue.fal.run/fal-ai/flux-2-pro` with `Authorization: Key <host credential>`. Save `request_id` before polling; the documented queue returns status/result/cancel URLs. Observe `IN_QUEUE`, `IN_PROGRESS`, and `COMPLETED`, then retrieve the result and validate it. `COMPLETED` may include an error, and a polling timeout does not necessarily cancel server inference. Resume by saved request ID instead of resubmitting. Use `@fal-ai/client` queue methods or a bounded host implementation; accept only the documented API origins for authenticated queue URLs. [fal asynchronous inference](https://fal.ai/docs/documentation/model-apis/inference/queue)

The published FLUX.2 Pro rate is $0.03 for the first output megapixel plus $0.015 per additional billed megapixel; the page gives $0.045 for 1920×1080. Do not derive a universal image price across fal models. Query its authenticated pricing endpoint for the selected model's current billing unit and account rate before presenting a cost estimate: `GET https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux-2-pro`, using `Authorization: Key ...`. [Model price](https://fal.ai/models/fal-ai/flux-2-pro), [fal pricing API](https://fal.ai/docs/platform-apis/v1/models/pricing)

For enterprise source material, implement and verify fal's retention and file-access controls before enabling private references. `X-Fal-Store-IO: 0` disables JSON payload storage, but does not itself make media private. `X-Fal-Object-Lifecycle-Preference` can set expiration and an initial ACL; ACL support is limited to fal CDN v3, not arbitrary third-party storage. Uploaded inputs require their own ACL. Restricted CDN reads use a separately issued CDN bearer token; do not forward `FAL_KEY` to arbitrary returned media hosts. Copy completed bytes into the app's private artifact storage and do not treat temporary provider URLs as the permanent library. [Retention controls](https://fal.ai/docs/documentation/model-apis/media-expiration), [File ACLs and restricted reads](https://fal.ai/docs/documentation/model-apis/file-access-controls)

## Desktop and hosted secret boundaries

A distributed app must never contain the developer's shared provider key. For desktop bring-your-own-key usage, the owner's credential stays in the main process and OS credential storage; the renderer receives only a masked status and can request approved operations. An ignored local environment file is a development fallback, not a production secret-distribution mechanism. Never write secrets into exported campaign packs, source JSON, screenshots, analytics, or shared workspace state.

For the web edition, all provider calls originate on an authenticated backend. Store workspace credentials encrypted in a secret manager, enforce authorization before reading them, and return generated assets through workspace access controls. An unrestricted proxy is not sufficient: validate endpoint/model/input, apply quotas, and bind each run to its authorized workspace. The official providers both instruct developers to keep keys out of browsers and client apps. [OpenAI API authentication](https://developers.openai.com/api/reference/overview#authentication), [fal proxy guidance](https://fal.ai/docs/documentation/model-apis/inference/proxy-setup)

The approved new OpenAI key should be created only through the separate secure onboarding flow and saved to the user-confirmed destination. No key or provider call was created during this research. A live smoke test must still establish actual model access, billing, PNG output, usage fields, and appearance; credential presence alone is not that proof.
