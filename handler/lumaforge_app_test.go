package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
)

func TestLumaAuthTokenFromRequestPrefersBearerThenCookie(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Authorization", "Bearer header-token")
	request.AddCookie(&http.Cookie{Name: lumaAuthCookieName, Value: "cookie-token"})

	if got := lumaAuthTokenFromRequest(request); got != "header-token" {
		t.Fatalf("token = %q, want header-token", got)
	}

	request = httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: lumaAuthCookieName, Value: "cookie-token"})
	if got := lumaAuthTokenFromRequest(request); got != "cookie-token" {
		t.Fatalf("token = %q, want cookie-token", got)
	}
}

func TestWriteRawErrorUsesJSONDetailAndStatus(t *testing.T) {
	recorder := httptest.NewRecorder()

	writeRawError(recorder, http.StatusTeapot, fmt.Errorf("boom"))

	if recorder.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusTeapot)
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
		t.Fatalf("content type = %q, want json", contentType)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["detail"] != "boom" || payload["message"] != "boom" {
		t.Fatalf("payload = %#v, want detail/message boom", payload)
	}
}

func TestCookieClearAndStringConversionHelpers(t *testing.T) {
	recorder := httptest.NewRecorder()
	clearLumaAuthCookie(recorder)
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != lumaAuthCookieName || cookies[0].MaxAge != -1 {
		t.Fatalf("clear cookie headers = %#v", cookies)
	}

	if got := lumaStringFromAny(nil); got != "" {
		t.Fatalf("nil string = %q, want empty", got)
	}
	if got := lumaStringFromAny(customStringer{"token"}); got != "token" {
		t.Fatalf("stringer string = %q, want token", got)
	}
	if got := lumaStringFromAny(42); got != "42" {
		t.Fatalf("numeric string = %q, want 42", got)
	}
}

func TestLumaConfigAndTokenExposePrimaryProvider(t *testing.T) {
	withTempHandlerLumaConfig(t, nil)

	put := httptest.NewRequest(http.MethodPut, "/api/lumaforge/providers", strings.NewReader(`[
		{"id":"local-image","name":"Local Image","base_url":"https://api.example.com/v1","api_key":"sk-test","enabled":true,"primary":true,"image_models":["gpt-image-2"],"chat_models":["gpt-5"],"video_models":["sora-2"]}
	]`))
	putRecorder := httptest.NewRecorder()
	LumaProviders(putRecorder, put)
	putPayload := decodeHandlerPayload(t, putRecorder)
	providers, ok := putPayload["providers"].([]any)
	if !ok || len(providers) != 1 {
		t.Fatalf("provider save payload = %#v", putPayload)
	}
	saved, _ := providers[0].(map[string]any)
	if saved["api_key"] != nil && saved["api_key"] != "" {
		t.Fatalf("provider leaked api_key in response: %#v", saved)
	}
	if saved["has_key"] != true {
		t.Fatalf("provider has_key = %#v, want true", saved["has_key"])
	}

	getRecorder := httptest.NewRecorder()
	LumaProviders(getRecorder, httptest.NewRequest(http.MethodGet, "/api/lumaforge/providers", nil))
	getPayload := decodeHandlerPayload(t, getRecorder)
	if gotProviders, ok := getPayload["providers"].([]any); !ok || len(gotProviders) != 1 {
		t.Fatalf("provider get payload = %#v", getPayload)
	}

	configRecorder := httptest.NewRecorder()
	LumaConfig(configRecorder, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	configPayload := decodeHandlerPayload(t, configRecorder)
	if configPayload["base_url"] != "https://api.example.com/v1" {
		t.Fatalf("config payload = %#v", configPayload)
	}

	tokenRecorder := httptest.NewRecorder()
	LumaConfigToken(tokenRecorder, httptest.NewRequest(http.MethodGet, "/api/config/token", nil))
	tokenPayload := decodeHandlerPayload(t, tokenRecorder)
	if tokenPayload["token"] != "sk-test" {
		t.Fatalf("token payload = %#v", tokenPayload)
	}
}

func TestLumaProviderFetchModelsDraftUsesCurrentForm(t *testing.T) {
	withTempHandlerLumaConfig(t, nil)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer sk-draft" {
			t.Fatalf("authorization = %q, want draft key", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"id": "gpt-image-2"},
				{"id": "gpt-5"},
			},
		})
	}))
	defer server.Close()

	body := fmt.Sprintf(`{"id":"draft-provider","base_url":%q,"api_key":"sk-draft"}`, server.URL+"/v1")
	recorder := httptest.NewRecorder()
	LumaProviderFetchModelsDraft(recorder, httptest.NewRequest(http.MethodPost, "/api/providers/fetch-models", strings.NewReader(body)))
	payload := decodeHandlerPayload(t, recorder)
	if payload["ok"] != true || payload["total"] != float64(2) {
		t.Fatalf("draft fetch payload = %#v", payload)
	}
	imageModels, _ := payload["image_models"].([]any)
	if len(imageModels) != 1 || imageModels[0] != "gpt-image-2" {
		t.Fatalf("image models = %#v", payload["image_models"])
	}
}

