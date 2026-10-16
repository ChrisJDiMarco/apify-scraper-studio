# Running Scraper Studio in a browser

The browser studio is the same app as the Mac version: the same pages, research pipeline, Create content,
Sheets, Ask AI and Settings. One server runs the Mac app's main process (`src/main/index.js`) on a web runtime
(`src/main/web-runtime.js`), and `src/main/studio-server.js` serves it to signed-in browsers. Tests keep the
two in step: every action the Mac app's screens can call is served, with the same inputs (`test/web-parity.test.js`,
`test/web-host.test.js`). Each person has a role, and the server enforces it (see [People and roles](#people-and-roles)
below, and `docs/roles-and-access.md` for the full matrix).

What changes in a browser:

| Mac app | Browser studio |
| --- | --- |
| Each person's own data on their Mac; you're always the admin | One shared studio. What each person sees and can change depends on their role: Admin, Editor or Channel owner |
| Keys in each Mac's keychain | Keys encrypted on the server with `STUDIO_SECRET_KEY` (or supplied as environment variables) and used for everyone |
| Claude Code on the Mac, or an API key | An Anthropic API key on the server (Claude Code works too if it's installed and signed in there) |
| File dialogs | The browser's file picker uploads the file |
| Save, open and "Show in Finder" | The file downloads; an export folder downloads as one .zip |
| Open data folder or workspace | Not available: folders stay on the server |
| Quitting asks first during a run | Runs continue on the server when tabs close |

## Run it locally

```bash
npm ci
npm run build:web
# The secret key and admin password go in through standard input, never the environment (see Secrets below).
(umask 077; printf 'STUDIO_SECRET_KEY=%s\nSTUDIO_PASSWORD=%s\n' "$(openssl rand -hex 32)" 'a-long-admin-password' > ~/.scraper-studio-secrets)
STUDIO_DATA_DIR=~/.scraper-studio-web STUDIO_SECRETS_FD=0 npm run start:web < ~/.scraper-studio-secrets
```

Open http://127.0.0.1:4174 and sign in under **Admins** with the admin password. Add people in **People & roles**
and send each one their sign-in link. Keep the same `STUDIO_SECRET_KEY` from then on: it decrypts the keys saved in
Settings. The server prints one line saying how people sign in, for example
`Sign-in: admin password, plus personal sign-in links from People (new links work for 30 days).`
On your own computer the secrets file is readable by your user, which is fine for a trial; a shared server should
follow [Secrets](#secrets).

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `STUDIO_DATA_DIR` | yes (default `~/.scraper-studio-web`) | Studio data. Back this folder up. Only one server process may use it at a time. |
| `STUDIO_SECRETS_FD` | recommended | The file descriptor the server reads `STUDIO_SECRET_KEY` and `STUDIO_PASSWORD` from, as `NAME=value` lines, usually `0` (standard input). See [Secrets](#secrets). |
| `STUDIO_SECRET_KEY` | yes | 32+ random characters. Encrypts keys saved in Settings. Losing it means re-entering those keys. Pass it through `STUDIO_SECRETS_FD`; set as an environment variable it still works, with a startup warning. |
| `STUDIO_PASSWORD` | unless sign-in comes from a proxy | The **admin password**, 16+ characters. It signs in as an admin, so give it only to admins: it's break-glass access. Everyone else signs in with a personal sign-in link. Pass it through `STUDIO_SECRETS_FD`, like the secret key. |
| `STUDIO_LINK_DAYS` | no | How long a new sign-in link works. Default `30`; `0` means until it's replaced or turned off. Password mode only. |
| `STUDIO_TRUSTED_EMAIL_HEADER` | for company sign-in | Header your sign-in proxy sets with the signed-in email: `x-forwarded-email` (oauth2-proxy in front of the app), `x-auth-request-email` (oauth2-proxy behind nginx `auth_request`) or `cf-access-authenticated-user-email` (Cloudflare Access). |
| `STUDIO_ALLOWED_EMAIL_DOMAINS` | with the header | Comma-separated, e.g. `semrush.com`. Other emails are refused. |
| `STUDIO_ADMIN_EMAILS` | with the header | Comma-separated emails that are always enabled admins, e.g. `lead@semrush.com,ops@semrush.com`. They're added to People on first sign-in, and People shows "Set by the server" for them. Also the way back in if nobody can manage People. |
| `STUDIO_PUBLIC_ORIGIN` | if the proxy rewrites `Host` | The public address, e.g. `https://studio.example.com`. Requests must come from this page. An `https` address also marks the session cookie Secure. |
| `STUDIO_SECURE_COOKIES` | behind HTTPS | `1` marks the session cookie Secure and sends HSTS. |
| `STUDIO_TRUST_PROXY` | behind the reverse proxy | `1` counts admin-password tries per client, using the address the proxy appends to `X-Forwarded-For`. Set it only when nothing but the proxy can reach the studio; without it every client behind the proxy shares one count. |
| `STUDIO_HOST`, `PORT` | no | Bind address and port. Default `127.0.0.1:4174`; the container uses `0.0.0.0`. |
| `ANTHROPIC_API_KEY`, `APIFY_API_TOKEN`, `OPENAI_API_KEY` | no | Server-wide keys. Prefer saving them in Settings, where they're encrypted with the secret key: a key in the server's environment can be read by anything the server starts (see [Secrets](#secrets)). |

## Secrets

A process can't take back its starting environment: deleting a variable inside the server leaves it in the
environment block the process started with, and any program running as the same user can read that block
(`/proc/<pid>/environ` on Linux, `ps eww` or `sysctl` on macOS). On the **Codex** AI route the AI runs shell commands
as the server's user, so anyone who can prompt it (an editor's Ask AI question, or source text pasted into a content
run) could otherwise print the admin password and the key that decrypts every saved key.

So the server reads its two secrets once, from the file descriptor named by `STUDIO_SECRETS_FD`, and keeps them only
in memory. The descriptor holds `NAME=value` lines:

```
STUDIO_SECRET_KEY=<64 random hex characters>
STUDIO_PASSWORD=<a long admin password>
```

- **systemd**: keep the file root-owned with mode 0600 (for example `/etc/scraper-studio/secrets`) and let systemd open
  it for the service, so the service user can't open it again:

  ```
  [Service]
  User=studio
  Environment=STUDIO_RUNTIME=web STUDIO_DATA_DIR=/srv/studio STUDIO_SECRETS_FD=0 STUDIO_TRUST_PROXY=1
  StandardInput=file:/etc/scraper-studio/secrets
  ExecStart=/usr/bin/node /opt/scraper-studio/scripts/studio-web.cjs
  ```

- **Docker**: keep the file on the host and pipe it in: `docker run -i -e STUDIO_SECRETS_FD=0 … scraper-studio < secrets.env`.
  Don't mount it into the container or pass the secrets with `-e`.

Secrets set as environment variables still work, and the server prints a warning saying so. Server-wide API keys in
the environment (`ANTHROPIC_API_KEY` and the rest) are exposed the same way, so save keys in Settings instead.

The AI command-line tools also run without the studio's `STUDIO_*` settings and saved-key variables in their own
environment. That doesn't stop them reading the server's starting environment, which is why the secrets come in
through the descriptor. On a **macOS** host, the Codex sandbox (workspace-write) still lets the AI read another
same-user process's starting environment, so a Mac that serves the browser studio on the Codex route must pass its
secrets through `STUDIO_SECRETS_FD`.

## Production setup

1. **Server.** Any Linux host or container platform with a persistent volume. One instance only: the studio
   locks its data folder, and research runs and schedules run inside the process. Two CPUs and 4 GB of memory
   are plenty for a team pilot.
2. **Container.** `docker build -t scraper-studio .` then run it with a volume on `/data`, the variables above and
   the secrets piped in (see [Secrets](#secrets)). Don't publish the container port to the internet. Only the proxy
   should reach it.
3. **HTTPS and the subdomain.** Point the subdomain (for example `studio.example.com`) at a reverse proxy that
   terminates TLS. Caddy does this automatically:

   ```
   studio.example.com {
     reverse_proxy 127.0.0.1:4174 {
       flush_interval -1   # live updates use server-sent events
     }
   }
   ```

   With nginx, keep `Host`, turn off buffering for `/api/events` (`proxy_buffering off;`), allow 30 MB request
   bodies (`client_max_body_size 30m;`), and set `proxy_read_timeout 300s;` (an Ask AI answer or a Claude check can
   take a few minutes).
4. **Company sign-in.** Put an SSO proxy in front, such as oauth2-proxy with your Google Workspace or Okta, or
   Cloudflare Access. Let it set the signed-in email header, then run the studio with
   `STUDIO_TRUSTED_EMAIL_HEADER`, `STUDIO_ALLOWED_EMAIL_DOMAINS`, `STUDIO_ADMIN_EMAILS` and no password. The studio
   trusts that header only because nothing but the proxy can reach it, so keep it bound to localhost or a private
   network. **The proxy must strip any copy of the email header the browser sends** and set its own; otherwise
   anyone could claim to be an admin by sending the header themselves. With nginx `auth_request`, set it from the
   auth answer (`auth_request_set $email $upstream_http_x_auth_request_email;` then
   `proxy_set_header X-Auth-Request-Email $email;`) so a client's copy never passes through. To check any proxy,
   sign in, send a request with the header set to someone else's email, and confirm the studio still shows yours.
5. **Keys and spending.** Use company accounts: an Anthropic API key and the shared Apify token. Every run
   still has its own collection and AI budget caps, and estimates show before it starts. If the Anthropic
   organization uses zero data retention, Claude Fable 5.1 isn't available; set the tagging and report stages
   to Opus 5.5 in each program.
6. **Backups.** Snapshot `STUDIO_DATA_DIR` daily. It holds everything: runs, collected posts, reports,
   workbooks, settings, encrypted keys, and `content-studio/team.json` (people, roles, sign-in links, which trends
   each channel used, and the activity log). team.json moves with the data folder. After restoring an older
   snapshot, check **People & roles**: anyone added since the snapshot is missing, anyone removed since is back, and
   links made since don't work. Fix those and send new links where needed.

## Moving the Mac app's data to the server

Copy the Mac data folder (`~/Library/Application Support/apify-scraper-studio`) into `STUDIO_DATA_DIR` while
both the Mac app and the server are stopped. Older records that stored full Mac file paths are re-anchored on
the new folder automatically. Keys saved on the Mac are locked to its keychain, so save them again in
Settings (or set them as environment variables). A team setup file (Settings → Share your setup) is the lighter
alternative when you only need the knowledge, products, taxonomy and programs.

## People and roles

Everyone who signs in has one role. The server checks it on every request, so hiding a button is never the only
thing stopping someone.

| Role | What they get |
| --- | --- |
| Admin | Everything, including settings, people and analytics. |
| Editor | Finds trends, writes and edits reports, makes assets for any channel. |
| Channel owner | Sees new trends and their channel's assets, and says which trends they used. |

Someone who signs in but isn't in People, or whose access is turned off, sees a "not in this studio yet" (or
"paused") screen naming the admins to ask, and nothing else. Admins can preview what an editor or a channel owner
sees with **View as** in the sidebar. A preview is never saved: it lasts until the admin switches back, signs out
or the server restarts, and buttons that change things are off while it's on.

### How people sign in

Pick one of the two setups.

**Company sign-in (SSO), recommended.** The proxy (step 4 above) signs people in with their work account. The studio
matches the email to People, ignoring case. `STUDIO_ADMIN_EMAILS` lists the people who are always admins: they're
added on first sign-in and can't be demoted or removed in People. Everyone else needs adding in People by an
admin. Sign-in links are off in this setup, and the studio shows no Sign out button: the proxy owns the session.

**Admin password plus personal sign-in links.** Without a proxy, `STUDIO_PASSWORD` is the admin password. It always
signs in as an admin, so only admins should know it. Everyone else gets a personal sign-in link:

1. An admin adds the person in **People & roles** and chooses **Make a new sign-in link**.
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
   that only admins know, passed through `STUDIO_SECRETS_FD` (see [Secrets](#secrets)): anyone who still has the old
   team password would otherwise sign in as an admin.
2. Restart the server, sign in as an admin, and add the editors and channel owners in **People & roles**. Each
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
- **On the Codex route** the AI runs shell commands as the server's user, with access to the data folder. Saved keys
  there stay encrypted, and the key that decrypts them is safe only when it came in through `STUDIO_SECRETS_FD` (see
  [Secrets](#secrets)); a secret or API key in the server's environment can be read by the AI.

## Security notes

- Every request needs a session (admin password or sign-in link) or a trusted-proxy email. Admin-password tries are
  limited to ten a minute per client (per proxy-forwarded client with `STUDIO_TRUST_PROXY=1`). Sign-in link tries
  aren't counted: a link token is 32 random bytes, and counting them would let anyone lock everyone out.
- Each person gets at most five live-update streams (their newest tabs), and the server 50 in all, so no one person can
  take every slot.
- Every action is checked against the person's role on the server, including live updates: each browser receives
  only the state its role may see, and a stream closes when its person signs out, loses access or has their link
  replaced.
- State-changing requests must come from the studio's own page (same origin); there is no cross-site access.
- The page never receives server file paths or key values; Settings shows only whether a key is saved.
- Uploads are limited to 30 MB, used once, deleted after the request, and only admins and editors can upload. An
  upload or a download belongs to the person who made it; downloads expire after 10 minutes.
- Strict Content Security Policy, no framing, `nosniff`, and no third-party scripts or fonts.
- The server writes one JSON line to its log for each sign-in, failed sign-in and refused action, for example
  `{"event":"sign-in","kind":"link","memberId":"member-…"}`. Lines never contain passwords, link tokens, session
  cookies or request contents.
- The secret key and admin password come in through `STUDIO_SECRETS_FD` and live only in the server's memory (see
  [Secrets](#secrets)). Set in the environment instead, they still work, with a startup warning, because anything the
  server starts can read its starting environment. The AI command-line tools run without the studio's `STUDIO_*`
  settings or saved-key variables in their own environment.
