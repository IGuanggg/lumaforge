package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/service"
)

func writeRawJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(data)
}

func writeRawError(w http.ResponseWriter, status int, err error) {
	if status <= 0 {
		status = http.StatusBadRequest
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"detail": err.Error(), "message": err.Error()})
}

func proxyLegacy(w http.ResponseWriter, r *http.Request) bool {
	baseURL := strings.TrimRight(strings.TrimSpace(config.Cfg.LumaForgeLegacyAPI), "/")
	if baseURL == "" {
		return false
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}
	target := baseURL + r.URL.Path
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, r.Body)
	if err != nil {
		writeRawError(w, http.StatusBadGateway, err)
		return true
	}
	req.Header = r.Header.Clone()
	req.Host = parsed.Host
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeRawError(w, http.StatusBadGateway, fmt.Errorf("legacy API unavailable: %w", err))
		return true
	}
	defer resp.Body.Close()
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
	return true
}

func LumaAuthLogin(w http.ResponseWriter, r *http.Request) {
	var payload map[string]any
	_ = json.NewDecoder(r.Body).Decode(&payload)
	data, err := service.LumaCloudAuth("login", payload)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, data)
}

func LumaAuthRegister(w http.ResponseWriter, r *http.Request) {
	var payload map[string]any
	_ = json.NewDecoder(r.Body).Decode(&payload)
	data, err := service.LumaCloudAuth("register", payload)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, data)
}

func LumaCurrentUser(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if user, ok := service.LumaCurrentAuthUser(token); ok {
		OK(w, user)
		return
	}
	OK(w, service.GuestUser())
}

func LumaCloudStatus(w http.ResponseWriter, r *http.Request) {
	writeRawJSON(w, service.LumaCloudStatus(r.URL.Query().Get("refresh") == "1"))
}

func LumaCloudLogin(w http.ResponseWriter, r *http.Request) {
	lumaCloudAuthRaw(w, r, "login")
}

func LumaCloudRegister(w http.ResponseWriter, r *http.Request) {
	lumaCloudAuthRaw(w, r, "register")
}

func lumaCloudAuthRaw(w http.ResponseWriter, r *http.Request, action string) {
	var payload map[string]any
	_ = json.NewDecoder(r.Body).Decode(&payload)
	data, err := service.LumaCloudAuth(action, payload)
	if err != nil {
		writeRawError(w, http.StatusBadRequest, err)
		return
	}
	session := service.LumaLoadCloudSession()
	writeRawJSON(w, map[string]any{
		"ok":                   true,
		"token":                data["token"],
		"user":                 data["user"],
		"email":                session.Email,
		"display_name":         session.DisplayName,
		"avatar_url":           session.AvatarURL,
		"base_url":             data["base_url"],
		"custom_cloud":         data["custom_cloud"],
		"cloud_config_missing": data["cloud_config_missing"],
	})
}

func LumaCloudLogout(w http.ResponseWriter, r *http.Request) {
	_ = service.LumaSaveCloudSession(service.LumaCloudSession{BaseURL: service.LumaLoadCloudSession().BaseURL})
	writeRawJSON(w, map[string]any{"ok": true})
}

func LumaCloudProfile(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	session := service.LumaLoadCloudSession()
	if session.Token == "" {
		writeRawError(w, http.StatusUnauthorized, fmt.Errorf("请先登录云端账户"))
		return
	}
	if user, ok := service.LumaCurrentAuthUser(session.Token); ok {
		writeRawJSON(w, map[string]any{
			"email":          user.Username,
			"display_name":   user.DisplayName,
			"avatar_url":     user.AvatarURL,
			"email_verified": session.EmailVerified,
			"base_url":       session.BaseURL,
		})
		return
	}
	writeRawError(w, http.StatusUnauthorized, fmt.Errorf("登录已失效，请重新登录"))
}

