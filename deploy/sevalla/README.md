# Golden Thread on Sevalla

Production URL: https://goldenthread.searchengineland.com

- Application: `Golden Thread` (`718fb8c4-ca26-40ae-ac81-ba4c70616ceb`).
- Region: Ashburn, USA.
- Source: `ChrisJDiMarco/apify-scraper-studio`, branch `main`, root `Dockerfile`.
- Process: one S1 web instance (0.5 vCPU, 1 GB RAM), port 4174; hibernation and automatic deployments off.
- Disk: 10 GB mounted at `/data`. Keep exactly one instance attached to this disk.
- Health checks: `/healthz` for liveness, `/readyz` for readiness.
- Admin: `john.blanchard@semrush.com`. Password sign-in plus admin-provisioned personal links.
- DNS: `goldenthread` CNAME to `to.sevalla.app`, DNS only, in Cloudflare's `searchengineland.com` zone.
- TLS: Sevalla-managed certificate, active; its requested `_acme-challenge.goldenthread` TXT record is also in Cloudflare.
- Base price approved: $10/month compute + $3/month disk; builds, bandwidth, tax and API usage extra.

## Verification on October 21, 2026

- Deployed GitHub commit `562b085` (version 0.3.0). Initial deployment:
  `2cc4828e-b2b0-4f40-af61-07308cd0e297`; restart verification:
  `82d5555e-8702-441d-98c5-c4bdeb827517`. Both completed successfully.
- The custom domain is verified, has an active SSL certificate, and is the primary domain.
- HTTPS `/readyz` returned 200 with `ready: true` and data, disk and lock checks all `ok`.
- Unauthenticated API requests returned 401; a cross-origin login request returned 403.
- Admin-password sign-in succeeded; its session cookie is Secure and HttpOnly.
- Exactly one provisioned member: John Blanchard, `john.blanchard@semrush.com`, Admin.
- After restarting the existing build, the same password worked and the admin record persisted.
- No Apify or AI runs were started, and no vendor API credentials were imported.
- Observed idle startup memory was about 110 MB; research workload capacity is unverified.

## Credentials and data

Production started with an empty disk and newly generated credentials. No local test data, passwords or API keys
were imported. The locally generated production credentials are in the ignored root `.env.production` file
(permissions 0600). Keep its encryption key and admin password in the company's password manager; never commit them.
API keys should be added separately in the production app's Settings.

The secrets are encrypted runtime-only Sevalla environment variables. The Docker image starts as root and the
app drops to `node` after reading them; the current Linux runtime uses that privilege drop to prevent its AI
subprocesses from reading its starting environment. Do not change the container to start as `node` without also
switching secrets to a root-only file or file descriptor (see `docs/web-deploy.md`).

The process start command loads `GT_BACKUP_LAUNCHER_B64` into the root-owned
`/run/golden-thread-backups/runner.cjs` and runs its supervisor. The supervisor prepares disk ownership,
takes and verifies a pre-start backup, then starts `scripts/studio-web.cjs`. The app drops to `node` as before.
Keep this process start command when deploying GitHub updates.

`STUDIO_AI_CONCURRENCY=1` limits concurrent AI requests on the small instance. This does not cap total spending.
Personal links are bearer credentials: the admin should provision only `semrush.com` addresses. Password/link
mode does not verify company email ownership or enforce the SSO-only domain allowlist.

## Email (off until configured)

