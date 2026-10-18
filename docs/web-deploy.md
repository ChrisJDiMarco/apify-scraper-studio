# Running Scraper Studio in a browser

The browser studio is the same app as the Mac version: the same pages, research pipeline, Create content,
Sheets, Ask AI and Settings. One server runs the Mac app's main process (`src/main/index.js`) on a web runtime
(`src/main/web-runtime.js`), and `src/main/studio-server.js` serves it to signed-in browsers. Tests keep the
two in step: every action the Mac app's screens can call is served, with the same inputs (`test/web-parity.test.js`,
`test/web-host.test.js`). Each person has a role, and the server enforces it (see [People and access](#people-and-access)
below, and `docs/roles-and-access.md` for the full matrix).

A ready-to-copy setup (Docker Compose with Caddy and oauth2-proxy, or systemd) is in [`deploy/`](../deploy/README.md).

What changes in a browser:

| Mac app | Browser studio |
| --- | --- |
| Each person's own data on their Mac; you're always the admin | One shared studio. What each person sees and can change depends on their role: Admin, Editor or Channel owner |
| Keys in each Mac's keychain | Keys encrypted on the server with `STUDIO_SECRET_KEY` (or supplied as environment variables) and used for everyone |
| Claude Code on the Mac, or an API key | An Anthropic API key on the server (Claude Code or Codex work too if installed and signed in there; the container image has neither) |
| File dialogs | The browser's file picker uploads the file |
| Save, open and "Show in Finder" | The file downloads; an export folder downloads as one .zip |
| Open data folder or workspace | Not available: folders stay on the server |
| Quitting asks first during a run | Runs continue on the server when tabs close; a server stop lets running work finish first (see [Stopping and updating](#stopping-and-updating)) |

## Run it locally

```bash
npm ci
npm run build:web
# The secret key and admin password go in through standard input, never the environment (see Secrets below).
(umask 077; printf 'STUDIO_SECRET_KEY=%s\nSTUDIO_PASSWORD=%s\n' "$(openssl rand -hex 32)" 'a-long-admin-password' > ~/.scraper-studio-secrets)
STUDIO_DATA_DIR=~/.scraper-studio-web STUDIO_SECRETS_FD=0 npm run start:web < ~/.scraper-studio-secrets
```

Open http://127.0.0.1:4174 and sign in under **Admins** with the admin password. Add people in **People & access**
and send each one their sign-in link. Keep the same `STUDIO_SECRET_KEY` from then on: it decrypts the keys saved in
Settings. The server prints one line saying how people sign in, for example
`Sign-in: admin password, plus personal sign-in links from People (new links work for 30 days).`
On your own computer the secrets file is readable by your user, which is fine for a trial; a shared server should
follow [Secrets](#secrets). Press Ctrl-C to stop; press it again to stop without waiting for running work.

## Hosting on Windows

On a Windows server, run the studio only through Docker with **Linux containers** (Docker Desktop, or Docker on
Windows Server with Linux containers): the image, the deploy kit and every recipe on this page then work unchanged.
Running the server directly on Windows (`npm run start:web` in PowerShell) is for development and trials only. The
protections that keep the secrets away from the AI on the Codex route need Linux: starting as root and switching to
`STUDIO_RUN_AS`, a secrets file the server's own user can't open again, and a process whose memory that user can't
read. The deploy kit's systemd units are Linux-only too.

For a trial on your own Windows PC (this path hasn't been run on Windows yet): PowerShell has no `<` redirect, so use
`STUDIO_SECRETS_FILE` instead of `STUDIO_SECRETS_FD`, and limit the file to your own account with `icacls`:

```powershell
npm ci
npm run build:web
$secrets = Join-Path $env:USERPROFILE '.scraper-studio-secrets'
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$password = 'a-long-admin-password'
Set-Content -Path $secrets -Encoding ascii -Value "STUDIO_SECRET_KEY=$key", "STUDIO_PASSWORD=$password"
icacls $secrets /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(R,W)"
$env:STUDIO_DATA_DIR = Join-Path $env:USERPROFILE '.scraper-studio-web'
$env:STUDIO_SECRETS_FILE = $secrets
npm run start:web
```

The server warns at start that the secrets file is readable by its own user, which is expected here: on the Codex
route the AI could read it, so use an Anthropic API key or the Claude app for trials. The `0700`/`0600` modes the
studio sets on its data folder do nothing on Windows; the folder is protected by your user profile's permissions.
Backups work the same way (`node scripts/studio-backup.cjs --data $env:STUDIO_DATA_DIR --out <folder>`; Windows 10
and 11 include `tar`).

## Configuration

Every variable the browser studio reads. `scripts/studio-web.cjs` lists them too.

**Data**

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDIO_DATA_DIR` | `~/.scraper-studio-web` (`/data` in the image) | Studio data. Back it up (see [Backups](#backups-and-restore)). Only one server process may use it at a time. Created with mode 0700, and tightened to 0700 if it already exists; files the server writes are 0600 (it sets umask 077). |
| `STUDIO_TRANSFER_DIR` | `<STUDIO_DATA_DIR>/web-transfers` | Browser uploads and downloads, mode 0700. Short-lived: uploads go after the request that used them (10 minutes at most), downloads after 10 minutes, and the server empties it at every start. Backups leave it out. |
| `STUDIO_EXPORT_DAYS` | `7` | Export copies older than this are removed at start. |

**Secrets** (see [Secrets](#secrets))

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDIO_SECRETS_FD` | — | An open file descriptor holding the secrets as `NAME=value` lines, usually `0` (standard input). |
| `STUDIO_SECRETS_FILE` | — | A file holding the same lines: a Docker or Compose secret, a Kubernetes Secret volume. Set this or `STUDIO_SECRETS_FD`, not both. |
| `STUDIO_RUN_AS` | `node` in the image | When the server starts as root: the `user` or `user:group` it switches to right after reading the secrets, before it touches the data folder. Without it the server refuses to run as root. |
| `STUDIO_SECRET_KEY` | required | 32+ random characters. Encrypts keys saved in Settings. Losing it means re-entering those keys. A secret: put it in the secrets file. Set as an environment variable it still works, with a startup warning. |
| `STUDIO_PASSWORD` | unless sign-in comes from a proxy | The **admin password**, 16+ characters. It signs in as an admin, so give it only to admins: it's break-glass access. Everyone else signs in with a personal sign-in link. A secret, like the key. |
| `STUDIO_PROXY_SECRET` | — | 16+ characters. When set, the trusted email header is believed only on requests that also carry `X-Studio-Proxy-Secret` with this value. A secret, like the key. |

**Sign-in**

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDIO_LINK_DAYS` | `30` | How long a new sign-in link works; `0` means until it's replaced or turned off. Password mode only. |
| `STUDIO_TRUSTED_EMAIL_HEADER` | — | Company sign-in: the header your sign-in proxy sets with the signed-in email: `x-forwarded-email` (oauth2-proxy in front of the app), `x-auth-request-email` (oauth2-proxy behind nginx `auth_request`) or `cf-access-authenticated-user-email` (Cloudflare Access). |
| `STUDIO_ALLOWED_EMAIL_DOMAINS` | with the header | Comma-separated, e.g. `semrush.com`. Other emails are refused. |
| `STUDIO_TRUSTED_PROXY_CIDRS` | with the header, unless `STUDIO_PROXY_SECRET` | Comma-separated IP addresses or CIDR ranges the sign-in proxy connects from, IPv4 or IPv6, e.g. `127.0.0.1/32,::1/128` (proxy on the same host) or `172.30.10.10/32` (the proxy container in `deploy/compose`). The header from any other address is ignored. With company sign-in the server won't start without this or `STUDIO_PROXY_SECRET`; with both set, a request must pass both. |
| `STUDIO_ADMIN_EMAILS` | with the header | Comma-separated emails that are always enabled admins, e.g. `lead@semrush.com,ops@semrush.com`. They're added to People on first sign-in, and People shows "Set by the server" for them. Also the way back in if nobody can manage People. |
| `STUDIO_PUBLIC_ORIGIN` | — | The public address, e.g. `https://studio.example.com`, when the proxy rewrites `Host`. Requests must come from this page. An `https` address also marks the session cookie Secure. |
| `STUDIO_SECURE_COOKIES` | — | `1` behind HTTPS: marks the session cookie Secure and sends HSTS. |
| `STUDIO_TRUST_PROXY` | — | `1` counts admin-password tries per client, using the address the proxy appends to `X-Forwarded-For`. Set it only when nothing but the proxy can reach the studio; without it every client behind the proxy shares one count. With two proxies in a row (CDN, then nginx), configure the inner one (nginx `real_ip`) so the last address is the client's. |

**Network, limits and timeouts**

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDIO_HOST`, `PORT` | `127.0.0.1:4174`; the image uses `0.0.0.0` | Bind address and port. |
| `STUDIO_DRAIN_SECONDS` | `25` | On SIGTERM or SIGINT, how long running work may finish before it's stopped (0 to 3600). Keep your platform's stop grace period longer. |
| `STUDIO_KEEPALIVE_SECONDS` | `75` | How long an idle proxy connection stays open. Keep it above the proxy's own idle timeout (AWS ALB: 60 s), or a reused connection can fail as a 502. Header timeout is this plus 5 s. |
| `STUDIO_MAX_EVENT_STREAMS` | `200` | Live-update streams for the whole server. Each costs a little memory and gets every broadcast. |
| `STUDIO_MAX_STREAMS_PER_PERSON` | `5` | One person's open tabs; their oldest stream gives way to a new one. |
| `STUDIO_MIN_FREE_MB` | `256` | `/readyz` fails when the data folder has less free space than this. |
| `STUDIO_AI_CONCURRENCY` | off | At most this many AI calls (text and pictures) at once across the studio; the rest wait in line (`src/main/ai-limits.js`). |
| `STUDIO_DAILY_AI_BUDGET_USD` | off | Once the AI spend recorded today (UTC) reaches this, new AI calls are refused until midnight UTC. Codex reports no spend, so its calls aren't counted. |
| `STUDIO_CODEX_USER_CONFIG` | `0` on the web | `1` lets Codex read its own config file (model, provider, MCP servers, hooks); by default the browser studio skips it. |

**Logs**

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDIO_LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug`. See [Logs](#logs). |

**Keys** (prefer saving them in Settings)

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY`, `APIFY_API_TOKEN`, `OPENAI_API_KEY`, `GOOGLE_SHEETS_WEBHOOK_URL`, `GOOGLE_DOCS_ACCESS_TOKEN`, `MONDAY_API_TOKEN` | Server-wide fallbacks for the keys in Settings (`KEY_NAMES` in `src/main/index.js`). A key saved in Settings wins, and turning a key off in Settings turns off its environment copy too. Prefer Settings, where keys are encrypted with the secret key: a key in the server's environment can be read by anything the server starts (see [Secrets](#secrets)). |

The backup scripts also read `STUDIO_BACKUP_DIR` and `STUDIO_BACKUP_KEEP` (see [Backups](#backups-and-restore)).

## Secrets

A process can't take back its starting environment: deleting a variable inside the server leaves it in the
environment block the process started with, and any program running as the same user can read that block
(`/proc/<pid>/environ` on Linux, `ps eww` or `sysctl` on macOS). On the **Codex** AI route the AI is a command-line
agent running as the server's user. The studio runs it in an empty folder with its tools off and a read-only
sandbox, but treat anything that user can read as readable by whoever can prompt it (an editor's Ask AI question, or
source text pasted into a content run). The strongest setup keeps Codex off on a shared server, or runs `codex` as an
OS user that can't read `STUDIO_DATA_DIR`.

So the server reads its secrets once, as `NAME=value` lines, and keeps them only in memory:

```
STUDIO_SECRET_KEY=<64 random hex characters>
STUDIO_PASSWORD=<a long admin password>          # password sign-in only
STUDIO_PROXY_SECRET=<random>                     # optional, see Company sign-in
```

The lines come from `STUDIO_SECRETS_FD` (a file descriptor) or `STUDIO_SECRETS_FILE` (a path). Both survive restarts
the platform makes on its own, as long as the platform reopens them:

- **systemd**: keep the file root-owned with mode 0600 (for example `/etc/scraper-studio/secrets`) and let systemd
  open it as standard input on every start, so the service user can't open it again
  (`deploy/systemd/scraper-studio.service`):

  ```
  [Service]
  User=studio
  StandardInput=file:/etc/scraper-studio/secrets
  Environment=STUDIO_RUNTIME=web STUDIO_SECRETS_FD=0 STUDIO_DATA_DIR=/var/lib/scraper-studio
  ExecStart=/usr/bin/node /opt/scraper-studio/scripts/studio-web.cjs
  ```

- **Docker**: mount the file read-only and name it. The image starts as root only to read it, then runs as the `node`
  user (`STUDIO_RUN_AS=node`), who can't open a root-only file again. Keep the host file `root:root` mode 0400:

  ```bash
  docker run -d --name studio --restart unless-stopped --stop-timeout 150 -p 127.0.0.1:4174:4174 \
    -v studio-data:/data -v /etc/scraper-studio/secrets:/run/secrets/studio:ro -e STUDIO_SECRETS_FILE=/run/secrets/studio \
    -e STUDIO_DRAIN_SECONDS=120 -e STUDIO_PUBLIC_ORIGIN=https://studio.example.com -e STUDIO_SECURE_COOKIES=1 -e STUDIO_TRUST_PROXY=1 \
    scraper-studio
  ```

  That is admin-password sign-in behind a proxy on the same host; add the company sign-in variables for SSO. Piping
  the file into standard input
  (`docker run -i -e STUDIO_SECRETS_FD=0 … < secrets.env`) still works for a trial, but nothing re-feeds it when Docker
  restarts the container on its own, and `-d` never delivers it.
- **Docker Compose**: a file-based `secrets:` entry and `STUDIO_SECRETS_FILE=/run/secrets/<name>`
  (`deploy/compose/docker-compose.yml`). Without Swarm it's a bind mount, so the host file's owner and mode apply:
  `root:root` 0400.
- **Kubernetes**: mount the Secret as a volume with `defaultMode: 0400` and set `STUDIO_SECRETS_FILE`. Don't set
  `fsGroup` to the node user's group (1000), which would let it read the file. A namespace that requires
  `runAsNonRoot` can't start the container as root; run it as user 1000 and the file must then be readable by it (the
  server warns at start that the AI on the Codex route could read it, so keep Codex off there).
- **ECS**: Secrets Manager values arrive as environment variables. Either write them to a root-only file on a shared
  volume from an init container and set `STUDIO_SECRETS_FILE`, or accept the environment.

On Linux, a server that started as root and switched to `STUDIO_RUN_AS` also can't have its memory or starting
environment read by its own user afterwards (the kernel marks it non-dumpable), so in the container even secrets from
the environment are out of the AI's reach; the server then prints no environment warning. Everywhere else, secrets
set as environment variables still work, and the server prints a warning saying so. Server-wide API keys in the
environment are exposed the same way, so save keys in Settings instead.

**Keep the same `STUDIO_SECRET_KEY`**, and back up the secrets file with every data backup. Keys saved under a
different secret key (or by another installation, such as a Mac's keychain) can't be decrypted: at start the server
logs a `secrets-check` line and names them, calls that need one say why, and saving a new value over one is refused
(409 `keyMismatch`) until an admin chooses **Clear** for that key. To change the secret key on purpose, see
[`RUNBOOK.md`](../RUNBOOK.md#rotate-keys-and-secrets).

The AI command-line tools also run without the studio's `STUDIO_*` settings and saved-key variables in their own
environment. On a **macOS** host, the Codex sandbox still lets the AI read another same-user process's starting
environment, so a Mac that serves the browser studio on the Codex route must pass its secrets through
`STUDIO_SECRETS_FD`.

## Company sign-in

Put an SSO proxy in front, such as oauth2-proxy with your Google Workspace or Okta, or Cloudflare Access. It signs
people in and passes the signed-in email in a header. Run the studio with `STUDIO_TRUSTED_EMAIL_HEADER`,
`STUDIO_ALLOWED_EMAIL_DOMAINS`, `STUDIO_ADMIN_EMAILS` and no password.

**The studio believes that header only from the proxy.** Anyone who can reach the studio's port could otherwise send
the header and sign in as an admin. So the server needs one or both of:

- `STUDIO_TRUSTED_PROXY_CIDRS`: the addresses the proxy connects from. On the same host that is
  `127.0.0.1/32,::1/128`. In Docker it is the proxy container's address (Compose: give it a fixed address on an
  internal network, as `deploy/compose` does), not loopback; a proxy on the host reaching a published port arrives
  from the bridge gateway (for example `172.17.0.1`), which every other container can also use, so prefer the secret
  there.
- `STUDIO_PROXY_SECRET`: a secret the proxy adds to every request as `X-Studio-Proxy-Secret`, for proxies whose
  address changes (Kubernetes pods). nginx: `proxy_set_header X-Studio-Proxy-Secret "…";`. Caddy:
  `header_up X-Studio-Proxy-Secret {env.STUDIO_PROXY_SECRET}`. oauth2-proxy's alpha config can inject it with
  `injectRequestHeaders`.

Without either, the server refuses to start. A header from anywhere else is ignored (the request is treated as
signed out) and logged as `untrusted-proxy-header` with the sender's address, at most once a minute per address.
The startup line names what it trusts, for example
`Sign-in: company login through the x-forwarded-email header (semrush.com), trusted only from 172.30.10.10/32; …`.

**The proxy must also strip any copy of the email header the browser sends** and set its own. oauth2-proxy does with
`pass_user_headers`. With nginx `auth_request`, set it from the auth answer (`auth_request_set $email
$upstream_http_x_auth_request_email;` then `proxy_set_header X-Auth-Request-Email $email;`) so a client's copy never
passes through. To check any proxy, sign in, send a request with the header set to someone else's email, and confirm
the studio still shows yours.

**Expired sessions.** When the company session expires, the proxy answers instead of the studio. The page asks for
JSON (`Accept: application/json`, `X-Requested-With: XMLHttpRequest`), which makes oauth2-proxy and Cloudflare
Access answer with a 401 instead of a redirect, and it treats any redirect or HTML sign-in page on `/api/*` the same
way: it shows "Your company sign-in has expired. Reload the page to sign in again." For oauth2-proxy also set
`api_routes = ["^/api/"]`. With nginx `auth_request`, send people to the sign-in page (`error_page 401 …`) only for
page locations, and let a 401 on `/api/` reach the browser. In Cloudflare Access the application's session duration
decides how often people sign in again.

With company sign-in, sign-in links are off and the studio shows no Sign out button: the proxy owns the session.

## Production setup

1. **Server.** Any Linux host or container platform with a persistent volume (on Windows, Docker with Linux
   containers; see [Hosting on Windows](#hosting-on-windows)). One instance only: the studio locks
   its data folder, and research runs and schedules run inside the process. Two CPUs and 4 GB of memory are plenty
   for a team pilot; set a memory limit (Compose `mem_limit`).
2. **Container.** `docker build -t scraper-studio .`, then run it with a volume on `/data`, the variables above and
   the secrets file (see [Secrets](#secrets)), or use `deploy/compose`. Don't publish the container port to the
   internet: only the proxy should reach it. Use a restart policy (`--restart unless-stopped`) and a stop grace period
   longer than `STUDIO_DRAIN_SECONDS` (`docker stop -t 150`, Compose `stop_grace_period: 150s`).
3. **HTTPS and the subdomain.** Point the subdomain (for example `studio.example.com`) at a reverse proxy that
   terminates TLS. The studio needs its own subdomain: its pages and API use absolute paths (`/api/…`) and the session
   cookie uses `Path=/`, so it can't live under a subpath. Caddy does TLS automatically:

   ```
   studio.example.com {
     reverse_proxy 127.0.0.1:4174 {
       flush_interval -1   # live updates use server-sent events
     }
   }
   ```

   With nginx, keep `Host`, turn off buffering for `/api/events` (`proxy_buffering off;`), allow 30 MB request bodies
   (`client_max_body_size 30m;`), and allow long answers (see [Timeouts](#timeouts-and-networks)).
4. **Company sign-in.** See [Company sign-in](#company-sign-in): the header, the proxy trust settings, and the check
   that the proxy strips a forged header.
5. **Keys and spending.** Use company accounts: an Anthropic API key and the shared Apify token. Every run
   still has its own collection and AI budget caps, and estimates show before it starts. `STUDIO_AI_CONCURRENCY` and
   `STUDIO_DAILY_AI_BUDGET_USD` add studio-wide limits. If the Anthropic organization uses zero data retention,
   Claude Fable 5.1 isn't available; set the tagging and report stages to Opus 5.5 in each program.
6. **Health checks.** Point the platform at `/readyz` and `/healthz` (see [Health checks](#health-checks)).
7. **Backups.** Schedule `scripts/studio-backup.cjs` and keep the secrets file with the backups (see
   [Backups](#backups-and-restore)).

## Health checks

Both answer without signing in, never reveal paths, people or counts, and aren't logged.

| Endpoint | Answers | Use it for |
| --- | --- | --- |
| `GET /healthz` | `200 {"ok":true}` whenever the server process answers | Liveness: restart the container when it fails (Kubernetes `livenessProbe`). |
| `GET /readyz` | `200` when ready, `503` otherwise, with `{"ready":…,"version":"0.3.0","checks":{"data":"ok"\|"unwritable","disk":"ok"\|"low","lock":"ok"\|"lost","draining":false\|true}}` | Readiness: the data folder takes a write, has `STUDIO_MIN_FREE_MB` free, this process still holds the data-folder lock, and it isn't stopping. Load balancers, Kubernetes `readinessProbe`, uptime monitors. |

The image's `HEALTHCHECK` probes `/readyz` on the bind address every 30 seconds, so `docker ps` shows the container
unhealthy when the volume fills up or turns read-only. Plain Docker doesn't restart unhealthy containers; alert on
it. Kubernetes ignores the image's `HEALTHCHECK`: set the probes yourself. Behind oauth2-proxy, `skip_auth_routes`
can let an outside monitor reach both (`deploy/compose/oauth2-proxy.cfg.example`).

## Stopping and updating

On SIGTERM or SIGINT (`docker stop`, `systemctl stop`, a Kubernetes rollout, Ctrl-C) the server **drains**:

1. `/readyz` answers 503, and every open tab shows "The studio is restarting for an update."
2. New paid work is refused with 503 and `code: 'restarting'` ("The studio is restarting for an update. Try again in
   a minute."): every non-read method in a capability that spends (starting research, quick scans, writing reports,
   making assets, Ask AI, prompt tests, data tools). Reads, saves outside those capabilities, and Stop still work.
3. Running work (research and content runs, background jobs, AI calls, requests in flight) gets up to
   `STUDIO_DRAIN_SECONDS` to finish.
4. Whatever is still running is stopped, the schedules stop, and the server exits. Stopped runs show "The app stopped
   during this run" after the next start, and Retry finishes them.
5. The data-folder lock is released last, when the process exits, after the stopped work has written its state.

A second signal skips the wait. Give the platform a grace period longer than `STUDIO_DRAIN_SECONDS`, or it kills the
process mid-drain: Docker's default is 10 seconds (`docker stop -t`, Compose `stop_grace_period`), Kubernetes' 30
(`terminationGracePeriodSeconds`), systemd's 90 (`TimeoutStopSec`). `deploy/` uses 120 seconds of drain and 150 of grace.

**After a deploy**, open tabs keep running the old page until reloaded. Every API answer carries the server's build
(`X-Studio-Build`, and the first event of each live-update stream), so a tab that is older than the server shows "A new
version of the studio is ready. Reload to use it." with a Reload button. Sessions live in memory, so people who use a
sign-in link or the admin password sign in again after a restart; company sign-in isn't affected.

**The data-folder lock** (`content-studio/.studio-owner.json`) keeps a second server off the same folder. It records
the process, the host or container, the boot, and a heartbeat refreshed every 30 seconds. A lock left by a killed
server (an OOM kill, `docker kill`, a power cut) is taken over automatically on the next start: when it names this
process's own PID (a container's main process gets the same PID every time), a process that no longer exists, or a
boot that has ended. A lock from another container or machine is taken over once its heartbeat is more than two
minutes old, or after the new server has watched it for 40 seconds without a beat. If the server still says "This
studio data folder is already open in another server" and you are sure no other server uses the folder, delete that
file (and `content-studio/.studio-owner-recovery`, if present) and start again. The lock compares processes and
heartbeats, not a lease, so never run two replicas or a start-first rollout on one volume: use `replicas: 1` and a
stop-then-start update.

## Timeouts and networks

- **Long answers.** An Ask AI answer, a Claude check or a dataset report can take several minutes, and the studio
  server sets no response timeout. Allow the same in front: nginx `proxy_read_timeout 900s;` and
  `proxy_send_timeout 900s;`; oauth2-proxy `upstream_timeout = "900s"` (its default is 30 s); Caddy has no default
  limit. **Cloudflare** cuts proxied requests at 100 seconds (error 524) unless the plan raises it: a long Ask AI answer
  behind Cloudflare can fail even though the work finishes. Ask AI's **Ask again** reuses the question's request ID,
  so it joins the answer already being written instead of paying twice. The server also accepts a request ID on source
  search, scraper runs and tests, and dataset reports, but the browser page doesn't send one for those yet, so a retry
  after a cut-off starts that work again.
- **Keep-alive.** `STUDIO_KEEPALIVE_SECONDS` (75) must stay above the proxy's idle timeout for its upstream
  connections.
- **Live updates** are server-sent events on `GET /api/events`: turn off response buffering for that path (nginx
  `proxy_buffering off;`, Caddy `flush_interval -1`). The server sends a keep-alive comment every 25 seconds.
- **Uploads** are up to 30 MB: nginx `client_max_body_size 30m;`. Node allows 300 seconds to receive a request body.
- **Outbound.** The server calls `api.anthropic.com`, `api.apify.com` (and Apify's dataset storage), `api.openai.com`,
  `docs.googleapis.com`, `www.googleapis.com` and `docs.google.com`/`script.google.com` (Google delivery and the Sheets
  bridge), and `api.monday.com`. With OpenRouter or fal.ai connected (Settings → AI connections) it also calls
  `openrouter.ai`, `queue.fal.run`, `api.fal.ai` and fal's media hosts (`fal.media` and its subdomains;
  `STUDIO_FAL_MEDIA_HOSTS` changes the list). Allow them through the egress firewall. Claude Code and Codex, when used,
  run with the sign-in of the server's user, so every person's work counts against that one plan.
- **Corporate proxies.** Node 24 uses `HTTPS_PROXY`/`NO_PROXY` when `NODE_USE_ENV_PROXY=1` is set (check this against
  the Node patch release you deploy). For TLS inspection, add the inspecting CA with `NODE_EXTRA_CA_CERTS=/path/ca.pem`.

## Instant Monday updates

Settings → Monday.com → **Check Monday for changes: Instantly** registers Monday.com webhooks that POST to
`https://<studio>/hooks/monday/<64-hex secret>`. They need:

- **A public https address.** `STUDIO_PUBLIC_ORIGIN` (or the address admins open the studio on); not localhost, at most
  255 characters with the path. Monday must be able to reach it from the internet.
- **A sign-in bypass for that path only.** oauth2-proxy: add `"POST=^/hooks/monday/[a-f0-9]{64}$"` to
  `skip_auth_routes` (it is in `deploy/compose/oauth2-proxy.cfg.example`). Cloudflare Access: a Bypass policy (or a
  separate application with a Bypass rule) for the path `/hooks/monday/*`. Keep the pattern anchored and exact. The
  secret in the path is the credential; the studio re-reads every change from Monday's API and never trusts the body.
- **Nothing else.** Outbound `api.monday.com` is already in the list below. The route answers 404 for an unknown
  secret, 413 over 64 KB, 429 over 1,200 events a minute and 503 while draining (Monday retries for 30 minutes).

When Monday can't reach the studio, Settings says so and the studio checks Monday every 5 minutes instead. A full check
runs every 6 hours either way, to catch missed events. The Mac app always polls, and only while it is open.

## Live updates and limits

- Each person gets at most `STUDIO_MAX_STREAMS_PER_PERSON` (5) live-update streams, their newest tabs, and the server
  `STUDIO_MAX_EVENT_STREAMS` (200) in all. A tab past the server's limit isn't left silently stale: it shows "Live
  updates are paused: the studio has too many open tabs", catches up every 30 seconds, and goes live again once a slot
  frees. A tab in the background gives its stream back after a minute and reconnects when it's shown again.
- A tab that stops reading (a closed laptop lid, a dead connection) keeps only the newest state in the server's memory
  (about 1 MB at most), and is dropped once it has taken nothing for a minute; the browser reconnects and catches up.
- Uploads: 30 MB each; each person keeps at most 10 unused uploads (the oldest gives way) and the server 1 GB.
  Downloads expire after 10 minutes; each person keeps at most 20 and the server 2 GB of temporary exports.
- At most 1,000 password and sign-in-link sessions at once.

## Logs

The server writes one JSON line per event on stdout (`docker compose logs studio`, `journalctl -u scraper-studio`),
for a log collector to index:

```
{"at":"2026-10-17T12:00:00.000Z","level":"info","event":"request","id":"5f2c0a9e1b3d","method":"POST","route":"/api/rpc","channel":"studio:startResearchRun","status":200,"ms":412,"identity":"member-…"}
```

- `request`: one per API request, with its id (also the `X-Request-Id` response header), method, route, the RPC
  channel, status, duration and who (a member id, `owner` for the admin password, `guest` for someone not in People;
  never an email). Reads and live-update streams log at `debug`, other requests at `info`, failures at `error`.
- `request-failed`: an unexpected failure, with the same id, the error code and a few stack frames. The browser gets
  "Something went wrong on the studio server. Try again, or give an admin this ref: 5f2c0a9e1b3d." and never the
  server's paths or internals; search the logs for that ref.
- `started`, `draining`, `stopping`, `start-failed`; `untrusted-proxy-header`, `stream-refused`, `stream-dropped`,
  `owner-lock-lost`; `unhandled-rejection` and `uncaught-exception`.
- Sign-in, failed sign-in and refused-action lines (`sign-in`, `sign-in-failed`, `denied`) come from the team store
  in the same JSON form, for example `{"event":"sign-in","kind":"link","memberId":"member-…"}`.

No line contains request or response bodies, passwords, link tokens, session cookies, keys or file contents. An
error the server didn't expect is logged and the server keeps serving; an exception nothing caught is logged, the
server stops cleanly and exits 1, and the platform's restart policy starts a fresh one.

## Backups and restore

`STUDIO_DATA_DIR` holds everything: runs, collected posts, reports, workbooks, settings, encrypted keys, Ask AI
conversations and `content-studio/team.json` (people, roles, sign-in links, which trends each channel used, and the
activity log). The secret key isn't in it: **keep the secrets file with the backups**, or a restored studio can't read
its saved keys.

```bash
# While the server runs or after it stopped. Writes <out>/scraper-studio-backup-<time>.tar.gz (0600).
node scripts/studio-backup.cjs --data /var/lib/scraper-studio --out /var/backups/scraper-studio --keep 14
# Check a backup, then restore it (the server must be stopped).
node scripts/studio-restore.cjs --from /var/backups/scraper-studio/scraper-studio-backup-….tar.gz --data /var/lib/scraper-studio
node scripts/studio-restore.cjs --from …tar.gz --data /var/lib/scraper-studio --yes
```

- **Backup** (`--data`, `--out`, `--keep <n>`, `--dir` for a folder instead of an archive; defaults
  `STUDIO_DATA_DIR`, `STUDIO_BACKUP_DIR` or `./studio-backups`, `STUDIO_BACKUP_KEEP`). The studio writes each file
  whole (a temporary file renamed into place), so no file is ever half-written; while the server runs, the script
  copies everything again that changed during the copy until a pass finds nothing new, and the manifest records
  whether it settled. For a strict point-in-time copy, stop the server or take a filesystem snapshot. It leaves out the
  upload and download area, the lock, temporary files and links, and writes a `manifest.json` with each file's size
  and SHA-256, the studio version and the team and state file versions.
- **Restore** refuses while a server holds the folder, checks every file against the manifest, refuses an archive
  with links or files outside it, and refuses a backup whose team file is newer than this studio reads. Without
  `--yes` it only checks. With `--yes` it moves the current data into `<data>/.pre-restore-<time>/` (move it back to
  undo; delete it once the studio works) and the backup's data into place, all inside the data folder, so it works
  on a mounted volume. Run as root, it gives the restored files to the data folder's owner.
- **In Docker**: `docker compose exec studio node scripts/studio-backup.cjs --out /backups --keep 14`, and for a
  restore `docker compose stop studio`, then
  `docker compose run --rm --no-deps studio node scripts/studio-restore.cjs --from /backups/<file> --yes`.
  systemd: `deploy/systemd/scraper-studio-backup.timer` backs up every night.
- **After a restore**, start with the same `STUDIO_SECRET_KEY`, then check **People & access**: anyone added since
  the backup is missing, anyone removed since is back, and links made since don't work. Fix those and send new links
  where needed. Runs that were in progress when the backup was made show as stopped; Retry finishes them.
- Practise a restore into a spare folder every quarter.

## Moving the Mac app's data to the server

Copy the Mac data folder (`~/Library/Application Support/apify-scraper-studio`) into `STUDIO_DATA_DIR` while
both the Mac app and the server are stopped. Older records that stored full Mac file paths are re-anchored on
the new folder automatically. Keys saved on the Mac are locked to its keychain, so save them again in
Settings (or set them as environment variables). The Windows app's folder (`%APPDATA%\apify-scraper-studio`) can be
copied the same way, with two differences: records that stored a full Windows file path (`C:\…`) are not re-anchored
on a Linux server, so those older exports and pictures keep pointing at the Windows folder, and its keys are locked to
that Windows user (DPAPI), so save them again too. A team setup file (Settings → Share your setup) is the lighter
alternative when you only need the knowledge, products, taxonomy and programs.

## People and access

Everyone who signs in has one role. The server checks it on every request, so hiding a button is never the only
thing stopping someone.

| Role | What they get |
| --- | --- |
| Admin | Everything, including settings, people and analytics. |
| Editor | Finds trends, writes and edits reports, makes assets for any channel. |
| Channel owner | Sees new trends and their channel's assets, and says which trends they used. |

Someone who signs in but isn't in People, or whose access is turned off, sees a "not in this studio yet" (or
"paused") screen naming the admins to ask, and nothing else. Admins can preview what an editor or a channel owner
sees with **View as** in the account menu at the foot of the sidebar. A preview is never saved: it lasts until the
admin switches back, signs out or the server restarts, and buttons that change things are off while it's on.

### How people sign in

Pick one of the two setups.

**Company sign-in (SSO), recommended.** The proxy signs people in with their work account (see
[Company sign-in](#company-sign-in)). The studio matches the email to People, ignoring case. `STUDIO_ADMIN_EMAILS`
lists the people who are always admins: they're added on first sign-in and can't be demoted or removed in People.
Everyone else needs adding in People by an admin.

**Admin password plus personal sign-in links.** Without a proxy, `STUDIO_PASSWORD` is the admin password. It always
signs in as an admin, so only admins should know it. Everyone else gets a personal sign-in link:

1. An admin adds the person in **People & access** and chooses **Make a new sign-in link**.
2. The admin sends the link (`https://studio.example.com/#signin=…`). The part after `#` never reaches the server or
   its logs, and the page removes it from the address bar as soon as it opens.
3. Opening the link signs that browser in for 30 days. The link itself works for `STUDIO_LINK_DAYS` days (default
   30), and can be used again on another browser or after being signed out.
4. Making a new link, or **Turn off link**, signs out every browser that used the old one. Disabling or removing a
   person ends their access at once. An admin password session lasts 12 hours.

These sessions are kept in memory, so a restart or deploy signs out everyone who used a link or the admin password.
People with links open their link again; admins use the password again. Company sign-in isn't affected.

### Rollout

Before roles, everyone who could sign in had full access. To switch over without a gap:

1. With SSO, set `STUDIO_ADMIN_EMAILS` to the admins' emails. With the password, set a **new** `STUDIO_PASSWORD`
   that only admins know, passed through the secrets file (see [Secrets](#secrets)): anyone who still has the old
   team password would otherwise sign in as an admin.
2. Restart the server, sign in as an admin, and add the editors and channel owners in **People & access**. Each
   channel owner gets one channel.
3. In password mode, send each person their sign-in link.
4. Announce the studio's address.

**Recovery.** If nobody can manage People (the last admin left, or an admin was turned off by mistake), add your
email to `STUDIO_ADMIN_EMAILS` and restart: that email is an admin again. In password mode, the admin password
always signs in as an admin; if it's lost, set a new `STUDIO_PASSWORD` and restart.

### What stays shared

Roles decide who can see and change what, but a few things are still one setting for the whole studio:

- **The active content workspace.** Everyone, channel owners included, works in the workspace an admin selects.
  Only admins can switch it, and switching moves everyone.
- **The selected brand profile.** Selecting one changes it for everyone who writes with it.
- **Connected accounts and keys.** Editors import and publish Google files, and send to Monday, through the
  accounts connected in Settings. Connect a dedicated studio account that only has the team's folders shared.
- **On the Codex route** the AI is a command-line agent running as the server's user. Saved keys stay encrypted,
  and the key that decrypts them is safe only when it came in through the secrets file or descriptor (see
  [Secrets](#secrets)); a secret or API key in the server's environment can be read by the AI.

## Security notes

- Every request needs a session (admin password or sign-in link) or a trusted-proxy email, except the health checks,
  which reveal nothing private. Admin-password tries are limited to ten a minute per client (per proxy-forwarded
  client with `STUDIO_TRUST_PROXY=1`). Sign-in link tries aren't counted: a link token is 32 random bytes, and
  counting them would let anyone lock everyone out.
- The email header is believed only from `STUDIO_TRUSTED_PROXY_CIDRS` and/or with `STUDIO_PROXY_SECRET`; the server
  won't start with company sign-in and neither set.
- Every action is checked against the person's role on the server, including live updates: each browser receives
  only the state its role may see, and a stream closes when its person signs out, loses access or has their link
  replaced.
- State-changing requests must come from the studio's own page (same origin); there is no cross-site access.
- The page never receives server file paths or key values; Settings shows only whether a key is saved. An unexpected
  server error reaches the browser as a reference, never as the raw error.
- Uploads are limited to 30 MB, used once and deleted after the request. Only people whose role can import a file
  can upload (admins, and editor-based roles with Write reports, Sheets, Data tools or Brand knowledge); channel roles
  and View as previews never can. An upload or a download belongs to the person who made it; downloads expire after
  10 minutes, and the transfer area is emptied at every start.
- The data folder is 0700 and the files the server writes 0600, so other accounts on the host can't read them.
- Strict Content Security Policy, no framing, `nosniff`, and no third-party scripts or fonts.
- The server logs metadata only (see [Logs](#logs)): never passwords, link tokens, session cookies, keys or request
  contents.
- The secrets come in through `STUDIO_SECRETS_FD` or `STUDIO_SECRETS_FILE` and live only in the server's memory (see
  [Secrets](#secrets)). The container reads a root-only secrets file as root, then runs as `node`.