func TestLumaProviderFetchModelsDraftReusesSavedKey(t *testing.T) {
	withTempHandlerLumaConfig(t, nil)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer sk-saved" {
			t.Fatalf("authorization = %q, want saved key", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]any{{"id": "gpt-5"}}})
	}))
	defer server.Close()

	put := httptest.NewRequest(http.MethodPut, "/api/lumaforge/providers", strings.NewReader(fmt.Sprintf(`[
		{"id":"saved-provider","name":"Saved","base_url":%q,"api_key":"sk-saved","enabled":true,"primary":true,"chat_models":["manual-chat"]}
	]`, server.URL+"/v1")))
	LumaProviders(httptest.NewRecorder(), put)

	recorder := httptest.NewRecorder()
	LumaProviderFetchModelsDraft(recorder, httptest.NewRequest(http.MethodPost, "/api/providers/fetch-models", strings.NewReader(`{"id":"saved-provider"}`)))
	payload := decodeHandlerPayload(t, recorder)
	if payload["ok"] != true || payload["total"] != float64(1) {
		t.Fatalf("saved-key draft fetch payload = %#v", payload)
	}
}

func TestLumaUpdateSettingsReflectsConfiguredSource(t *testing.T) {
	withTempHandlerLumaConfig(t, func(cfg *config.Config) {
		cfg.UpdateCheckURL = "https://updates.example.com/releases"
	})

	request := httptest.NewRequest(http.MethodGet, "/api/app/update-settings", nil)
	recorder := httptest.NewRecorder()
	LumaUpdateSettings(recorder, request)

	payload := decodeHandlerPayload(t, recorder)
	if payload["ok"] != true || payload["update_check_configured"] != true || payload["update_check_url"] != "https://updates.example.com/releases" {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestLumaAppInfoReleaseHealthAndDiagnostics(t *testing.T) {
	withTempHandlerLumaConfig(t, func(cfg *config.Config) {
		cfg.Port = "18082"
		cfg.PublicBaseURL = ""
		cfg.UpdateCheckURL = ""
	})

	recorder := httptest.NewRecorder()
	LumaAppInfo(recorder, httptest.NewRequest(http.MethodGet, "/api/app/info", nil))
	payload := decodeHandlerPayload(t, recorder)
	if payload["name"] != "LumaForge" || payload["paths"] == nil || payload["update_state"] == nil {
		t.Fatalf("app info payload = %#v", payload)
	}

	recorder = httptest.NewRecorder()
	LumaReleaseHealth(recorder, httptest.NewRequest(http.MethodGet, "/api/app/release-health", nil))
	payload = decodeHandlerPayload(t, recorder)
	checks, ok := payload["checks"].([]any)
	if !ok || len(checks) == 0 {
		t.Fatalf("release health payload = %#v", payload)
	}

	recorder = httptest.NewRecorder()
	LumaLocalDataHealth(recorder, httptest.NewRequest(http.MethodGet, "/api/app/local-data-health", nil))
	payload = decodeHandlerPayload(t, recorder)
	if payload["ok"] != true || payload["paths"] == nil {
		t.Fatalf("local data health payload = %#v", payload)
	}

	recorder = httptest.NewRecorder()
	LumaDiagnostics(recorder, httptest.NewRequest(http.MethodGet, "/api/app/diagnostics", nil))
	payload = decodeHandlerPayload(t, recorder)
	if payload["ok"] != true || payload["checks"] == nil {
		t.Fatalf("diagnostics payload = %#v", payload)
	}
}

func TestLumaUpdateFallbackHandlers(t *testing.T) {
	withTempHandlerLumaConfig(t, func(cfg *config.Config) {
		cfg.LumaForgeLegacyAPI = ""
		cfg.UpdateCheckURL = ""
	})

	recorder := httptest.NewRecorder()
	LumaUpdateState(recorder, httptest.NewRequest(http.MethodGet, "/api/app/update-state", nil))
	payload := decodeHandlerPayload(t, recorder)
	if payload["phase"] != "idle" || payload["current_version"] == "" {
		t.Fatalf("update state payload = %#v", payload)
	}

	recorder = httptest.NewRecorder()
	LumaUpdatePreflight(recorder, httptest.NewRequest(http.MethodPost, "/api/app/update-preflight", nil))
	payload = decodeHandlerPayload(t, recorder)
	if payload["ok"] != false || payload["checks"] == nil || payload["blocking_count"] == float64(0) {
		t.Fatalf("preflight payload = %#v, want blocking missing update source", payload)
	}

	recorder = httptest.NewRecorder()
	LumaUpdateInstall(recorder, httptest.NewRequest(http.MethodPost, "/api/app/update-install", nil))
	payload = decodeHandlerPayload(t, recorder)
	if payload["ok"] != false {
		t.Fatalf("install payload = %#v, want ok=false", payload)
	}

	recorder = httptest.NewRecorder()
	LumaUpdateAuto(recorder, httptest.NewRequest(http.MethodPost, "/api/app/update-auto", nil))
	payload = decodeHandlerPayload(t, recorder)
	if payload["ok"] != false || payload["state"] == nil || payload["capability"] == nil {
		t.Fatalf("auto update payload = %#v", payload)
	}
	state, ok := payload["state"].(map[string]any)
	if !ok || state["phase"] == "failed" {
		t.Fatalf("auto update state = %#v, want non-failed state", payload["state"])
	}

	updatesDir := filepath.Join(config.Cfg.LumaForgeDataDir, "updates", "downloads")
	if err := os.MkdirAll(updatesDir, 0755); err != nil {
		t.Fatalf("mkdir updates dir: %v", err)
	}
	tempPackage := filepath.Join(updatesDir, "package.zip.part")
	if err := os.WriteFile(tempPackage, []byte("partial"), 0644); err != nil {
		t.Fatalf("write temp package: %v", err)
	}
	writeUpdateState(t, map[string]any{
		"phase":     "failed",
		"temp_path": tempPackage,
		"saved_at":  time.Now().UnixMilli(),
	})

	recorder = httptest.NewRecorder()
	LumaUpdateCleanup(recorder, httptest.NewRequest(http.MethodPost, "/api/app/update-cleanup", nil))
	payload = decodeHandlerPayload(t, recorder)
	if payload["ok"] != true {
		t.Fatalf("cleanup payload = %#v", payload)
	}
	if _, err := os.Stat(tempPackage); !os.IsNotExist(err) {
		t.Fatalf("temp package still exists or unexpected stat error: %v", err)
	}
}

func TestLumaUpdateDownloadFallbackWritesFailedState(t *testing.T) {
	withTempHandlerLumaConfig(t, func(cfg *config.Config) {
		cfg.LumaForgeLegacyAPI = ""
		cfg.UpdateCheckURL = ""
	})

	request := httptest.NewRequest(http.MethodPost, "/api/app/update-download", nil)
	recorder := httptest.NewRecorder()
	LumaUpdateDownload(recorder, request)

	payload := decodeHandlerPayload(t, recorder)
	if payload["ok"] != false {
		t.Fatalf("payload = %#v, want ok=false", payload)
	}
	state, ok := payload["state"].(map[string]any)
	if !ok || state["phase"] != "failed" || strings.TrimSpace(fmt.Sprint(state["error"])) == "" {
		t.Fatalf("state = %#v, want failed state with error", payload["state"])
	}
}

func TestLumaUpdateAutoSourceModeDoesNotWriteFailedState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{
				"tag_name":   "v2.1.16",
				"draft":      false,
				"prerelease": false,
				"assets": []map[string]any{
					{"name": "LumaForge-2.1.16-desktop.zip", "browser_download_url": "https://cdn.example.com/desktop.zip", "size": 20},
				},
			},
		})
	}))
	defer server.Close()

	withTempHandlerLumaConfig(t, func(cfg *config.Config) {
		cfg.LumaForgeLegacyAPI = ""
		cfg.UpdateCheckURL = server.URL
	})

	recorder := httptest.NewRecorder()
	LumaUpdateAuto(recorder, httptest.NewRequest(http.MethodPost, "/api/app/update-auto", nil))
	payload := decodeHandlerPayload(t, recorder)
	if payload["ok"] != false || payload["updated"] != false {
		t.Fatalf("auto update payload = %#v, want unsupported source-mode response", payload)
	}
	state, ok := payload["state"].(map[string]any)
	if !ok {
		t.Fatalf("state missing from payload: %#v", payload)
	}
	if state["phase"] == "failed" {
		t.Fatalf("source mode auto update wrote failed state: %#v", state)
	}
	if state["phase"] != "found" || state["latest_version"] != "2.1.16" {
		t.Fatalf("state = %#v, want found 2.1.16", state)
	}
}

