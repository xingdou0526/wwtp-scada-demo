# syntax=docker/dockerfile:1

FROM node:22-alpine AS web-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    WWTP_HOST=0.0.0.0 \
    WWTP_PORT=3001 \
    WWTP_BASE_PATH="" \
    WWTP_STATIC_DIR=/app/web/dist

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/
COPY --from=web-builder /app/web/dist ./web/dist

RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.WWTP_PORT || 3001) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
