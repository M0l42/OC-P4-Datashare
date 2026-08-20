# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Base commune. Node 22 LTS : NestJS 11 exige Node >= 20, et l'AWS SDK v3
# exigera Node >= 22 après janvier 2027. Autant partir sur la bonne version.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app
# openssl : requis par les binaires de moteur Prisma sur Alpine.
RUN apk add --no-cache openssl

# ─────────────────────────────────────────────────────────────────────────────
# Dépendances. Copiées seules pour que le cache de couche ne soit invalidé que
# lorsque package.json ou le lockfile changent, pas à chaque modification de src.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci

# ─────────────────────────────────────────────────────────────────────────────
# Développement. Le code est monté en volume par compose ; --watch recompile.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ─────────────────────────────────────────────────────────────────────────────
# Compilation.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Production. Dépendances de production seulement, et exécution en utilisateur
# non privilégié : un processus qui n'a pas besoin de root ne tourne pas en root.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
