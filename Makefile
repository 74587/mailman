.PHONY: help dev frontend-build frontend-install proxy run-mailman-proxy \
       build-all push-all run-all \
       compose-up compose-down compose-logs compose-ps \
       dev-docker dev-docker-logs dev-docker-down \
       clean db-shell backend-shell

# Docker image settings (override via environment or .env)
IMAGE_NAME  ?= mailman
IMAGE_TAG   ?= latest
FULL_IMAGE  := $(IMAGE_NAME):$(IMAGE_TAG)

# Default target
help:
	@echo ""
	@echo "  Mailman - Build & Deploy Commands"
	@echo "  =================================="
	@echo ""
	@echo "  Local Development:"
	@echo "    make dev                 Build frontend + start backend locally"
	@echo "    make proxy               Build + start local callback proxy"
	@echo "    make run-mailman-proxy   Build + start local callback proxy"
	@echo "    make frontend-build      Build frontend static assets only"
	@echo "    make frontend-install    Install frontend dependencies"
	@echo ""
	@echo "  All-in-One Image (前端打包到后端):"
	@echo "    make build-all           Build all-in-one Docker image"
	@echo "    make push-all            Push all-in-one image to registry"
	@echo "    make run-all             Run all-in-one image locally (SQLite)"
	@echo ""
	@echo "  Docker Compose (PostgreSQL):"
	@echo "    make compose-up          Start services (PostgreSQL + Mailman)"
	@echo "    make compose-down        Stop all services"
	@echo "    make compose-logs        Tail service logs"
	@echo "    make compose-ps          Show running services"
	@echo "    make compose-build       Build and start services"
	@echo ""
	@echo "  Docker Compose Dev (MySQL):"
	@echo "    make dev-docker          Start dev environment"
	@echo "    make dev-docker-logs     Tail dev logs"
	@echo "    make dev-docker-down     Stop dev environment"
	@echo ""
	@echo "  Utilities:"
	@echo "    make clean               Remove volumes, images, build artifacts"
	@echo "    make db-shell            Access PostgreSQL shell"
	@echo "    make backend-shell       Access mailman container shell"
	@echo ""

# ============================================================
# Local Development
# ============================================================

# Build frontend + start backend locally
dev: frontend-build
	@echo "Starting backend server..."
	cd backend && go run ./cmd/mailman

# Build + start local callback proxy
proxy: run-mailman-proxy

run-mailman-proxy:
	$(MAKE) -C backend run-mailman-proxy

# Build frontend static assets
frontend-build:
	@echo "Building frontend static assets..."
	cd frontend && npm run build
	@echo "Frontend build complete: frontend/out/"

# Install frontend dependencies
frontend-install:
	@echo "Installing frontend dependencies..."
	cd frontend && npm install

# ============================================================
# All-in-One Docker Image
# ============================================================

# Build all-in-one image (frontend bundled into backend)
build-all:
	@echo "Building all-in-one image: $(FULL_IMAGE)"
	docker build -f Dockerfile.all -t $(FULL_IMAGE) .
	@echo "Build complete: $(FULL_IMAGE)"

# Push all-in-one image to registry
push-all: build-all
	docker push $(FULL_IMAGE)

# Run all-in-one image locally with SQLite (quick test)
run-all:
	@echo "Running $(FULL_IMAGE) on http://localhost:8080"
	docker run --rm -it \
		-p 8080:8080 \
		-v mailman_data:/app/data \
		$(FULL_IMAGE)

# ============================================================
# Docker Compose (Production - PostgreSQL)
# ============================================================

compose-up:
	docker compose up -d

compose-down:
	docker compose down

compose-logs:
	docker compose logs -f

compose-ps:
	docker compose ps

compose-build:
	docker compose up -d --build

# ============================================================
# Docker Compose (Development - MySQL)
# ============================================================

dev-docker:
	docker compose -f docker-compose.dev.yml up -d

dev-docker-logs:
	docker compose -f docker-compose.dev.yml logs -f

dev-docker-down:
	docker compose -f docker-compose.dev.yml down

# ============================================================
# Utilities
# ============================================================

clean:
	docker compose down -v 2>/dev/null || true
	docker compose -f docker-compose.dev.yml down -v 2>/dev/null || true
	docker rmi $(FULL_IMAGE) 2>/dev/null || true
	rm -rf frontend/out frontend/.next
	@echo "Cleanup complete."

db-shell:
	docker exec -it mailman-postgres psql -U $${POSTGRES_USER:-mailman} -d $${POSTGRES_DB:-mailman}

backend-shell:
	docker exec -it mailman-app /bin/sh