func LumaCloudUpload(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	payload := map[string]any{}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	configPayload, _ := payload["config"].(map[string]any)
	if configPayload == nil {
		configPayload = service.LumaBuildCloudConfig(true)
	}
	data, err := service.LumaCloudConfigUpload(configPayload)
	if err != nil {
		writeRawError(w, http.StatusBadRequest, err)
		return
	}
	writeRawJSON(w, data)
}

func LumaCloudDownload(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	data, err := service.LumaCloudConfigDownload()
	if err != nil {
		writeRawError(w, http.StatusBadRequest, err)
		return
	}
	writeRawJSON(w, data)
}

func LumaCloudMediaStatus(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{
		"local":  map[string]any{"total": 0, "pending": 0, "synced": 0, "failed": 0},
		"remote": map[string]any{},
		"sync":   map[string]any{"running": false, "last_result": map[string]any{}},
	})
}

func LumaCloudMediaNoop(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "message": "2.1.0 Go 主体已保留云媒体接口；深度媒体同步由 legacy API 或后续迁移器执行。"})
}

func LumaProviders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeRawJSON(w, map[string]any{"providers": service.LumaPublicProviders(service.LumaLoadProviders())})
	case http.MethodPut:
		var providers []service.LumaAPIProvider
		if err := json.NewDecoder(r.Body).Decode(&providers); err != nil {
			writeRawError(w, http.StatusBadRequest, err)
			return
		}
		saved, err := service.LumaSaveProviders(providers)
		if err != nil {
			writeRawError(w, http.StatusBadRequest, err)
			return
		}
		writeRawJSON(w, map[string]any{"providers": saved})
	default:
		writeRawError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func LumaProviderKeyDiagnostics(w http.ResponseWriter, r *http.Request) {
	writeRawJSON(w, map[string]any{
		"orphan_keys": []any{},
		"providers":   service.LumaPublicProviders(service.LumaLoadProviders()),
	})
}

func LumaProviderKeyDiagnosticsClear(w http.ResponseWriter, r *http.Request) {
	writeRawJSON(w, map[string]any{"removed": []string{}, "removed_count": 0, "diagnostics": map[string]any{"orphan_keys": []any{}}})
}

func LumaProviderFetchModels(w http.ResponseWriter, r *http.Request, id string) {
	provider, key, ok := service.LumaProviderByID(id)
	if !ok {
		writeRawError(w, http.StatusNotFound, fmt.Errorf("API 平台不存在"))
		return
	}
	data, err := service.LumaFetchProviderModels(provider, key)
	if err != nil {
		writeRawError(w, http.StatusBadRequest, err)
		return
	}
	writeRawJSON(w, data)
}

func LumaProviderTestConnection(w http.ResponseWriter, r *http.Request) {
	var payload service.LumaAPIProvider
	var raw map[string]any
	_ = json.NewDecoder(r.Body).Decode(&raw)
	payload.ID = firstNonEmpty(firstMapString(raw, "provider_id"), "custom")
	payload.Name = payload.ID
	payload.BaseURL = firstMapString(raw, "base_url")
	payload.APIKey = firstMapString(raw, "api_key")
	data, err := service.LumaFetchProviderModels(payload, payload.APIKey)
	if err != nil {
		writeRawJSON(w, map[string]any{"ok": false, "status": 0, "message": err.Error(), "model_count": 0, "all": []string{}})
		return
	}
	writeRawJSON(w, data)
}

func LumaProviderProbeAsync(w http.ResponseWriter, r *http.Request) {
	writeRawJSON(w, map[string]any{"ok": false, "status_code": 200, "message": "按 OpenAI 兼容协议处理", "raw": map[string]any{}})
}

func LumaConfig(w http.ResponseWriter, r *http.Request) {
	provider, _, _ := service.LumaPrimaryProvider()
	writeRawJSON(w, map[string]any{
		"app_version":   service.LumaForgeVersion,
		"app_build_id":  service.LumaForgeBuildID,
		"api_providers": service.LumaPublicProviders(service.LumaLoadProviders()),
		"base_url":      provider.BaseURL,
		"image_model":   "gpt-image-2-vip",
		"image_models":  provider.ImageModels,
		"chat_models":   provider.ChatModels,
		"video_models":  provider.VideoModels,
	})
}

