FROM node:20-alpine AS base

# ── Dependencias ──────────────────────────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache libc6-compat python3 py3-pip
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Instalar dependencias Python para extracción de fotos PDF
RUN pip3 install --break-system-packages pdfplumber pypdf 2>/dev/null || true

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Runner (imagen final liviana) ─────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copiar archivos públicos y build standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copiar script de seed y datos iniciales
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src/data ./src/data

# Python para el script de extracción de fotos
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --break-system-packages pdfplumber pypdf 2>/dev/null || true

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# En Fly: DATA_DIR=/data (volumen persistente). Seed copia defaults si no existen.
CMD node scripts/seed-data.mjs && node server.js
