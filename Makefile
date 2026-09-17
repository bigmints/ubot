SHELL := /bin/bash
.DEFAULT_GOAL := build

CORE_DIR := youbot-core
WEB_DIR := $(CORE_DIR)/web-ui
CLI_DIR := cli
YOUBOT_HOME ?= $(HOME)/.youbot
INSTALL_BIN_DIR ?= $(HOME)/.local/bin

.PHONY: check-deps deps build build-engine build-backend build-web test lint verify install update clean dev help

check-deps:
	@command -v node >/dev/null 2>&1 || { echo "Node.js is required" >&2; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
	@major="$$(node -p 'process.versions.node.split(".")[0]')"; \
	  [[ "$$major" -ge 22 ]] || { echo "Node.js 22 or newer is required (found $$(node -v))" >&2; exit 1; }

deps: check-deps
	@cd packages/collection-engine && npm ci
	@cd $(CORE_DIR) && npm ci
	@cd $(WEB_DIR) && npm ci
	@cd $(CORE_DIR)/webchat-relay && npm ci

build-engine: check-deps
	@cd packages/collection-engine && npm run build

build-backend: check-deps build-engine
	@cd $(CORE_DIR) && npm run build

build-web: check-deps
	@cd $(WEB_DIR) && npm run build

build: deps build-backend build-web
	@echo "Build complete."

test: check-deps
	@cd $(CORE_DIR) && npm test
	@cd packages/collection-engine && npm test
	@cd $(CORE_DIR)/webchat-relay && npm test

lint: check-deps
	@cd $(WEB_DIR) && npm run lint

verify: build test lint
	@cd packages/collection-engine && npm audit --omit=dev --audit-level=high
	@cd $(CORE_DIR) && npm audit --omit=dev --audit-level=high
	@cd $(WEB_DIR) && npm audit --omit=dev --audit-level=high
	@cd $(CORE_DIR)/webchat-relay && npm audit --omit=dev --audit-level=high
	@bash -n start.sh stop.sh cli/youbot $(CORE_DIR)/deploy.sh $(CORE_DIR)/deploy-relay.sh
	@git diff --check
	@echo "Verification complete."

install: build
	@echo "Installing Youbot into $(YOUBOT_HOME)..."
	@install -d -m 700 "$(YOUBOT_HOME)" "$(YOUBOT_HOME)/data" "$(YOUBOT_HOME)/logs" \
	  "$(YOUBOT_HOME)/sessions" "$(YOUBOT_HOME)/creds" "$(YOUBOT_HOME)/workspace" \
	  "$(YOUBOT_HOME)/custom" "$(INSTALL_BIN_DIR)"
	@rm -rf "$(YOUBOT_HOME)/lib.new" "$(YOUBOT_HOME)/web.new" "$(YOUBOT_HOME)/node_modules.new"
	@cp -R "$(CORE_DIR)/dist" "$(YOUBOT_HOME)/lib.new"
	@cp -R "$(WEB_DIR)/out" "$(YOUBOT_HOME)/web.new"
	@cp -R "$(CORE_DIR)/node_modules" "$(YOUBOT_HOME)/node_modules.new"
	@rm -rf "$(YOUBOT_HOME)/lib" "$(YOUBOT_HOME)/web" "$(YOUBOT_HOME)/node_modules"
	@mv "$(YOUBOT_HOME)/lib.new" "$(YOUBOT_HOME)/lib"
	@mv "$(YOUBOT_HOME)/web.new" "$(YOUBOT_HOME)/web"
	@mv "$(YOUBOT_HOME)/node_modules.new" "$(YOUBOT_HOME)/node_modules"
	@install -m 755 "$(CLI_DIR)/youbot" "$(INSTALL_BIN_DIR)/youbot"
	@install -m 600 "$(CLI_DIR)/default-config.json" "$(YOUBOT_HOME)/default-config.json"
	@if [[ ! -f "$(YOUBOT_HOME)/config.json" ]]; then \
	  install -m 600 "$(CLI_DIR)/default-config.json" "$(YOUBOT_HOME)/config.json"; \
	else chmod 600 "$(YOUBOT_HOME)/config.json"; fi
	@touch "$(YOUBOT_HOME)/.installed"
	@echo "Installed. Start with: youbot start"

update: install

clean:
	@cd $(CORE_DIR) && npm run clean
	@rm -rf "$(WEB_DIR)/.next" "$(WEB_DIR)/out"

dev: check-deps
	@trap 'kill 0' EXIT INT TERM; \
	  (cd $(CORE_DIR) && PORT=5081 YOUBOT_HOST=127.0.0.1 NODE_ENV=development npm run dev) & \
	  (cd $(WEB_DIR) && npm run dev -- -p 5080)

help:
	@echo "Targets: deps build test lint verify install update clean dev"
