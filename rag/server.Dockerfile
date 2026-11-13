# HEIG-Kit remote server, without any rendering program: rendering happens in rag/render.Dockerfile. .dockerignore keeps
# .env, .cache/ and data/ out of the image; they are mounted at run time. The web application (web/) is built in a first
# stage and served by the server itself (docs/app.md).
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# The themes of the courses, shared with the renderers: web/src/lib/courses.ts imports ../../../themes.
COPY themes /themes
RUN npm run build

FROM node:22-bookworm-slim
# git: the course repositories on GitHub are fetched (bare, shallow, never checked out) with HEIG_GITHUB_TOKEN.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY themes ./themes
# The administration commands run on the server itself: npm run users, npm run housekeeping (docs/accounts.md).
COPY scripts/users.ts scripts/housekeeping.ts ./scripts/
COPY rag/migrations ./rag/migrations
COPY --from=web /web/dist ./web/dist
RUN mkdir -p /outputs /jobs data .cache && chown node:node /outputs /jobs data .cache
USER node
EXPOSE 8766
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/mcp/host.ts", "--server"]