The studio can email invites (each person's own sign-in link) and tell admins when someone signs in for the first
time. It sends nothing until `EMAIL_PROVIDER` is set; see [docs/web-deploy.md](../../docs/web-deploy.md#email). To
turn it on, add these as Sevalla environment variables (the key or password as an encrypted runtime-only variable,
like `STUDIO_PASSWORD`; the server removes it from its environment at start), then deploy or restart:

| Variable | Resend | Any SMTP service |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `resend` | `smtp` |
| `EMAIL_FROM` | e.g. `Golden Thread <studio@searchengineland.com>`, on a domain verified with the service | same |
| `RESEND_API_KEY` | the API key (secret) | — |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` | — | from the service, e.g. `smtp.sendgrid.net`, `587`, `apikey` |
| `SMTP_PASSWORD` | — | the SMTP password or API key (secret) |
| `STUDIO_PUBLIC_ORIGIN` | `https://goldenthread.searchengineland.com`, if not already set (the first-sign-in email links to it) | same |

Verifying the sender's domain means adding the service's DNS records (SPF/DKIM) to the `searchengineland.com` zone
in Cloudflare. To check the emails first without an account, set `EMAIL_PROVIDER=preview`: each email is written to
`/data/email-preview/` as an `.eml` file instead of being sent. Those files contain real sign-in links; delete the
folder and switch preview off afterwards. Look for `email-sent`, `email-failed` and `email-not-ready` in the logs.

## Updates

Use Sevalla's manual Deploy action for the latest reviewed `main` commit. The public-Git source does not support
automatic deployments from Git pushes; that requires a connected private-Git integration. The MCP connection
can trigger and inspect deployments manually.

The supervisor automatically takes a pre-start backup while the studio is stopped, before the new app process
opens the data folder. It verifies that backup before starting the app. If backup storage is unavailable or the
backup fails verification, startup fails; fix the backup problem before retrying. Reuse the existing disk,
secrets, backup environment variables and process start command. Allow running work to drain when replacing
the instance; password/link sessions must sign in again after restart. Check `/readyz`, sign-in, saved settings
and People after deployment.

Keep the last working image/commit. A rollback that changes the stored-data format may also require restoring
the corresponding backup. Never delete the disk when replacing a container or deployment.

## Encrypted off-host backups

- Bucket: **Golden Thread Backups**, `golden-thread-backups-dvaai`, ID `6550e88e-7623-4c52-8a98-d9c0e1c6781a`.
- Private Sevalla object storage in Eastern North America; public access is off.
- Nightly at **2 a.m. America/Los_Angeles**; on the spring DST day when 2 a.m. does not exist, it runs at 3 a.m.
- Retains the newest **14 daily archives**, plus **3 pre-start/manual deployment archives**.
- A backup runs in the same container as the app; there is no separately billed worker or cron process.
- Runs the app's `studio-backup.cjs`, encrypts the archive with AES-256-GCM, uploads it over HTTPS, downloads it
  again, compares SHA-256, decrypts it, and actually restores it into an isolated temporary folder. Live data is
  never replaced by verification. Old backups are pruned only after the new backup passes these checks.
- Nightly backups are live copies that must settle. They are not strict filesystem snapshots. Pre-start backups
  are taken with no running studio process. No backup contains the studio encryption key or backup storage keys.
- Temporary archive and recovery files are deleted after each attempt. Insufficient scratch-disk space,
  unsettled files, damaged JSON and archives exceeding the 5-GiB single-upload limit cause a logged failure.
- Failed nightly attempts retry every 15 minutes after 2 a.m.; `backup-failed` is logged at error level.
  Logs are the failure signal; no email, Slack notification or external monitor is configured.

### Budget guard

At the listed $0.02/GB/month storage rate, the supervisor refuses an upload if total bucket objects plus the
new encrypted archive would exceed **95 GB** (about $1.90/month of storage), leaving a margin below the approved
$2/month storage budget. This is an application guard, not a Sevalla billing cap. Taxes and other charges are
separate. Do not put unrelated objects in this bucket or change storage pricing without revisiting the guard.
If full backups grow too large to retain 14 days within this limit, backups fail visibly in the logs rather
than deleting extra recovery points or exceeding the guard. Revisit retention or budget then.

### Credentials

The `GT_BACKUP_*` runtime-only Sevalla variables hold the storage endpoint, bucket, bucket-scoped access keys,
archive-encryption key and launcher bundle. The supervisor runs as root, writes its configuration to a root-only
directory, and strips **all** `GT_BACKUP_*` variables before spawning the web process. Do not run this supervisor
as `node` or move its configuration into `/data`.

The archive-encryption key is also saved in the ignored local `.env.production.backups` file (0600).
Save it in the company password manager alongside the separate `STUDIO_SECRET_KEY` from `.env.production`.
Both are required for full recovery: the backup key opens an archive, and the studio key decrypts the API keys
inside the restored data. Neither key should be put in the object-storage bucket.

### Manual verification and maintenance

Installed and verified on October 21, 2026. Deployment `c26b448b-bad5-4ad1-9e5d-23e731a5cae3`
completed successfully. The production launcher's SHA-256 matches the local source:
`ef463b4dcabe485e1d57d51cb78b8a96cdd4b55546e08dd3fee9208ec9789c36`.
The initial daily-path backup and pre-start backups each uploaded, downloaded, decrypted and restored all
7 production files successfully. Credential isolation was tested as UID 1000: the web user could read neither
the root-only backup configuration nor the supervisor's environment. HTTPS readiness and admin sign-in were
checked again after deployment. The first scheduled overnight execution is October 22 at 2 a.m. Pacific;
the daily path was exercised manually during installation.

In Sevalla's root web terminal, or through the MCP process-exec operation:

```sh
# Extra deployment backup, including upload/download/decrypt/isolated-restore checks.
node /run/golden-thread-backups/runner.cjs --once

# Manually exercise the daily backup path (counts toward the 14 daily archives).
node /run/golden-thread-backups/runner.cjs --once --daily

# Last successful backup receipt; contains no credentials.
cat /run/golden-thread-backups/last-success.json
```

The launcher source is `deploy/sevalla/backup-supervisor.cjs`; its focused tests run with
`npm test -- deploy/sevalla/backup-supervisor.test.mjs`. To change it, base64-encode that file into the
`GT_BACKUP_LAUNCHER_B64` runtime variable and restart the current build. It lives in runtime configuration,
so a regular upstream GitHub deployment retains it without modifying the upstream image.

### Disaster recovery

1. Download the selected encrypted `.tar.gz.enc` object from the private bucket.
2. Recover the archive-encryption key and the original `STUDIO_SECRET_KEY` from the password manager.
3. Use the supervisor's exported `decrypt(source, target, key)` function to produce a `.tar.gz` archive.
4. With a compatible app checkout, use `scripts/studio-restore.cjs --from <archive> --data <spare-folder>` to
   validate it. Restore with `--yes` into an isolated replacement folder first and inspect People and settings.
5. Stop the production studio, restore to its disk using the documented procedure in `docs/web-deploy.md`,
   and start with the original studio encryption key. Never restore over a running studio.
6. Review People: members and link revocations made after the backup will not be reflected. Revoke or replace
   links as necessary before reopening access. Run a separate restore drill quarterly.
