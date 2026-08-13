# DataShare — pilotage de la pile
#
# Cible du livrable « scripts de déploiement » : un clone vierge suivi de
# `make setup` doit produire une pile fonctionnelle sans étape manuelle.

SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help
.PHONY: help setup up down restart logs ps build rebuild install migrate \
        migrate-dev studio init-bucket test test-cov test-e2e lint shell-api \
        shell-front scale clean nuke

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

test-e2e: ## Tests end-to-end
	$(COMPOSE) exec api npm run test:e2e

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
