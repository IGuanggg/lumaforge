package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/IGuanggg/lumaforge/config"
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
	if strings.Contains(stringFromAny(capability["reason"]), "??") {
		t.Fatalf("expected readable missing bridge reason, got %#v", capability["reason"])
	}
}

func TestLumaUpdateCapabilityDistinguishesSourceAndDesktopModes(t *testing.T) {
	previousLegacyAPI := config.Cfg.LumaForgeLegacyAPI
	t.Cleanup(func() {
		config.Cfg.LumaForgeLegacyAPI = previousLegacyAPI
	})

	t.Setenv("LUMAFORGE_DESKTOP", "")
	t.Setenv("INFINITE_CANVAS_DESKTOP", "")
	config.Cfg.LumaForgeLegacyAPI = ""
	source := LumaUpdateCapability()
	if source["supported"] != false || source["mode"] != "source-mode" || source["desktop"] != false {
		t.Fatalf("source capability = %#v, want source-mode unsupported", source)
	}

	t.Setenv("LUMAFORGE_DESKTOP", "1")
	desktopMissing := LumaUpdateCapability()
	if desktopMissing["supported"] != false || desktopMissing["mode"] != "legacy-updater-missing" || desktopMissing["desktop"] != true {
		t.Fatalf("desktop missing capability = %#v, want missing updater", desktopMissing)
	}

	config.Cfg.LumaForgeLegacyAPI = "http://127.0.0.1:18084/"
	bridged := LumaUpdateCapability()
	if bridged["supported"] != true || bridged["mode"] != "desktop-updater" || bridged["legacy_api_url"] != "http://127.0.0.1:18084" {
		t.Fatalf("bridged capability = %#v, want desktop updater", bridged)
	}
}

func TestLumaReleaseHealthMarksSourceUpdateAsWarning(t *testing.T) {
	previousConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = previousConfig })

	t.Setenv("LUMAFORGE_DESKTOP", "")
	t.Setenv("INFINITE_CANVAS_DESKTOP", "")
	t.Setenv("APP_ASSETS_DIR", t.TempDir())
	config.Cfg = config.Config{
		LumaForgeDataDir: t.TempDir(),
		UpdateCheckURL:   "https://updates.example.com/releases",
		Port:             "18082",
	}

	health := LumaReleaseHealth()
	autoUpdate := releaseHealthCheckByID(t, health, "auto_update")
	if autoUpdate["status"] != "warn" {
		t.Fatalf("source auto update check = %#v, want warn", autoUpdate)
	}

	t.Setenv("LUMAFORGE_DESKTOP", "1")
	health = LumaReleaseHealth()
	autoUpdate = releaseHealthCheckByID(t, health, "auto_update")
	if autoUpdate["status"] != "error" {
		t.Fatalf("desktop missing updater check = %#v, want error", autoUpdate)
	}
}

func TestLumaUpdatePreflightExpandsSourceModeChecks(t *testing.T) {
	previousConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = previousConfig })

	t.Setenv("LUMAFORGE_DESKTOP", "")
	t.Setenv("INFINITE_CANVAS_DESKTOP", "")
	t.Setenv("APP_ASSETS_DIR", t.TempDir())
	config.Cfg = config.Config{
		LumaForgeDataDir: t.TempDir(),
		UpdateCheckURL:   "https://updates.example.com/releases",
		Port:             "18082",
	}

	payload := LumaUpdatePreflight()
	checks, ok := payload["checks"].([]map[string]any)
	if !ok {
		t.Fatalf("preflight checks missing: %#v", payload)
	}
	if len(checks) < 8 {
		t.Fatalf("preflight checks = %#v, want expanded update checks", checks)
	}
	if payload["ok"] != true {
		t.Fatalf("source mode should warn but not block when paths/source are valid: %#v", payload)
	}
	sourceMode := updatePreflightCheckByID(t, payload, "source_mode")
	if sourceMode["ok"] != false || sourceMode["blocking"] != false {
		t.Fatalf("source mode check = %#v, want non-blocking warning", sourceMode)
	}
	for _, id := range []string{"version", "update_source", "downloads_dir", "staging_dir", "backups_dir", "data_dir", "assets_dir", "desktop_updater"} {
		updatePreflightCheckByID(t, payload, id)
	}
}

