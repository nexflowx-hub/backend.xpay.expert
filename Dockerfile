# ============================================================
# XPAY.Expert Backend
# Node 20 + Debian Bookworm + OpenSSL 3
# ============================================================

FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci

# Gerar explicitamente todos os engines definidos no schema
RUN npx prisma generate \
    --schema=prisma/schema.prisma

# O build deve falhar imediatamente se o engine 3.0 não existir
RUN test -f \
    /app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node

COPY . .

RUN npm run build

# ============================================================
# Production Runtime
# ============================================================

FROM node:20-bookworm-slim AS production

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8085

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Gerar novamente no próprio ambiente runtime
RUN npx prisma generate \
    --schema=prisma/schema.prisma

# Garantir que o engine necessário está dentro da imagem final
RUN test -f \
    /app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node

RUN openssl version \
    && find /app/node_modules/.prisma/client \
        -maxdepth 1 \
        -type f \
        -name '*query_engine*' \
        -printf '%f\n'

EXPOSE 8085

CMD ["node", "dist/core/app.js"]
