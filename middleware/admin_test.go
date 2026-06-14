package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/gin-gonic/gin"
)

func TestUserAuthRejectsMissingSession(t *testing.T) {
	router := testAuthRouter(UserAuth)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/protected", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 legacy error envelope", recorder.Code)
	}
	payload := decodeMiddlewarePayload(t, recorder)
	if payload["code"] != float64(1) {
		t.Fatalf("payload = %#v, want code=1", payload)
	}
}

func TestOptionalAuthAllowsMissingSession(t *testing.T) {
	router := testAuthRouter(OptionalAuth)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/protected", nil))

	payload := decodeMiddlewarePayload(t, recorder)
	if payload["has_user"] != false {
		t.Fatalf("payload = %#v, want has_user=false", payload)
	}
}

func TestUserAuthRestoresCloudSessionFromCookie(t *testing.T) {
	withMiddlewareCloudSession(t, service.LumaCloudSession{
		Token:       "cookie-token",
		Email:       "user@example.com",
		DisplayName: "Cookie User",
	})
	router := testAuthRouter(UserAuth)
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{Name: lumaAuthCookieName, Value: "cookie-token"})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	payload := decodeMiddlewarePayload(t, recorder)
	if payload["has_user"] != true || payload["username"] != "user@example.com" || payload["role"] != string(model.UserRoleUser) {
		t.Fatalf("payload = %#v, want restored user session", payload)
	}
}

func TestAdminAuthRequiresAdminRole(t *testing.T) {
	withMiddlewareCloudSession(t, service.LumaCloudSession{
		Token: "user-token",
		Email: "user@example.com",
	})
	router := testAuthRouter(AdminAuth)
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("Authorization", "Bearer user-token")

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	payload := decodeMiddlewarePayload(t, recorder)
	if payload["code"] != float64(1) {
		t.Fatalf("payload = %#v, want permission denial", payload)
	}
}

func TestAdminAuthAllowsAdminCloudSession(t *testing.T) {
	withMiddlewareCloudSession(t, service.LumaCloudSession{
		Token:       "admin-token",
		Email:       "admin",
		DisplayName: "Admin",
	})
	router := testAuthRouter(AdminAuth)
	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("Authorization", "Bearer admin-token")

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	payload := decodeMiddlewarePayload(t, recorder)
	if payload["has_user"] != true || payload["role"] != string(model.UserRoleAdmin) {
		t.Fatalf("payload = %#v, want admin user in context", payload)
	}
}

func TestNotFoundJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.NoRoute(NotFoundJSON)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/missing", nil))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
	payload := decodeMiddlewarePayload(t, recorder)
	if payload["code"] != float64(1) || payload["data"] != nil {
		t.Fatalf("payload = %#v, want standard not-found envelope", payload)
	}
}

func testAuthRouter(middleware gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/protected", middleware, func(c *gin.Context) {
		user, ok := service.UserFromContext(c.Request.Context())
		c.JSON(http.StatusOK, gin.H{
			"has_user": ok,
			"username": user.Username,
			"role":     string(user.Role),
		})
	})
	return router
}

func withMiddlewareCloudSession(t *testing.T, session service.LumaCloudSession) {
	t.Helper()
	previous := config.Cfg
	config.Cfg = config.Config{
		LumaForgeDataDir:  t.TempDir(),
		LumaForgeCloudURL: "https://cloud.example.com",
	}
	if err := service.LumaSaveCloudSession(session); err != nil {
		t.Fatalf("save cloud session: %v", err)
	}
	t.Cleanup(func() { config.Cfg = previous })
}

func decodeMiddlewarePayload(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, recorder.Body.String())
	}
	return payload
}