func releaseHealthCheckByID(t *testing.T, health map[string]any, id string) map[string]any {
	t.Helper()

	checks, ok := health["checks"].([]map[string]any)
	if !ok {
		t.Fatalf("release health checks missing or malformed: %#v", health["checks"])
	}
	for _, check := range checks {
		if check["id"] == id {
			return check
		}
	}
	t.Fatalf("release health check %q not found in %#v", id, checks)
	return nil
}

func updatePreflightCheckByID(t *testing.T, payload map[string]any, id string) map[string]any {
	t.Helper()

	checks, ok := payload["checks"].([]map[string]any)
	if !ok {
		t.Fatalf("preflight checks missing or malformed: %#v", payload["checks"])
	}
	for _, check := range checks {
		if check["id"] == id {
			return check
		}
	}
	t.Fatalf("preflight check %q not found in %#v", id, checks)
	return nil
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

func TestLumaUpdateStateClearsArtifactsForCurrentVersion(t *testing.T) {
	previousDataDir := config.Cfg.LumaForgeDataDir
	t.Cleanup(func() { config.Cfg.LumaForgeDataDir = previousDataDir })
	config.Cfg.LumaForgeDataDir = t.TempDir()

	state := LumaSaveUpdateState(map[string]any{
		"phase":           "failed",
		"latest_version":  "",
		"target_version":  LumaForgeVersion,
		"selected_asset":  map[string]any{"name": "LumaForge-2.0.30-desktop.zip"},
		"filename":        "LumaForge-2.0.30-desktop.zip",
		"path":            filepath.Join(config.Cfg.LumaForgeDataDir, "updates", "downloads", "old.zip"),
		"package_size":    123,
		"sha256_expected": "old-sha",
		"error":           "old failure",
	})
	if state["phase"] != "idle" || state["selected_asset"] != nil || state["filename"] != "" || state["path"] != "" {
		t.Fatalf("stale update artifacts were not cleared: %#v", state)
	}
	if state["can_cleanup"] != false || state["error"] != nil {
		t.Fatalf("stale cleanup/error state remained: %#v", state)
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

func TestLumaUpdateCheckSelectsNewerDesktopRelease(t *testing.T) {
	previousConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = previousConfig })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/releases" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{
				"tag_name":   "v2.1.16",
				"name":       "LumaForge 2.1.16",
				"draft":      false,
				"prerelease": false,
				"body":       "quality release",
				"assets": []map[string]any{
					{"name": "LumaForge-2.1.16-web.zip", "browser_download_url": "https://cdn.example.com/web.zip", "size": 10},
					{"name": "LumaForge-2.1.16-desktop.zip", "browser_download_url": "https://cdn.example.com/desktop.zip", "size": 20},
				},
			},
			{
				"tag_name":   "v2.1.16-beta",
				"draft":      false,
				"prerelease": true,
			},
		})
	}))
	defer server.Close()

	config.Cfg = config.Config{
		LumaForgeDataDir: t.TempDir(),
		UpdateCheckURL:   server.URL + "/releases",
	}

	result := LumaUpdateCheck()
	if result["ok"] != true || result["configured"] != true || result["latest_version"] != "2.1.16" || result["is_newer"] != true {
		t.Fatalf("unexpected update result: %#v", result)
	}
	asset, ok := result["selected_asset"].(map[string]any)
	if !ok {
		t.Fatalf("selected asset missing: %#v", result)
	}
	if asset["name"] != "LumaForge-2.1.16-desktop.zip" || asset["url"] != "https://cdn.example.com/desktop.zip" {
		t.Fatalf("selected asset = %#v, want desktop zip", asset)
	}
	state := LumaUpdateState()
	if state["phase"] != "found" || state["latest_version"] != "2.1.16" {
		t.Fatalf("update state = %#v, want found 2.1.16", state)
	}
}

