# ── Build stage ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first so Docker layer-caches the install step
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Non-root user for security
RUN addgroup -S lifehub && adduser -S lifehub -G lifehub

WORKDIR /app

# Copy pruned node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (backend dir)
COPY . .

# Copy migrations (one level up from backend)
COPY ../migrations ../migrations
COPY ../scripts     ../scripts

# Drop privileges
USER lifehub

EXPOSE 5000

# Docker HEALTHCHECK — hits /healthz (DB + uptime check).
# start-period gives the migration + server warm-up time before
# Docker starts counting failures.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5000/healthz || exit 1

# npm start = migrate then node server.js (see package.json)
CMD ["npm", "start"]
