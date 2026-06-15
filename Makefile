# ──────────────────────────────────────────────
# Version
# ──────────────────────────────────────────────
VERSION     ?= 0.2.0
VERSION_DEV ?= $(VERSION)-$(shell git rev-parse --short HEAD)

# ──────────────────────────────────────────────
# Device (override any of these on the command line)
# ──────────────────────────────────────────────
DEVICE_USER  ?= root
DEVICE_HOSTS ?= picokvm 10.0.1.8
DEVICE_HOST  ?= $(shell for h in $(DEVICE_HOSTS); do \
  ssh -o ConnectTimeout=2 -o BatchMode=yes $(DEVICE_USER)@$$h true 2>/dev/null && echo $$h && break; \
done)
DEVICE_PATH  := /userdata/picokvm/bin/kvm_app

# ──────────────────────────────────────────────
# OTA signing (leave empty to skip)
# ──────────────────────────────────────────────
OTA_SIGNING_KEY ?=
OTA_PUBLIC_KEY  ?=

# ──────────────────────────────────────────────
# Build internals
# ──────────────────────────────────────────────
BRANCH    ?= $(shell git rev-parse --abbrev-ref HEAD)
BUILDDATE ?= $(shell date -u +%FT%T%z)
BUILDTS   ?= $(shell date -u +%s)
REVISION  ?= $(shell git rev-parse HEAD)

PROMETHEUS_TAG := github.com/prometheus/common/version
KVM_PKG_NAME   := kvm

GO_BUILD_ARGS         := -tags netgo
GO_RELEASE_BUILD_ARGS := -trimpath $(GO_BUILD_ARGS)
GO_LDFLAGS := \
  -s -w \
  -X $(PROMETHEUS_TAG).Branch=$(BRANCH) \
  -X $(PROMETHEUS_TAG).BuildDate=$(BUILDDATE) \
  -X $(PROMETHEUS_TAG).Revision=$(REVISION) \
  -X $(KVM_PKG_NAME).builtTimestamp=$(BUILDTS) \
  -X $(KVM_PKG_NAME).builtOtaPublicKey=$(OTA_PUBLIC_KEY)

GO_CMD  := GOOS=linux GOARCH=arm GOARM=7 go
BIN_DIR := $(shell pwd)/bin

TEST_DIRS := $(shell find . -name "*_test.go" -type f -exec dirname {} \; | sort -u)

build_dev:
	@echo "Building..."
	$(GO_CMD) build \
		-ldflags="$(GO_LDFLAGS) -X $(KVM_PKG_NAME).builtAppVersion=$(VERSION_DEV)" \
		$(GO_RELEASE_BUILD_ARGS) \
		-o $(BIN_DIR)/kvm_app cmd/main.go
	@if [ -n "$(OTA_SIGNING_KEY)" ]; then \
		echo "Signing $(BIN_DIR)/kvm_app..."; \
		go run cmd/main.go cli signer sign --key "$(OTA_SIGNING_KEY)" $(BIN_DIR)/kvm_app; \
	else \
		echo "OTA_SIGNING_KEY not set, skipping signing."; \
	fi

frontend:
	cd ui && npm ci && npm run build:device

build_release: frontend
	@echo "Building release..."
	$(GO_CMD) build \
		-ldflags="$(GO_LDFLAGS) -X $(KVM_PKG_NAME).builtAppVersion=$(VERSION)" \
		$(GO_RELEASE_BUILD_ARGS) \
		-o bin/kvm_app cmd/main.go
	@if [ -n "$(OTA_SIGNING_KEY)" ]; then \
		echo "Signing bin/kvm_app..."; \
		go run cmd/main.go cli signer sign --key "$(OTA_SIGNING_KEY)" bin/kvm_app; \
	else \
		echo "OTA_SIGNING_KEY not set, skipping signing."; \
	fi

sign:
	@echo "Signing firmware files..."
	go run cmd/main.go cli signer sign --key $(KEY) $(FILES)

# Deploy binary to device over SSH
deploy: build_dev
	@if [ -z "$(DEVICE_HOST)" ]; then \
		echo "Error: no reachable device. Tried: $(DEVICE_HOSTS)"; \
		echo "Override with: make deploy DEVICE_HOST=<host>"; \
		exit 1; \
	fi
	@echo "Stopping kvm_app on device..."
	ssh $(DEVICE_USER)@$(DEVICE_HOST) 'killall kvm_app 2>/dev/null; sleep 1'
	@echo "Deploying to $(DEVICE_USER)@$(DEVICE_HOST):$(DEVICE_PATH)..."
	scp $(BIN_DIR)/kvm_app $(DEVICE_USER)@$(DEVICE_HOST):$(DEVICE_PATH)
	@echo "Starting kvm_app on device..."
	ssh $(DEVICE_USER)@$(DEVICE_HOST) 'nohup $(DEVICE_PATH) > /dev/null 2>&1 &'
	@echo "Deploy complete."

# Deploy without rebuild
deploy_only:
	@if [ -z "$(DEVICE_HOST)" ]; then \
		echo "Error: no reachable device. Tried: $(DEVICE_HOSTS)"; \
		echo "Override with: make deploy_only DEVICE_HOST=<host>"; \
		exit 1; \
	fi
	@echo "Stopping kvm_app on device..."
	ssh $(DEVICE_USER)@$(DEVICE_HOST) 'killall kvm_app 2>/dev/null; sleep 1'
	@echo "Deploying to $(DEVICE_USER)@$(DEVICE_HOST):$(DEVICE_PATH)..."
	scp $(BIN_DIR)/kvm_app $(DEVICE_USER)@$(DEVICE_HOST):$(DEVICE_PATH)
	@echo "Starting kvm_app on device..."
	ssh $(DEVICE_USER)@$(DEVICE_HOST) 'nohup $(DEVICE_PATH) > /dev/null 2>&1 &'
	@echo "Deploy complete."

# Backup device state to local directory
backup:
	@if [ -z "$(DEVICE_HOST)" ]; then \
		echo "Error: no reachable device. Tried: $(DEVICE_HOSTS)"; \
		exit 1; \
	fi
	@echo "Backing up from $(DEVICE_HOST)..."
	@mkdir -p ../kvm.backup
	scp -r $(DEVICE_USER)@$(DEVICE_HOST):/userdata/picokvm/bin/ ../kvm.backup/bin/
	scp -r $(DEVICE_USER)@$(DEVICE_HOST):/userdata/picokvm/model/ ../kvm.backup/model/
	scp -r $(DEVICE_USER)@$(DEVICE_HOST):/userdata/picokvm/tls/ ../kvm.backup/tls/
	scp $(DEVICE_USER)@$(DEVICE_HOST):/userdata/kvm_config.json ../kvm.backup/
	@echo "Backup complete → ../kvm.backup/"
