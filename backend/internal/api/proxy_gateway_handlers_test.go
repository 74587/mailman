package api

import (
	"mailman/internal/models"
	"testing"
)

func TestValidateProxyGatewayListenerAllowsOptionalExternalPort(t *testing.T) {
	item := models.ProxyGatewayListener{
		ListenIP:     "127.0.0.1",
		Port:         18080,
		ExternalPort: 0,
		RequireAuth:  true,
	}
	if message := validateProxyGatewayListener(item); message != "" {
		t.Fatalf("expected empty external port to be valid, got %q", message)
	}

	item.ExternalPort = 32027
	if message := validateProxyGatewayListener(item); message != "" {
		t.Fatalf("expected mapped external port to be valid, got %q", message)
	}
}

func TestValidateProxyGatewayListenerRejectsInvalidExternalPort(t *testing.T) {
	item := models.ProxyGatewayListener{
		ListenIP:     "127.0.0.1",
		Port:         18080,
		ExternalPort: 70000,
		RequireAuth:  true,
	}
	if message := validateProxyGatewayListener(item); message == "" {
		t.Fatal("expected invalid external port to be rejected")
	}
}
