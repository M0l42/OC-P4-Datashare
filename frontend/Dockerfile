# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

# ─────────────────────────────────────────────────────────────────────────────
# Développement : serveur Vite avec rechargement à chaud. Le code est monté en
# volume par compose.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ─────────────────────────────────────────────────────────────────────────────
# Compilation du bundle statique.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Production : le bundle est servi par nginx, pas par Node. Le conteneur front
# ne contient donc aucun runtime JavaScript en production — c'est du fichier
# statique, et c'est nginx qui le sert (voir infra/nginx/nginx.conf).
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
