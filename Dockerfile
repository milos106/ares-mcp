# syntax=docker/dockerfile:1

# ---- build stage ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Ownership proof for the official MCP Registry (must equal server.json "name").
LABEL io.modelcontextprotocol.server.name="io.github.milos106/ares-mcp"

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY llms.txt README.md LICENSE ./

# Default transport is stdio (this is what the registry's OCI entry advertises):
#   docker run -i --rm ghcr.io/milos106/ares-mcp:0.1.0
# For the HTTP transport (self-host / Smithery), override the command:
#   docker run -p 3030:3030 ghcr.io/milos106/ares-mcp:0.1.0 node dist/http.js
EXPOSE 3030
CMD ["node", "dist/index.js"]