func LumaConfigToken(w http.ResponseWriter, r *http.Request) {
	_, key, _ := service.LumaPrimaryProvider()
	writeRawJSON(w, map[string]any{"token": key})
}

func LumaSettings(w http.ResponseWriter, r *http.Request) {
	providers := service.LumaPublicProviders(service.LumaLoadProviders())
	allModels := []string{}
	for _, provider := range providers {
		if !provider.Enabled {
			continue
		}
		allModels = append(allModels, provider.ImageModels...)
		allModels = append(allModels, provider.ChatModels...)
		allModels = append(allModels, provider.VideoModels...)
	}
	if len(allModels) == 0 {
		allModels = []string{"gpt-image-2-vip", "gpt-image-2", "gpt-5.5"}
	}
	allowCustom := true
	rawJSONData := map[string]any{
		"modelChannel": map[string]any{
			"availableModels":   allModels,
			"modelCosts":        []any{},
			"defaultModel":      "gpt-5.5",
			"defaultImageModel": "gpt-image-2-vip",
			"defaultVideoModel": "sora-2",
			"defaultTextModel":  "gpt-5.5",
			"systemPrompt":      "",
			"allowCustomChannel": allowCustom,
		},
		"auth": map[string]any{
			"allowRegister": true,
			"linuxDo":       map[string]any{"enabled": false},
		},
	}
	OK(w, rawJSONData)
}

func LumaAppInfo(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, service.LumaAppInfo())
}

func LumaUpdateState(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, service.LumaUpdateState())
}

func LumaUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, service.LumaUpdateCheck())
}

func LumaUpdateSettings(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "current_version": service.LumaForgeVersion, "update_check_url": config.Cfg.UpdateCheckURL, "update_check_configured": config.Cfg.UpdateCheckURL != ""})
}

func LumaUpdatePreflight(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "checks": []map[string]any{{"id": "go_next", "label": "Go + Next 主体", "ok": true, "detail": "2.1.0 runtime"}}})
}

func LumaUpdateDownload(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	state := service.LumaSaveUpdateState(map[string]any{"phase": "failed", "error": "当前 Go 主体未连接 legacy updater；请在桌面启动器中设置 LUMAFORGE_LEGACY_API_URL 后执行自动更新。"})
	writeRawJSON(w, map[string]any{"ok": false, "state": state, "detail": state["error"]})
}

func LumaUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	state := service.LumaSaveUpdateState(map[string]any{"phase": "failed", "error": "当前 Go 主体未连接 legacy updater，未执行安装。"})
	writeRawJSON(w, map[string]any{"ok": false, "state": state, "detail": state["error"]})
}

func LumaUpdateAuto(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	LumaUpdateCheck(w, r)
}

func LumaLocalDataHealth(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{
		"ok": true,
		"paths": map[string]any{
			"data_dir":   service.LumaDataDir(),
			"assets_dir": service.LumaAssetsDir(),
		},
	})
}

func LumaDiagnostics(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "checks": []map[string]any{{"id": "v21", "label": "LumaForge v2.1.0 主体", "ok": true, "detail": "Go + Next adapter active"}}})
}

func LumaBackups(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "items": []any{}})
}

func LumaBackupNoop(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "message": "2.1.0 Go 主体保留备份接口；深度备份由 legacy API 或后续迁移器执行。"})
}

func LumaAssetsHealth(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "checked": 0, "missing_count": 0, "thumb_missing_count": 0, "missing": []any{}, "thumb_missing": []any{}})
}

func LumaAssetsNoop(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "items": []any{}, "message": "已保留接口"})
}

func firstMapString(data map[string]any, key string) string {
	if data == nil {
		return ""
	}
	if value, ok := data[key].(string); ok {
		return value
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
