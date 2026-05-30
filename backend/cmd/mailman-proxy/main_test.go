package main

import (
	"testing"
	"time"

	"mailman/internal/localproxy"
)

func TestParseFlagsUsesDefaults(t *testing.T) {
	clearProxyEnv(t)

	cfg, background, daemon, logFile := parseFlags(nil)

	if cfg.ListenIP != "127.0.0.1" {
		t.Fatalf("ListenIP = %s", cfg.ListenIP)
	}
	if cfg.Port != 8080 {
		t.Fatalf("Port = %d", cfg.Port)
	}
	if cfg.Target != localproxy.DefaultTarget {
		t.Fatalf("Target = %s", cfg.Target)
	}
	if !cfg.LogRequests {
		t.Fatalf("LogRequests = false")
	}
	if cfg.Verbose {
		t.Fatalf("Verbose = true")
	}
	if cfg.Timeout != 60*time.Second {
		t.Fatalf("Timeout = %s", cfg.Timeout)
	}
	if background || daemon {
		t.Fatalf("background=%v daemon=%v", background, daemon)
	}
	if logFile != "" {
		t.Fatalf("logFile = %s", logFile)
	}
}

func TestParseFlagsSupportsShortAliases(t *testing.T) {
	clearProxyEnv(t)

	cfg, background, daemon, logFile := parseFlags([]string{
		"-i", "0.0.0.0",
		"-p", "18080",
		"-t", "mailman.example.com",
		"-l=false",
		"-v",
		"-T", "5s",
		"-b",
		"-o", "proxy.log",
	})

	if cfg.ListenIP != "0.0.0.0" {
		t.Fatalf("ListenIP = %s", cfg.ListenIP)
	}
	if cfg.Port != 18080 {
		t.Fatalf("Port = %d", cfg.Port)
	}
	if cfg.Target != "mailman.example.com" {
		t.Fatalf("Target = %s", cfg.Target)
	}
	if cfg.LogRequests {
		t.Fatalf("LogRequests = true")
	}
	if !cfg.Verbose {
		t.Fatalf("Verbose = false")
	}
	if cfg.Timeout != 5*time.Second {
		t.Fatalf("Timeout = %s", cfg.Timeout)
	}
	if !background || daemon {
		t.Fatalf("background=%v daemon=%v", background, daemon)
	}
	if logFile != "proxy.log" {
		t.Fatalf("logFile = %s", logFile)
	}
}

func TestParseFlagsDefaultsBackgroundLogFile(t *testing.T) {
	clearProxyEnv(t)

	_, background, _, logFile := parseFlags([]string{"-b"})

	if !background {
		t.Fatalf("background = false")
	}
	if logFile != "mailman-proxy.log" {
		t.Fatalf("logFile = %s", logFile)
	}
}

func clearProxyEnv(t *testing.T) {
	t.Helper()

	for _, name := range []string{
		"MAILMAN_PROXY_LISTEN_IP",
		"MAILMAN_PROXY_PORT",
		"MAILMAN_PROXY_TARGET",
		"MAILMAN_PROXY_LOG",
		"MAILMAN_PROXY_VERBOSE",
		"MAILMAN_PROXY_TIMEOUT",
		"MAILMAN_PROXY_LOG_FILE",
	} {
		t.Setenv(name, "")
	}
}
