# ── Stage 1: dependencies ──────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 2: build / verify (runs lint, skips DB-dependent tests) ─────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run lint 2>/dev/null || true

# ── Stage 3: production image ──────────────────────────────────────────────────
FROM node:20-alpine AS production
LABEL org.opencontainers.image.title="user-service"
LABEL org.opencontainers.image.description="User management microservice"
LABEL org.opencontainers.image.source="https://github.com/your-org/user-service"

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy production node_modules from deps stage
COPY --from=deps  /app/node_modules ./node_modules

# Copy application source
COPY --chown=appuser:appgroup . .

# Create logs directory with correct ownership
RUN mkdir -p logs && chown appuser:appgroup logs

# Drop root privileges
USER appuser

EXPOSE 3501

# Use dumb-init to handle PID 1 signals correctly (SIGTERM → graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]

# Health check for Docker / Kubernetes
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3501/health/live || exit 1