func TestLumaUpdateCheckTreatsLatest214AsCurrent(t *testing.T) {
	previousConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = previousConfig })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name":   "v2.1.15",
			"draft":      false,
			"prerelease": false,
			"assets": []map[string]any{
				{"name": "LumaForge-2.1.15-desktop.zip", "browser_download_url": "https://cdn.example.com/current.zip"},
			},
		})
	}))
	defer server.Close()

	config.Cfg = config.Config{
		LumaForgeDataDir: t.TempDir(),
		UpdateCheckURL:   server.URL + "/latest",
	}

	result := LumaUpdateCheck()
	if result["current_version"] != "2.1.15" {
		t.Fatalf("current version = %#v, want 2.1.15", result["current_version"])
	}
	if result["latest_version"] != "2.1.15" || result["is_newer"] != false || result["selected_asset"] != nil {
		t.Fatalf("2.1.15 should be treated as current, got %#v", result)
	}
	state := LumaUpdateState()
	if state["phase"] != "idle" {
		t.Fatalf("state = %#v, want idle for current release", state)
	}
}

func TestReleaseVersionAndVersionComparisonHelpers(t *testing.T) {
	cases := []struct {
		release map[string]any
		want    string
	}{
		{map[string]any{"tag_name": "v2.1.12"}, "2.1.12"},
		{map[string]any{"tag_name": "", "name": "V2.1.15"}, "2.1.15"},
		{map[string]any{"tag_name": "20.0.29"}, "2.0.29"},
	}
	for _, tc := range cases {
		if got := releaseVersion(tc.release); got != tc.want {
			t.Fatalf("releaseVersion(%#v) = %q, want %q", tc.release, got, tc.want)
		}
	}

	comparisons := []struct {
		a, b string
		want int
	}{
		{"v2.1.16", "2.1.15", 1},
		{"2.1.15", "2.1.15", 0},
		{"2.1.13", "2.1.15", -1},
		{"2.1.12-beta", "2.1.11", 1},
	}
	for _, tc := range comparisons {
		if got := compareVersion(tc.a, tc.b); got != tc.want {
			t.Fatalf("compareVersion(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestSelectDesktopZipAssetFallsBackToFirstAsset(t *testing.T) {
	release := map[string]any{
		"assets": []any{
			map[string]any{"name": "notes.txt", "browser_download_url": "https://cdn.example.com/notes.txt", "size": 1},
			map[string]any{"name": "LumaForge-2.1.12-browser.zip", "browser_download_url": "https://cdn.example.com/browser.zip", "size": 10},
			map[string]any{"name": "LumaForge-2.1.12-desktop.zip", "url": "https://api.example.com/asset/1?download=1", "size": 20, "digest": "sha256:abc123"},
		},
	}
	asset := selectDesktopZipAsset(release)
	if asset["name"] != "LumaForge-2.1.12-desktop.zip" || asset["url"] != "https://api.example.com/asset/1?download=1" {
		t.Fatalf("desktop asset = %#v", asset)
	}
	if asset["sha256"] != "abc123" {
		t.Fatalf("desktop asset sha256 = %#v, want abc123", asset["sha256"])
	}

	urlDesktop := selectDesktopZipAsset(map[string]any{"assets": []any{
		map[string]any{"name": "download", "browser_download_url": "https://cdn.example.com/LumaForge-2.1.12-desktop.zip?download=1"},
	}})
	if urlDesktop["name"] != "download" || urlDesktop["url"] != "https://cdn.example.com/LumaForge-2.1.12-desktop.zip?download=1" {
		t.Fatalf("url desktop asset = %#v", urlDesktop)
	}

	fallback := selectDesktopZipAsset(map[string]any{"assets": []any{
		map[string]any{"name": "only-installer.exe", "browser_download_url": "https://cdn.example.com/installer.exe"},
		map[string]any{"name": "LumaForge-2.1.12-web.zip", "browser_download_url": "https://cdn.example.com/web.zip"},
	}})
	if fallback["name"] != "LumaForge-2.1.12-web.zip" {
		t.Fatalf("fallback asset = %#v", fallback)
	}

	none := selectDesktopZipAsset(map[string]any{"assets": []any{
		map[string]any{"name": "only-installer.exe", "browser_download_url": "https://cdn.example.com/installer.exe"},
		map[string]any{"name": "checksum.txt", "browser_download_url": "https://cdn.example.com/checksum.txt"},
	}})
	if len(none) != 0 {
		t.Fatalf("non-zip assets should not be selected: %#v", none)
	}
}

func TestLumaProbeProviderProtocolDetectsOpenAIModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"id": "gpt-image-2"}},
		})
	}))
	defer server.Close()

	result := LumaProbeProviderProtocol(LumaAPIProvider{BaseURL: server.URL + "/v1"}, "test-key")
	if result["protocol"] != "openai" || result["confidence"] != "high" {
		t.Fatalf("expected high-confidence OpenAI protocol, got %#v", result)
	}
	if result["model_count"] != 1 {
		t.Fatalf("expected one model, got %#v", result)
	}
}

