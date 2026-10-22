# CORG Record Vault — one-command local demo.
#
# The server binds loopback by design (see compose file for how it is
# reached). Multi-stage: the build stage compiles the contracts and the
# browser client; the runtime stage carries production dependencies only.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run compile && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/artifacts ./artifacts
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts/start-local.mjs ./scripts/start-local.mjs
EXPOSE 3000
VOLUME ["/app/.data"]
CMD ["node", "scripts/start-local.mjs"]
