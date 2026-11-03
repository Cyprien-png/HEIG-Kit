# HEIG-Kit remote server, without any rendering program: rendering happens in rag/render.Dockerfile. .dockerignore keeps
# .env, .cache/ and data/ out of the image; they are mounted at run time.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY rag/migrations ./rag/migrations
RUN mkdir -p /outputs /jobs data .cache && chown node:node /outputs /jobs data .cache
USER node
EXPOSE 8766
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/mcp/host.ts", "--server"]
