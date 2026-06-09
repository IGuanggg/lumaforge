package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/service"
)

func TestLumaMeRawUsesCloudSessionShape(t *testing.T) {
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/me" {
			t.Fatalf("unexpected cloud path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer cloud-token" {
			t.Fatalf("authorization = %q, want bearer token", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"email":          "old@example.com",
			"email_verified": true,
			"display_name":   "Old User",
			"avatar_url":     "https://example.com/avatar.png",
		})
	}))
	defer cloud.Close()
	withTestLumaCloud(t, cloud.URL)

	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.Header.Set("Authorization", "Bearer cloud-token")
	recorder := httptest.NewRecorder()
	LumaMeRaw(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["code"] != nil {
		t.Fatalf("legacy /api/me should return raw cloud shape, got code wrapper: %#v", payload)
	}
	if payload["email"] != "old@example.com" || payload["display_name"] != "Old User" {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestLumaConfigsCurrentDownloadsAndAppliesCloudProviders(t *testing.T) {
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/me":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"email":          "sync@example.com",
				"email_verified": true,
				"display_name":   "Sync User",
				"avatar_url":     "",
			})
		case "/api/configs/current":
			if r.Method != http.MethodGet {
				t.Fatalf("method = %s, want GET", r.Method)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"updated_at": float64(12345),
				"config": map[string]any{
					"api_providers": []map[string]any{{
						"id":           "openai",
						"name":         "OpenAI Compatible",
						"base_url":     "https://api.example.com/v1",
						"protocol":     "openai",
						"enabled":      true,
						"primary":      true,
						"image_models": []string{"gpt-image-2-vip"},
						"chat_models":  []string{"gpt-5.5"},
					}},
					"api_keys": map[string]any{
						"openai": "sk-cloud-openai",
					},
				},
			})
		default:
			t.Fatalf("unexpected cloud path: %s", r.URL.Path)
		}
	}))
	defer cloud.Close()
	withTestLumaCloud(t, cloud.URL)

	request := httptest.NewRequest(http.MethodGet, "/api/configs/current", nil)
	request.Header.Set("Authorization", "Bearer cloud-token")
	recorder := httptest.NewRecorder()
	LumaConfigsCurrent(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["config"] == nil || payload["updated_at"] != float64(12345) {
		t.Fatalf("payload = %#v", payload)
	}
	providers := service.LumaLoadProviders()
	if len(providers) != 1 || providers[0].BaseURL != "https://api.example.com/v1" {
		t.Fatalf("providers = %#v", providers)
	}
	if !containsString(providers[0].ImageModels, "nano-banana") {
		t.Fatalf("provider defaults were not merged: %#v", providers[0].ImageModels)
	}
	keys := service.LumaLoadProviderKeys()
	if keys["openai"] != "sk-cloud-openai" {
		t.Fatalf("cloud api key was not restored: %#v", keys)
	}
}

func withTestLumaCloud(t *testing.T, cloudURL string) {
	t.Helper()
	previous := config.Cfg
	config.Cfg = config.Config{
		LumaForgeDataDir:  t.TempDir(),
		LumaForgeCloudURL: strings.TrimRight(cloudURL, "/"),
	}
	t.Cleanup(func() { config.Cfg = previous })
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
