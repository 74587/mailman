# Mailman Backend Makefile

# Go parameters
GOCMD=go
GOBUILD=$(GOCMD) build
GOCLEAN=$(GOCMD) clean
GOTEST=$(GOCMD) test
GOGET=$(GOCMD) get
GOMOD=$(GOCMD) mod

# Binary names
MAIN_BINARY=mailman
RESET_PASSWORD_BINARY=reset-password
MAILMAN_PROXY_BINARY=mailman-proxy

# Mailman proxy defaults. Override them with make variables, for example:
# make run-mailman-proxy PROXY_PORT=18080 PROXY_TARGET=https://mailman.easycat.io
PROXY_LISTEN_IP ?= 127.0.0.1
PROXY_PORT ?= 8080
PROXY_TARGET ?= https://mailman.easycat.io
PROXY_LOG ?= true
PROXY_VERBOSE ?= false
PROXY_BACKGROUND ?= false
PROXY_LOG_FILE ?=

# Build directories
BUILD_DIR=build
CMD_DIR=cmd

.PHONY: all build clean test deps help reset-password mailman-proxy run-mailman-proxy

# Default target
all: deps build

# Build all binaries
build: build-main build-reset-password build-mailman-proxy

# Build main application
build-main:
	@echo "Building main application..."
	@mkdir -p $(BUILD_DIR)
	$(GOBUILD) -o $(BUILD_DIR)/$(MAIN_BINARY) ./$(CMD_DIR)/mailman

# Build reset-password tool
build-reset-password:
	@echo "Building reset-password tool..."
	@mkdir -p $(BUILD_DIR)
	$(GOBUILD) -o $(BUILD_DIR)/$(RESET_PASSWORD_BINARY) ./$(CMD_DIR)/reset-password

# Build local callback proxy tool
build-mailman-proxy:
	@echo "Building mailman-proxy tool..."
	@mkdir -p $(BUILD_DIR)
	$(GOBUILD) -o $(BUILD_DIR)/$(MAILMAN_PROXY_BINARY) ./$(CMD_DIR)/mailman-proxy

# Quick build reset-password tool in current directory
reset-password:
	@echo "Building reset-password tool..."
	$(GOBUILD) -o $(RESET_PASSWORD_BINARY) ./$(CMD_DIR)/reset-password

# Quick build mailman-proxy tool in current directory
mailman-proxy:
	@echo "Building mailman-proxy tool..."
	$(GOBUILD) -o $(MAILMAN_PROXY_BINARY) ./$(CMD_DIR)/mailman-proxy

# Build and run the local callback proxy
run-mailman-proxy: build-mailman-proxy
	@echo "Starting mailman-proxy on $(PROXY_LISTEN_IP):$(PROXY_PORT) -> $(PROXY_TARGET)"
	$(BUILD_DIR)/$(MAILMAN_PROXY_BINARY) -i=$(PROXY_LISTEN_IP) -p=$(PROXY_PORT) -t=$(PROXY_TARGET) -l=$(PROXY_LOG) -v=$(PROXY_VERBOSE) $(if $(filter true,$(PROXY_BACKGROUND)),-b,) $(if $(PROXY_LOG_FILE),-o=$(PROXY_LOG_FILE),)

# Install dependencies
deps:
	@echo "Installing dependencies..."
	$(GOMOD) tidy
	$(GOMOD) download

# Run tests
test:
	@echo "Running tests..."
	$(GOTEST) -v ./...

# Clean build artifacts
clean:
	@echo "Cleaning..."
	$(GOCLEAN)
	rm -rf $(BUILD_DIR)
	rm -f $(MAIN_BINARY)
	rm -f $(RESET_PASSWORD_BINARY)
	rm -f $(MAILMAN_PROXY_BINARY)

# Run the main application
run:
	@echo "Running main application..."
	$(GOBUILD) -o $(MAIN_BINARY) ./$(CMD_DIR)/mailman && ./$(MAIN_BINARY)

# Development build with race detection
dev:
	@echo "Building with race detection..."
	$(GOBUILD) -race -o $(MAIN_BINARY) ./$(CMD_DIR)/mailman

# Install tools globally
install: build
	@echo "Installing binaries to GOPATH/bin..."
	cp $(BUILD_DIR)/$(MAIN_BINARY) $(GOPATH)/bin/
	cp $(BUILD_DIR)/$(RESET_PASSWORD_BINARY) $(GOPATH)/bin/
	cp $(BUILD_DIR)/$(MAILMAN_PROXY_BINARY) $(GOPATH)/bin/

# Show help
help:
	@echo "Available targets:"
	@echo "  all                 - Install dependencies and build all binaries"
	@echo "  build               - Build all binaries"
	@echo "  build-main          - Build main application only"
	@echo "  build-reset-password- Build reset-password tool only"
	@echo "  build-mailman-proxy - Build local callback proxy tool only"
	@echo "  reset-password      - Quick build reset-password tool in current directory"
	@echo "  mailman-proxy       - Quick build mailman-proxy tool in current directory"
	@echo "  run-mailman-proxy   - Build and start local callback proxy"
	@echo "  deps                - Install/update dependencies"
	@echo "  test                - Run tests"
	@echo "  clean               - Clean build artifacts"
	@echo "  run                 - Build and run main application"
	@echo "  dev                 - Build with race detection"
	@echo "  install             - Install binaries to GOPATH/bin"
	@echo "  help                - Show this help message"
