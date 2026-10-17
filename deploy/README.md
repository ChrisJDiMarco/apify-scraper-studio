# Deploy kit

Ready-to-copy setups for the browser studio. [docs/web-deploy.md](../docs/web-deploy.md) explains every setting;
this folder is the assembled version.

| Folder | What it runs |
| --- | --- |
| `compose/` | One host with Docker: Caddy (TLS) → oauth2-proxy (Google Workspace or Okta sign-in) → the studio container |
| `systemd/` | One Linux host without Docker: the studio as a service behind your own proxy, plus a daily backup timer |

Both keep to the rules the studio depends on:

- **One studio process per data folder.** Never run two replicas or a start-first rollout on the same volume.
- **Secrets in a root-only file**, never in the environment. Compose mounts `secrets.env` and the studio reads it as
  root before switching to the `node` user. systemd hands the file over as standard input.
- **Only the sign-in proxy reaches the studio.** The studio believes the signed-in email header only from
  `STUDIO_TRUSTED_PROXY_CIDRS` (and/or with `STUDIO_PROXY_SECRET`).
- **A stop gives running work time to finish.** The grace period (`stop_grace_period`, `TimeoutStopSec`) is longer
  than `STUDIO_DRAIN_SECONDS`.

## Compose, step by step

```bash
cd deploy/compose
cp studio.env.example studio.env                  # allowed domain, admin emails, public address
cp oauth2-proxy.env.example oauth2-proxy.env      # OAuth client id/secret, cookie secret
cp oauth2-proxy.cfg.example oauth2-proxy.cfg      # provider, email domain
sudo install -m 400 -o root -g root secrets.env.example secrets.env && sudoedit secrets.env   # STUDIO_SECRET_KEY
STUDIO_DOMAIN=studio.example.com docker compose up -d --build
docker compose ps                                 # studio shows "healthy" once /readyz answers
```

Then sign in with an address from `STUDIO_ADMIN_EMAILS` and add people in **People & access**.

Check that the proxy strips a forged header: signed in as yourself, run
`curl -s https://studio.example.com/api/session -H 'X-Forwarded-Email: someone-else@semrush.com' -b '<your _oauth2_proxy cookie>'`
and confirm it still names you.

| Task | Command |
| --- | --- |
| Logs (JSON lines) | `docker compose logs -f studio` |
| Back up (while running) | `docker compose exec studio node scripts/studio-backup.cjs --out /backups --keep 14` |
| Restore | `docker compose stop studio` then `docker compose run --rm --no-deps studio node scripts/studio-restore.cjs --from /backups/<file>.tar.gz --yes` then `docker compose start studio` |
| Update | `git pull && docker compose up -d --build`; open tabs offer a reload |
| Stop now (skip the drain) | `docker compose kill -s SIGTERM studio` twice |

Copy `backups/` and `secrets.env` off the host: a backup restored without its `STUDIO_SECRET_KEY` loses the saved keys.

## systemd

See the comments at the top of `systemd/scraper-studio.service`. Put Caddy or nginx with your SSO on the same
machine, keep the studio on `127.0.0.1`, and set `STUDIO_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128`.
`scraper-studio-backup.timer` takes a backup every night into `/var/backups/scraper-studio` and keeps 14.

## Kubernetes

Not shipped as manifests. If you deploy there, use a StatefulSet with `replicas: 1` and a ReadWriteOnce volume,
`terminationGracePeriodSeconds` longer than `STUDIO_DRAIN_SECONDS`, a readiness probe on `GET /readyz` and a liveness
probe on `GET /healthz`, and a NetworkPolicy that admits only the sign-in proxy on port 4174. Pod addresses change, so
use `STUDIO_PROXY_SECRET` (the proxy sends `X-Studio-Proxy-Secret`) rather than an address range. Mount the Secret as a
file with `defaultMode: 0400` and point `STUDIO_SECRETS_FILE` at it.