func TestLumaAppSelectPathSavesEditablePath(t *testing.T) {
	targetDir := t.TempDir()
	withTempHandlerLumaConfig(t, nil)

	body := []byte(fmt.Sprintf(`{"target":"output","path":%q}`, filepath.Join(targetDir, "output")))
	request := httptest.NewRequest(http.MethodPost, "/api/app/select-path", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	LumaAppSelectPath(recorder, request)

	payload := decodeHandlerPayload(t, recorder)
	if payload["ok"] != true || payload["target"] != "output" {
		t.Fatalf("payload = %#v", payload)
	}
	if got := fmt.Sprint(payload["path"]); !strings.HasSuffix(filepath.Clean(got), filepath.Clean(filepath.Join(targetDir, "output"))) {
		t.Fatalf("path = %q, want selected output path", got)
	}
}

func TestLumaNoopAndHealthHandlers(t *testing.T) {
	withTempHandlerLumaConfig(t, func(cfg *config.Config) {
		cfg.LumaForgeLegacyAPI = ""
	})

	cases := []struct {
		name    string
		handler func(http.ResponseWriter, *http.Request)
		path    string
		wantOK  bool
	}{
		{"cloud-media-status", LumaCloudMediaStatus, "/api/cloud/media/status", false},
		{"cloud-media-noop", LumaCloudMediaNoop, "/api/cloud/media/sync", true},
		{"backups", LumaBackups, "/api/app/backups", true},
		{"backup-noop", LumaBackupNoop, "/api/app/backup", true},
		{"assets-health", LumaAssetsHealth, "/api/assets/health", true},
		{"assets-noop", LumaAssetsNoop, "/api/assets/sync", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			tc.handler(recorder, httptest.NewRequest(http.MethodGet, tc.path, nil))
			payload := decodeHandlerPayload(t, recorder)
			if tc.wantOK && payload["ok"] != true {
				t.Fatalf("%s payload = %#v", tc.name, payload)
			}
			if !tc.wantOK && (payload["local"] == nil || payload["sync"] == nil) {
				t.Fatalf("%s payload = %#v, want status structure", tc.name, payload)
			}
		})
	}
}

