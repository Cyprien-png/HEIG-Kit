# HEIG-Kit MCP server. Built from the repository root (see rag/compose.yml); .dockerignore keeps .env, .cache/
# and data/ out of the image: indexed documents are mounted read-only at run time.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY rag/migrations ./rag/migrations
USER node
EXPOSE 8765
CMD ["npx", "tsx", "src/mcp/server.ts"]
