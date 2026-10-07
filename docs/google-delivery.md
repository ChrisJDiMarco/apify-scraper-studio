# Google Drive campaign delivery

Google delivery is an optional, explicit action for a completed Content Studio campaign. It creates a campaign folder, one folder per selected channel, a native Google Doc for every selected written asset, and PNG/SVG files for selected generated images. It does not change sharing permissions, publish files to the web, send messages, or send anything to Slack.

## Connection and permissions

Enable the Google Drive API for the OAuth application's Google Cloud project. Request `https://www.googleapis.com/auth/drive.file` when authorizing the user: this is Google's recommended per-file scope for creating and working with the app's files. A token with only Google Docs read permission cannot create Drive folders or upload files. This adapter never requests a broader scope on its own. [Google Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

The host supplies an OAuth access token through `getAccessToken()`. The current app supports a manually configured token; it does not yet implement an OAuth sign-in window, refresh-token storage, or automatic refresh. Access tokens expire according to the authorization response's `expires_in` value. On an access failure, reconnect or replace the token, then retry the saved campaign receipt. A production web app needs a server-side authorization-code flow, encrypted token storage, and refresh handling; keep client secrets out of the browser. [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)

Tokens are sent only in the Authorization header to the fixed `https://www.googleapis.com` host. Redirects are rejected. The adapter does not put tokens in returned receipts, URLs, or error messages. Network requests are bounded and errors do not repeat provider response bodies.

## Host contract

```js
const { createGoogleDelivery } = require('./google-delivery');
const google = createGoogleDelivery({
  getAccessToken: async () => loadGoogleAccessToken(),
  // fetchImpl is optional; production uses globalThis.fetch.
});

const receipt = await google.publishCampaign({
  campaignId: run.id,             // Stable per campaign version.
  title: run.title,
  assets: [
    {
      id: report.id, title: report.title, channel: 'Research', kind: 'text',
      html: appRenderedReportHtml,
    },
    {
      id: image.id, title: image.title, channel: 'Social', kind: 'image',
      png: pngBuffer, svg: svgString, // SVG is optional.
    },
  ],
  previousReceipt: run.googleDeliveryReceipt,
  onProgress: async ({ phase, receipt }) => {
    // Required: commit this full checkpoint to durable storage before resolving.
    // Throw on storage failure; publishing will stop before further writes.
    await saveCampaignDeliveryReceipt(run.id, receipt);
  },
});
```

`html` must come from the app's validated structured-content renderer, `renderContentExport(output, { format: 'html' })`. Do not pass model-generated HTML directly. The adapter rebuilds a restricted semantic HTML document, discards layout CSS, rejects scripts and event handlers, and retains validated HTTPS source links. Google converts the uploaded HTML to a native document because its upload metadata specifies `application/vnd.google-apps.document`. The conversion preserves semantic content; it does not guarantee the exact local report layout. [Google Drive uploads and conversion](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

`png` must be an existing PNG Buffer. An optional SVG must be the app's raster wrapper with its PNG embedded as a data URI; it remains a raster image inside an SVG container, not editable vector artwork. All assets are validated before any network calls. Each file is limited to 5 MB and each publish request to 200 assets; oversized files require local export. Resumable uploads are not implemented.

Folders use `application/vnd.google-apps.folder`, and child files receive their destination folder's ID in `parents`. There is no public-sharing or permission mutation. Files inherit normal Google Drive folder access behavior. The campaign folder is created in the authorized user's Drive root; choosing a shared-drive or existing destination folder is not implemented. [Google Drive folders](https://developers.google.com/workspace/drive/api/guides/folder)

## Checkpoints, retry, and duplicate prevention

The durable receipt includes:

- `version`, `campaignId`, `title`, timestamps, and overall `status`.
- `campaignFolder` and `folderUrl`.
- `channelFolders`, each with `channel`, `id`, `name`, `mimeType`, and `url`.
- `assets`, each with `assetId`, `title`, `channel`, `status`, and `files`. Each file has `format` (`google-doc`, `png`, or `svg`), `id`, `name`, `mimeType`, and `url`.
- `operations`, including stable operation IDs, content fingerprints, status, and any known Google file receipt.
- On failure, a sanitized `error`. The thrown error also exposes the latest in-memory receipt as `error.receipt`.

Checkpoint phases are `before-write`, `saved`, `recovered`, `campaign-ready`, `asset-file-ready`, `asset-ready`, `complete`, and `error`. The host must durably save each event's complete receipt before resolving the callback. The `before-write` checkpoint records a pending operation before its POST can be sent. If checkpoint saving fails, the adapter stops immediately.

Each created file has private `appProperties` for its campaign, operation, and content fingerprint. On retry the adapter verifies known file IDs, or searches for an operation's property to recover a file whose successful response was lost. It verifies MIME type, campaign, fingerprint, and expected parent instead of assuming any matching file is valid. Changed, moved, trashed, or duplicated files require reconciliation. [Google Drive custom properties](https://developers.google.com/workspace/drive/api/guides/properties), [Google Drive file search](https://developers.google.com/workspace/drive/api/guides/search-files)

A network timeout or an ambiguous server response may mean Google created the file even though the app did not receive its ID. If a previous pending/unknown operation has no visible search result, the adapter returns `GOOGLE_RECONCILIATION_REQUIRED` and sends no replacement POST. Retry reconciliation later. If the original request definitely never reached Google, an operator must review the checkpoint before clearing it or starting a new campaign version. Do not automatically discard a receipt to force a retry. Google does not support pre-generated IDs for creating converted Google Workspace documents, so blind retries cannot provide a duplicate-free guarantee. [Upload retry limitations](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

Definitive rejected requests, such as access-denied responses, can be retried after the cause is fixed. A successful receipt can be retried without uploading another copy. Changed content requires a new campaign version instead of overwriting the previous deliverable. The adapter prevents concurrent publishes for the same campaign within one instance; a multi-process or multi-server deployment must also serialize publishing at the persistence layer.

## Verification and remaining limits

Unit fixtures cover native-document metadata, multipart bytes, folder placement, PNG/SVG uploads, checkpoint-before-write ordering, successful reuse, recovery after a lost response, refusal to duplicate an unknown write, access-denied retries, storage failures, changed remote files, duplicate matches, input/response bounds, unsafe markup, and concurrent calls.

These tests use an injected fake Google Drive service and make no external writes. Native Google conversion, account scopes, actual Google Docs appearance, and end-user OAuth behavior still need a consented live smoke test. Slack distribution, a production OAuth sign-in/refresh flow, selecting an existing/shared Drive destination, resumable uploads, and direct Google Docs style/batchUpdate parity are not implemented by this adapter.
