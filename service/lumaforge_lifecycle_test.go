package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
)

func TestLumaAppActionCapabilityUsesLegacyBridge(t *testing.T) {
	previousLegacyAPI := config.Cfg.LumaForgeLegacyAPI
	t.Cleanup(func() {
		config.Cfg.LumaForgeLegacyAPI = previousLegacyAPI
	})

	config.Cfg.LumaForgeLegacyAPI = "http://127.0.0.1:8090/"
	capability := LumaAppActionCapability()

	if capability["restart_supported"] != true {
		t.Fatalf("expected restart to be supported through legacy bridge: %#v", capability)
	}
	if capability["exit_supported"] != true {
		t.Fatalf("expected exit to be supported through legacy bridge: %#v", capability)
	}
	if capability["restart_mode"] != "desktop-bridge" {
		t.Fatalf("expected desktop-bridge restart mode, got %#v", capability["restart_mode"])
	}
	if capability["legacy_api_url"] != "http://127.0.0.1:8090" {
		t.Fatalf("expected normalized legacy url, got %#v", capability["legacy_api_url"])
	}
}

func TestLumaAppActionCapabilityExplainsMissingBridge(t *testing.T) {
	previousLegacyAPI := config.Cfg.LumaForgeLegacyAPI
	t.Cleanup(func() {
		config.Cfg.LumaForgeLegacyAPI = previousLegacyAPI
	})

	config.Cfg.LumaForgeLegacyAPI = ""
	capability := LumaAppActionCapability()

	if capability["restart_supported"] != false {
		t.Fatalf("expected restart to be disabled without bridge: %#v", capability)
	}
	if capability["exit_supported"] != false {
		t.Fatalf("expected exit to be disabled without bridge: %#v", capability)
	}
	if capability["reason"] == "" {
		t.Fatalf("expected a visible reason when bridge is missing: %#v", capability)
	}
}

func TestLumaUpdateStateMarksStalledDownloads(t *testing.T) {
	previousDataDir := config.Cfg.LumaForgeDataDir
	t.Cleanup(func() {
		config.Cfg.LumaForgeDataDir = previousDataDir
	})
	config.Cfg.LumaForgeDataDir = t.TempDir()

	LumaSaveUpdateState(map[string]any{
		"phase":            "downloading",
		"downloaded_bytes": 2,
		"total_bytes":      100,
		"last_progress_at": time.Now().Add(-time.Minute).UnixMilli(),
		"filename":         "LumaForge-test-desktop.zip",
	})

	state := LumaUpdateState()
	if state["stalled"] != true {
		t.Fatalf("expected stalled download state: %#v", state)
	}
	if state["can_cleanup"] != true {
		t.Fatalf("expected cleanup to be available: %#v", state)
	}
	if state["download_progress"] != 2.0 {
		t.Fatalf("expected 2%% progress, got %#v", state["download_progress"])
	}
}

func TestLumaCleanupUpdatePackageOnlyRemovesDownloadArtifacts(t *testing.T) {
	previousDataDir := config.Cfg.LumaForgeDataDir
	t.Cleanup(func() {
		config.Cfg.LumaForgeDataDir = previousDataDir
	})
	config.Cfg.LumaForgeDataDir = t.TempDir()

	downloadsDir := filepath.Join(config.Cfg.LumaForgeDataDir, "updates", "downloads")
	if err := os.MkdirAll(downloadsDir, 0755); err != nil {
		t.Fatal(err)
	}
	tempFile := filepath.Join(downloadsDir, "LumaForge-test-desktop.zip.part")
	if err := os.WriteFile(tempFile, []byte("partial"), 0644); err != nil {
		t.Fatal(err)
	}

	state := LumaSaveUpdateState(map[string]any{
		"phase":     "downloading",
		"filename":  "LumaForge-test-desktop.zip",
		"temp_path": tempFile,
		"path":      filepath.Join(downloadsDir, "LumaForge-test-desktop.zip"),
	})
	if state["can_cleanup"] != true {
		t.Fatalf("expected cleanup state before cleanup: %#v", state)
	}

	cleaned := LumaCleanupUpdatePackage()
	if _, err := os.Stat(tempFile); !os.IsNotExist(err) {
		t.Fatalf("expected temp file to be removed, stat err=%v", err)
	}
	if cleaned["phase"] != "idle" {
		t.Fatalf("expected idle phase after cleanup: %#v", cleaned)
	}
}
