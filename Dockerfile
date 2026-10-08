# Browser studio: the Mac app's screens and main process, served from one container.
# Build:  docker build -t scraper-studio .
# Run:    see docs/web-deploy.md (needs a /data volume, STUDIO_SECRET_KEY and a sign-in method)

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the Electron binary download; the browser build doesn't need it.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:web

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    STUDIO_RUNTIME=web \
    STUDIO_HOST=0.0.0.0 \
    PORT=4174 \
    STUDIO_DATA_DIR=/data \
    SHELL=/bin/sh
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/out/web ./out/web
COPY src ./src
COPY scripts/studio-web.cjs ./scripts/studio-web.cjs
COPY docs/app-guide.md ./docs/app-guide.md
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 4174
USER node
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4174)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "scripts/studio-web.cjs"]
