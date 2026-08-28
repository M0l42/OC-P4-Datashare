# DataShare — pilotage de la pile
#
# Cible du livrable « scripts de déploiement » : un clone vierge suivi de
# `make setup` doit produire une pile fonctionnelle sans étape manuelle.

SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help
.PHONY: help setup up down restart logs ps build rebuild install migrate \
        migrate-dev studio init-bucket test test-cov test-e2e cypress perf-download \
        perf-upload lint shell-api shell-front scale clean nuke fix-perms

help: ## Affiche cette aide
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ─────────────────────────────────────────────────────────────────────────────
# Démarrage
# ─────────────────────────────────────────────────────────────────────────────

setup: ## Installation complète depuis un clone vierge
	@test -f .env || (cp .env.example .env && echo "→ .env créé depuis .env.example")
	$(COMPOSE) build
	$(COMPOSE) up -d
	@echo "→ attente de l'API…"
	@until curl -sf http://localhost:8080/api/health >/dev/null 2>&1; do sleep 2; done
	@echo ""
	@echo "  ✓ pile démarrée"
	@echo "    application  http://localhost:8080"
	@echo "    API health   http://localhost:8080/api/health"
	@echo "    MinIO console http://localhost:9001"
	@echo ""

up: ## Démarre la pile
	$(COMPOSE) up -d

down: ## Arrête la pile (les volumes sont conservés)
	$(COMPOSE) down

restart: ## Redémarre la pile
	$(COMPOSE) restart

build: ## Construit les images
	$(COMPOSE) build

rebuild: ## Reconstruit les images sans cache
	$(COMPOSE) build --no-cache

ps: ## État des conteneurs
	$(COMPOSE) ps

logs: ## Suit les logs (make logs s=api pour un seul service)
	$(COMPOSE) logs -f $(s)

# ─────────────────────────────────────────────────────────────────────────────
# Base de données
# ─────────────────────────────────────────────────────────────────────────────

install: ## Installe une dépendance DANS le conteneur (make install s=api p=zod)
	@test -n "$(s)" -a -n "$(p)" || (echo "usage: make install s=api|front p=<paquet>"; exit 1)
	$(COMPOSE) exec $(s) npm install $(p)
	@echo ""
	@echo "  ⚠  node_modules vit dans un volume anonyme : un 'npm install' lancé"
	@echo "     sur l'hôte n'atteint PAS le conteneur. Après avoir modifié"
	@echo "     package.json, relancer :"
	@echo "     docker compose up -d --build --renew-anon-volumes $(s)"
	@echo ""

fix-perms: ## Rend à l'hôte les fichiers générés en root par nest g (make fix-perms)
	$(COMPOSE) exec -T -u root api chown -R $(shell id -u):$(shell id -g) src

migrate: ## Applique les migrations Prisma
	$(COMPOSE) exec api npx prisma migrate deploy

migrate-dev: ## Crée et applique une migration (make migrate-dev n=nom)
	@test -n "$(n)" || (echo "usage: make migrate-dev n=<nom_de_migration>"; exit 1)
	$(COMPOSE) exec api npx prisma migrate dev --name $(n)

studio: ## Ouvre Prisma Studio
	$(COMPOSE) exec api npx prisma studio

# ─────────────────────────────────────────────────────────────────────────────
# Stockage
# ─────────────────────────────────────────────────────────────────────────────

init-bucket: ## Recrée le bucket et applique le CORS
	$(COMPOSE) run --rm minio-init

# ─────────────────────────────────────────────────────────────────────────────
# Qualité
# ─────────────────────────────────────────────────────────────────────────────

test: ## Tests unitaires et d'intégration
	$(COMPOSE) exec api npm test

test-cov: ## Tests avec rapport de couverture
	$(COMPOSE) exec api npm run test:cov

test-e2e: ## Tests d'intégration Supertest (backend)
	$(COMPOSE) exec api npm run test:e2e

cypress: ## Tests E2E navigateur (QA-03) — nécessite `make up`.
	docker run --rm --init --network host \
		-v "$(CURDIR)/frontend:/e2e" -w /e2e \
		-e CYPRESS_BASE_URL=http://localhost:8080 \
		cypress/included:15.21.1

perf-download: ## QA-06 — k6 sur GET /d/:token (make perf-download n=1|3) — nécessite `make up`
	@test -n "$(n)" || (echo "usage: make perf-download n=1|3"; exit 1)
	$(MAKE) scale n=$(n)
	@sleep 8
	$(eval TOKEN := $(shell ./perf/seed-download-token.sh))
	docker run --rm --network host \
		-e BASE_URL=http://localhost:8080 \
		-e TOKEN=$(TOKEN) \
		-v "$(CURDIR)/perf:/perf" \
		grafana/k6 run /perf/download-load-test.js

perf-upload: ## QA-06 — mesure d'un téléversement de 800 Mo (CPU/mémoire API) — nécessite `make up`
	./perf/measure-upload-800mb.sh

lint: ## Lint back et front
	$(COMPOSE) exec api npm run lint
	$(COMPOSE) exec front npm run lint

# ─────────────────────────────────────────────────────────────────────────────
# Divers
# ─────────────────────────────────────────────────────────────────────────────

shell-api: ## Shell dans le conteneur API
	$(COMPOSE) exec api sh

shell-front: ## Shell dans le conteneur front
	$(COMPOSE) exec front sh

scale: ## Démarre N réplicas de l'API (make scale n=3)
	$(COMPOSE) up -d --scale api=$(n)

clean: ## Arrête et supprime les conteneurs, garde les volumes
	$(COMPOSE) down --remove-orphans

nuke: ## Supprime TOUT, volumes compris — les données sont perdues
	@read -p "Supprimer les volumes (base, stockage) ? [oui/N] " ok; \
	  [ "$$ok" = "oui" ] && $(COMPOSE) down -v --remove-orphans || echo "annulé"
