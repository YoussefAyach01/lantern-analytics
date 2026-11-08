# Multi-stage: the build stage installs full deps (not needed for anything but npm's
# own resolution here, since there's no compile step — the app runs via tsx), the
# final stage installs production-only deps so eslint/vitest/typescript never ship.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S lantern && adduser -S lantern -G lantern
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R lantern:lantern /app
USER lantern
EXPOSE 4100
VOLUME ["/app/data"]
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
