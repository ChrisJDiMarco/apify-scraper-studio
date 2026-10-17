# Browser studio: the Mac app's screens and main process, served from one container.
# Build:  docker build -t scraper-studio .
# Run:    see docs/web-deploy.md and deploy/ (a /data volume, a sign-in method, and the secrets file mounted root-only:
#         docker run -v studio-data:/data -v /etc/scraper-studio/secrets:/run/secrets/studio:ro \
#           -e STUDIO_SECRETS_FILE=/run/secrets/studio … scraper-studio
#         The server starts as root only to read that file, then runs as the node user, who can't open it again.)

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the Electron binary download; the browser build doesn't need it.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:web

FROM node:24-bookworm-slim
# tini runs as PID 1: it forwards docker stop's SIGTERM to the server and reaps the AI command-line tools' children.
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    STUDIO_RUNTIME=web \
    STUDIO_HOST=0.0.0.0 \
    PORT=4174 \
    STUDIO_DATA_DIR=/data \
    STUDIO_RUN_AS=node \
    SHELL=/bin/sh
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/out/web ./out/web
COPY src ./src
COPY scripts/studio-web.cjs scripts/studio-backup.cjs scripts/studio-restore.cjs ./scripts/
COPY docs/app-guide.md ./docs/app-guide.md
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
VOLUME /data
EXPOSE 4174
# No USER: the server starts as root to read a root-only STUDIO_SECRETS_FILE, then switches to STUDIO_RUN_AS (node)
# before it touches /data. Running the container with --user node (or Kubernetes runAsNonRoot) works too; the
# secrets file then has to be readable by that user, and the server says so at start.
# Readiness, not just the page: the data volume takes writes, this process owns it, and it isn't stopping.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "const h=process.env.STUDIO_HOST||'127.0.0.1';const a=['0.0.0.0','::',''].includes(h)?'127.0.0.1':(h.includes(':')?'['+h+']':h);fetch('http://'+a+':'+(process.env.PORT||4174)+'/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Give running work time to finish on docker stop: docker stop -t 60, or stop_grace_period in compose (deploy/).
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/studio-web.cjs"]