func TestLumaProbeProviderProtocolKeepsManualModelsAsOpenAIFallback(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()

	result := LumaProbeProviderProtocol(LumaAPIProvider{
		BaseURL:     server.URL + "/v1",
		ImageModels: []string{"manual-image-model"},
	}, "test-key")
	if result["protocol"] != "openai" || result["confidence"] != "low" {
		t.Fatalf("expected low-confidence OpenAI fallback for manual models, got %#v", result)
	}
	if result["reason"] != "manual_models_fallback" {
		t.Fatalf("expected manual model fallback reason, got %#v", result["reason"])
	}
}

func TestLumaProbeProviderProtocolDetectsAsyncTaskEndpoint(t *testing.T) {
	result := LumaProbeProviderProtocol(LumaAPIProvider{BaseURL: "https://example.com/contents/generations/tasks"}, "")
	if result["protocol"] != "apimart" || result["confidence"] != "medium" {
		t.Fatalf("expected APIMart async protocol hint, got %#v", result)
	}
}

func TestLumaProbeProviderProtocolHonorsManualOverride(t *testing.T) {
	result := LumaProbeProviderProtocol(LumaAPIProvider{
		BaseURL:          "https://example.com/apimart-looking-path",
		ProtocolOverride: "force-openai",
	}, "")
	if result["protocol"] != "openai" || result["confidence"] != "manual" || result["reason"] != "user_override" {
		t.Fatalf("expected manual OpenAI override to win over URL hints, got %#v", result)
	}

	result = LumaProbeProviderProtocol(LumaAPIProvider{
		BaseURL:          "https://example.com/v1",
		ProtocolOverride: "force-apimart",
	}, "")
	if result["protocol"] != "apimart" || result["confidence"] != "manual" || result["reason"] != "user_override" {
		t.Fatalf("expected manual APIMart override, got %#v", result)
	}
}

func TestLumaCanvasSourceCapabilitiesReadsFrontendEndpoint(t *testing.T) {
	previousAppURL := os.Getenv("LUMAFORGE_APP_URL")
	previousPublicBaseURL := config.Cfg.PublicBaseURL
	t.Cleanup(func() {
		_ = os.Setenv("LUMAFORGE_APP_URL", previousAppURL)
		config.Cfg.PublicBaseURL = previousPublicBaseURL
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/canvas/capabilities" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":          true,
			"prompt_refs": true,
			"history":     true,
			"asset_sync":  true,
			"connections": true,
			"version":     "test",
		})
	}))
	defer server.Close()
	_ = os.Setenv("LUMAFORGE_APP_URL", server.URL)
	config.Cfg.PublicBaseURL = ""

	caps := lumaCanvasSourceCapabilities()
	if caps["source"] != "frontend" || caps["prompt_refs"] != true || caps["history"] != true || caps["asset_sync"] != true || caps["connections"] != true {
		t.Fatalf("expected capabilities from frontend endpoint, got %#v", caps)
	}
}

func TestLumaCanvasSourceCapabilitiesFailsClosedWhenFrontendUnavailable(t *testing.T) {
	previousAppURL := os.Getenv("LUMAFORGE_APP_URL")
	previousPublicBaseURL := config.Cfg.PublicBaseURL
	t.Cleanup(func() {
		_ = os.Setenv("LUMAFORGE_APP_URL", previousAppURL)
		config.Cfg.PublicBaseURL = previousPublicBaseURL
	})
	_ = os.Unsetenv("LUMAFORGE_APP_URL")
	config.Cfg.PublicBaseURL = ""

	caps := lumaCanvasSourceCapabilities()
	if caps["source"] != "frontend_unreachable" || caps["prompt_refs"] != false || caps["history"] != false {
		t.Fatalf("expected conservative fallback when frontend is unavailable, got %#v", caps)
	}
}
