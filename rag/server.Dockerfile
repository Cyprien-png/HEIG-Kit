# HEIG-Kit remote server, without any rendering program: rendering happens in rag/render.Dockerfile. .dockerignore keeps
# .env, .cache/ and data/ out of the image; they are mounted at run time. The web application (web/) is built in a first
# stage and served by the server itself (docs/app.md).
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY rag/migrations ./rag/migrations
COPY --from=web /web/dist ./web/dist
RUN mkdir -p /outputs /jobs data .cache && chown node:node /outputs /jobs data .cache
USER node
EXPOSE 8766
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/mcp/host.ts", "--server"]