func TestLumaRestartAndExitFallbackReturnActionErrors(t *testing.T) {
	withTempHandlerLumaConfig(t, func(cfg *config.Config) {
		cfg.LumaForgeLegacyAPI = ""
	})

	for _, handler := range []func(http.ResponseWriter, *http.Request){LumaAppRestart, LumaAppExit} {
		recorder := httptest.NewRecorder()
		handler(recorder, httptest.NewRequest(http.MethodPost, "/api/app/action", nil))
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", recorder.Code)
		}
		payload := decodeHandlerPayload(t, recorder)
		if strings.TrimSpace(fmt.Sprint(payload["detail"])) == "" {
			t.Fatalf("payload = %#v, want action error detail", payload)
		}
	}
}

func TestLumaAppOpenPathRejectsUnknownTarget(t *testing.T) {
	withTempHandlerLumaConfig(t, nil)

	request := httptest.NewRequest(http.MethodPost, "/api/app/open-path", strings.NewReader(`{"target":"unknown"}`))
	recorder := httptest.NewRecorder()
	LumaAppOpenPath(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	payload := decodeHandlerPayload(t, recorder)
	if strings.TrimSpace(fmt.Sprint(payload["detail"])) == "" {
		t.Fatalf("payload = %#v, want target error detail", payload)
	}
}

func TestResolveLumaOpenPathUsesParentDirectoryForFile(t *testing.T) {
	directory := t.TempDir()
	file := filepath.Join(directory, "asset.png")
	if err := os.WriteFile(file, []byte("image"), 0o600); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveLumaOpenPath("", file)
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.Abs(directory)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != want {
		t.Fatalf("resolved = %q, want %q", resolved, want)
	}
}

func TestLumaAppOpenURLRejectsUnsafeSchemes(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/app/open-url", strings.NewReader(`{"url":"file:///C:/Windows"}`))
	recorder := httptest.NewRecorder()
	LumaAppOpenURL(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	payload := decodeHandlerPayload(t, recorder)
	if strings.TrimSpace(fmt.Sprint(payload["detail"])) == "" {
		t.Fatalf("payload = %#v, want safety error detail", payload)
	}
}

type customStringer struct {
	value string
}

func (s customStringer) String() string {
	return s.value
}

func decodeHandlerPayload(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if recorder.Code != http.StatusOK && recorder.Code != http.StatusBadRequest && recorder.Code != http.StatusTeapot {
		t.Fatalf("unexpected status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return payload
}

func withTempHandlerLumaConfig(t *testing.T, mutate func(*config.Config)) {
	t.Helper()
	previous := config.Cfg
	t.Setenv("LUMAFORGE_APP_URL", "")
	t.Setenv("LUMAFORGE_API_URL", "")
	t.Setenv("LUMAFORGE_DESKTOP", "")
	t.Setenv("INFINITE_CANVAS_DESKTOP", "")
	cfg := config.Config{
		LumaForgeDataDir: t.TempDir(),
		UpdateCheckURL:   "",
		Port:             "18082",
	}
	if mutate != nil {
		mutate(&cfg)
	}
	config.Cfg = cfg
	t.Cleanup(func() { config.Cfg = previous })
}

func writeUpdateState(t *testing.T, state map[string]any) {
	t.Helper()
	path := filepath.Join(config.Cfg.LumaForgeDataDir, "update_state.json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir update state dir: %v", err)
	}
	data, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal update state: %v", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write update state: %v", err)
	}
}
