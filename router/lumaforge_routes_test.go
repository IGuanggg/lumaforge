package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/IGuanggg/lumaforge/config"
	"github.com/gin-gonic/gin"
)

func TestLegacyCloudCompatibilityRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" && got != "Bearer cloud-token" {
			t.Fatalf("authorization = %q", got)
		}
		switch r.URL.Path {
		case "/api/me":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"email":          "route@example.com",
				"email_verified": true,
				"display_name":   "Route User",
				"avatar_url":     "",
			})
		case "/api/media/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "total": 1})
		case "/api/auth/password/forgot":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "email_sent": true})
		default:
			t.Fatalf("unexpected cloud path: %s", r.URL.Path)
		}
	}))
	defer cloud.Close()
	withRouteTestCloud(t, cloud.URL)
	engine := New()

	for _, item := range []struct {
		name          string
		method        string
		path          string
		body          string
		wantSubstring string
	}{
		{name: "me", method: http.MethodGet, path: "/api/me", wantSubstring: "route@example.com"},
		{name: "media status", method: http.MethodGet, path: "/api/media/status", wantSubstring: "\"total\":1"},
		{name: "password forgot", method: http.MethodPost, path: "/api/auth/password/forgot", body: `{"email":"route@example.com"}`, wantSubstring: "\"email_sent\":true"},
	} {
		t.Run(item.name, func(t *testing.T) {
			request := httptest.NewRequest(item.method, item.path, strings.NewReader(item.body))
			request.Header.Set("Authorization", "Bearer cloud-token")
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), item.wantSubstring) {
				t.Fatalf("body = %s, want %s", recorder.Body.String(), item.wantSubstring)
			}
		})
	}
}

func withRouteTestCloud(t *testing.T, cloudURL string) {
	t.Helper()
	previous := config.Cfg
	config.Cfg = config.Config{
		LumaForgeDataDir:  t.TempDir(),
		LumaForgeCloudURL: strings.TrimRight(cloudURL, "/"),
	}
	t.Cleanup(func() { config.Cfg = previous })
}
