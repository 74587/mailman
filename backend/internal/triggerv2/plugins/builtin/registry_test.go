package builtin

import (
	"testing"
)

func TestGetBuiltinPlugins(t *testing.T) {
	plugins := GetBuiltinPlugins()
	if len(plugins) == 0 {
		t.Fatal("expected at least one builtin plugin")
	}

	// Verify all plugins have non-empty IDs
	for i, p := range plugins {
		info := p.GetInfo()
		if info == nil {
			t.Fatalf("plugin at index %d returned nil info", i)
		}
		if info.ID == "" {
			t.Fatalf("plugin at index %d has empty ID", i)
		}
	}
}

func TestGetBuiltinPluginIDs(t *testing.T) {
	ids := GetBuiltinPluginIDs()
	plugins := GetBuiltinPlugins()

	if len(ids) != len(plugins) {
		t.Fatalf("expected %d IDs, got %d", len(plugins), len(ids))
	}

	// Verify IDs match plugins
	for i, id := range ids {
		expected := plugins[i].GetInfo().ID
		if id != expected {
			t.Errorf("ID at index %d: expected %q, got %q", i, expected, id)
		}
	}
}

func TestGetBuiltinPluginByID(t *testing.T) {
	plugins := GetBuiltinPlugins()
	if len(plugins) == 0 {
		t.Fatal("no plugins to test")
	}

	// Test finding each plugin by ID
	for _, p := range plugins {
		id := p.GetInfo().ID
		found := GetBuiltinPluginByID(id)
		if found == nil {
			t.Errorf("GetBuiltinPluginByID(%q) returned nil", id)
			continue
		}
		if found.GetInfo().ID != id {
			t.Errorf("GetBuiltinPluginByID(%q) returned plugin with ID %q", id, found.GetInfo().ID)
		}
	}
}

func TestGetBuiltinPluginByID_NotFound(t *testing.T) {
	result := GetBuiltinPluginByID("nonexistent_plugin_id_12345")
	if result != nil {
		t.Errorf("expected nil for nonexistent plugin, got %v", result.GetInfo().ID)
	}
}

func TestIsBuiltinPlugin(t *testing.T) {
	ids := GetBuiltinPluginIDs()
	if len(ids) == 0 {
		t.Fatal("no plugin IDs to test")
	}

	// All known IDs should return true
	for _, id := range ids {
		if !IsBuiltinPlugin(id) {
			t.Errorf("IsBuiltinPlugin(%q) returned false, expected true", id)
		}
	}

	// Unknown ID should return false
	if IsBuiltinPlugin("nonexistent_plugin_id_12345") {
		t.Error("IsBuiltinPlugin returned true for nonexistent plugin")
	}
}

func TestRegistryConsistency(t *testing.T) {
	// GetBuiltinPluginIDs and GetBuiltinPluginByID should be consistent
	// with GetBuiltinPlugins as the single source of truth
	plugins := GetBuiltinPlugins()
	ids := GetBuiltinPluginIDs()

	if len(plugins) != len(ids) {
		t.Fatalf("plugins count (%d) != IDs count (%d)", len(plugins), len(ids))
	}

	for i, p := range plugins {
		id := p.GetInfo().ID

		// ID list should match
		if ids[i] != id {
			t.Errorf("index %d: ID list has %q, plugin has %q", i, ids[i], id)
		}

		// GetBuiltinPluginByID should find it
		found := GetBuiltinPluginByID(id)
		if found == nil {
			t.Errorf("GetBuiltinPluginByID(%q) returned nil", id)
			continue
		}

		// IsBuiltinPlugin should agree
		if !IsBuiltinPlugin(id) {
			t.Errorf("IsBuiltinPlugin(%q) returned false", id)
		}
	}

	// Verify no duplicate IDs
	seen := make(map[string]bool)
	for _, id := range ids {
		if seen[id] {
			t.Errorf("duplicate plugin ID: %q", id)
		}
		seen[id] = true
	}
}

func TestGetBuiltinPluginInfo(t *testing.T) {
	infos := GetBuiltinPluginInfo()
	plugins := GetBuiltinPlugins()

	if len(infos) != len(plugins) {
		t.Fatalf("expected %d infos, got %d", len(plugins), len(infos))
	}

	for i, info := range infos {
		if info == nil {
			t.Fatalf("nil info at index %d", i)
		}
		if info.ID == "" {
			t.Errorf("empty ID at index %d", i)
		}
	}
}

func TestValidateBuiltinPluginConfig_NotFound(t *testing.T) {
	err := ValidateBuiltinPluginConfig("nonexistent_plugin", nil)
	if err == nil {
		t.Error("expected error for nonexistent plugin, got nil")
	}
}
