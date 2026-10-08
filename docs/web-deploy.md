# Running Scraper Studio in a browser

The browser studio is the same app as the Mac version: the same pages, research pipeline, Create content,
Sheets, Ask AI and Settings. One server runs the Mac app's main process (`src/main/index.js`) on a web runtime
(`src/main/web-runtime.js`), and `src/main/studio-server.js` serves it to signed-in browsers. Tests keep the
two in step: every action the Mac app's screens can call is served, with the same inputs (`test/web-parity.test.js`,
`test/web-host.test.js`).

What changes in a browser:

| Mac app | Browser studio |
| --- | --- |
| Each person's own data on their Mac | One shared studio: everyone signed in sees the same workspaces, programs, runs and Library |
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
STUDIO_DATA_DIR=~/.scraper-studio-web \
STUDIO_SECRET_KEY="$(openssl rand -hex 32)" \
STUDIO_PASSWORD="a-long-team-password" \
npm run start:web
```

Open http://127.0.0.1:4174 and sign in with the password. Keep the same `STUDIO_SECRET_KEY` from then on: it
decrypts the keys saved in Settings.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `STUDIO_DATA_DIR` | yes (default `~/.scraper-studio-web`) | Studio data. Back this folder up. Only one server process may use it at a time. |
| `STUDIO_SECRET_KEY` | yes | 32+ random characters. Encrypts keys saved in Settings. Losing it means re-entering those keys. |
| `STUDIO_PASSWORD` | unless sign-in comes from a proxy | Shared team password, 16+ characters. |
| `STUDIO_TRUSTED_EMAIL_HEADER` | for company sign-in | Header your sign-in proxy sets with the signed-in email, e.g. `x-auth-request-email` (oauth2-proxy) or `cf-access-authenticated-user-email` (Cloudflare Access). |
| `STUDIO_ALLOWED_EMAIL_DOMAINS` | with the header | Comma-separated, e.g. `semrush.com`. Other emails are refused. |
| `STUDIO_PUBLIC_ORIGIN` | if the proxy rewrites `Host` | The public address, e.g. `https://studio.example.com`. Requests must come from this page. |
| `STUDIO_SECURE_COOKIES` | behind HTTPS | `1` marks the session cookie Secure and sends HSTS. |
| `STUDIO_HOST`, `PORT` | no | Bind address and port. Default `127.0.0.1:4174`; the container uses `0.0.0.0`. |
| `ANTHROPIC_API_KEY`, `APIFY_API_TOKEN`, `OPENAI_API_KEY` | no | Server-wide keys. Alternatively, save them in Settings. |

## Production setup

1. **Server.** Any Linux host or container platform with a persistent volume. One instance only: the studio
   locks its data folder, and research runs and schedules run inside the process. Two CPUs and 4 GB of memory
   are plenty for a team pilot.
2. **Container.** `docker build -t scraper-studio .` then run it with a volume on `/data` and the variables
   above. Don't publish the container port to the internet. Only the proxy should reach it.
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
   `STUDIO_TRUSTED_EMAIL_HEADER`, `STUDIO_ALLOWED_EMAIL_DOMAINS` and no password. The studio trusts that header
   only because nothing but the proxy can reach it, so keep it bound to localhost or a private network.
5. **Keys and spending.** Use company accounts: an Anthropic API key and the shared Apify token. Every run
   still has its own collection and AI budget caps, and estimates show before it starts. If the Anthropic
   organization uses zero data retention, Claude Fable 5.1 isn't available; set the tagging and report stages
   to Opus 5.5 in each program.
6. **Backups.** Snapshot `STUDIO_DATA_DIR` daily. It holds everything: runs, collected posts, reports,
   workbooks, settings and encrypted keys.

## Moving the Mac app's data to the server

Copy the Mac data folder (`~/Library/Application Support/apify-scraper-studio`) into `STUDIO_DATA_DIR` while
both the Mac app and the server are stopped. Older records that stored full Mac file paths are re-anchored on
the new folder automatically. Keys saved on the Mac are locked to its keychain, so save them again in
Settings (or set them as environment variables). A team setup file (Settings → Share your setup) is the lighter
alternative when you only need the knowledge, products, taxonomy and programs.

## Security notes

- Every request needs a session (password) or a trusted-proxy email; sign-in attempts are rate limited.
- State-changing requests must come from the studio's own page (same origin); there is no cross-site access.
- The page never receives server file paths or key values; Settings shows only whether a key is saved.
- Uploads are limited to 30 MB, used once, and deleted after the request; downloads expire after 10 minutes.
- Strict Content Security Policy, no framing, `nosniff`, and no third-party scripts or fonts.
- The studio is shared: anyone who can sign in can see and change everything in it, including Settings.
  Limit sign-in to the team that should have that access.
