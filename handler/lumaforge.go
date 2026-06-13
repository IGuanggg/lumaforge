package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strings"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/service"
)

const lumaAuthCookieName = "lumaforge_auth_token"

func setLumaAuthCookie(w http.ResponseWriter, token string) {
	token = strings.TrimSpace(token)
	if token == "" {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     lumaAuthCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   60 * 60 * 24 * 30,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearLumaAuthCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     lumaAuthCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func lumaAuthTokenFromRequest(r *http.Request) string {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token != "" {
		return token
	}
	if cookie, err := r.Cookie(lumaAuthCookieName); err == nil {
		return strings.TrimSpace(cookie.Value)
	}
	return ""
}

func lumaStringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		if value == nil {
			return ""
		}
		return fmt.Sprint(value)
	}
}

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

func proxyCloud(w http.ResponseWriter, r *http.Request) bool {
	session := service.LumaLoadCloudSession()
	baseURL := strings.TrimRight(strings.TrimSpace(session.BaseURL), "/")
	if baseURL == "" {
		baseURL = strings.TrimRight(strings.TrimSpace(config.Cfg.LumaForgeCloudURL), "/")
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
	if strings.TrimSpace(req.Header.Get("Authorization")) == "" && strings.TrimSpace(session.Token) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(session.Token))
	}
	req.Host = parsed.Host
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeRawError(w, http.StatusBadGateway, fmt.Errorf("cloud API unavailable: %w", err))
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

func LumaCloudRawProxy(w http.ResponseWriter, r *http.Request) {
	if proxyCloud(w, r) {
		return
	}
	writeRawError(w, http.StatusBadGateway, fmt.Errorf("cloud API is not configured"))
}

func LumaAuthLogin(w http.ResponseWriter, r *http.Request) {
	var payload map[string]any
	_ = json.NewDecoder(r.Body).Decode(&payload)
	data, err := service.LumaCloudAuth("login", payload)
	if err != nil {
		FailError(w, err)
		return
	}
	setLumaAuthCookie(w, lumaStringFromAny(data["token"]))
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
	setLumaAuthCookie(w, lumaStringFromAny(data["token"]))
	OK(w, data)
}

func LumaCurrentUser(w http.ResponseWriter, r *http.Request) {
	token := lumaAuthTokenFromRequest(r)
	if strings.TrimSpace(token) == "" {
		token = service.LumaLoadCloudSession().Token
	}
	if user, ok := service.LumaCurrentAuthUser(token); ok {
		setLumaAuthCookie(w, token)
		OK(w, user)
		return
	}
	OK(w, service.GuestUser())
}

func LumaMeRaw(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		LumaCloudRawProxy(w, r)
		return
	}
	token := lumaAuthTokenFromRequest(r)
	if strings.TrimSpace(token) == "" {
		token = service.LumaLoadCloudSession().Token
	}
	if user, ok := service.LumaCurrentAuthUser(token); ok {
		setLumaAuthCookie(w, token)
		session := service.LumaLoadCloudSession()
		writeRawJSON(w, map[string]any{
			"email":          user.Username,
			"email_verified": session.EmailVerified,
			"display_name":   user.DisplayName,
			"avatar_url":     user.AvatarURL,
		})
		return
	}
	writeRawError(w, http.StatusUnauthorized, fmt.Errorf("登录已失效，请重新登录"))
}

func refreshCloudSessionFromRequest(r *http.Request) {
	token := lumaAuthTokenFromRequest(r)
	if strings.TrimSpace(token) != "" {
		_, _ = service.LumaCurrentAuthUser(token)
	}
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
	setLumaAuthCookie(w, lumaStringFromAny(data["token"]))
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
	clearLumaAuthCookie(w)
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
	data, err := service.LumaCloudConfigDownload()
	if err != nil {
		if proxyLegacy(w, r) {
			return
		}
		writeRawError(w, http.StatusBadRequest, err)
		return
	}
	writeRawJSON(w, data)
}

func LumaConfigsCurrent(w http.ResponseWriter, r *http.Request) {
	refreshCloudSessionFromRequest(r)
	switch r.Method {
	case http.MethodGet:
		data, err := service.LumaCloudConfigDownload()
		if err != nil {
			writeRawError(w, http.StatusBadRequest, err)
			return
		}
		writeRawJSON(w, map[string]any{
			"config":     data["config"],
			"updated_at": data["cloud_updated_at"],
			"applied":    data["applied"],
		})
	case http.MethodPut:
		payload := map[string]any{}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		configPayload, _ := payload["config"].(map[string]any)
		data, err := service.LumaCloudConfigUpload(configPayload)
		if err != nil {
			writeRawError(w, http.StatusBadRequest, err)
			return
		}
		response := map[string]any{"ok": true}
		if cloud, _ := data["cloud"].(map[string]any); cloud != nil {
			if updatedAt, ok := cloud["updated_at"]; ok {
				response["updated_at"] = updatedAt
			}
		}
		writeRawJSON(w, response)
	default:
		writeRawError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
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
	writeRawJSON(w, service.LumaProviderKeyDiagnostics())
}

func LumaProviderKeyDiagnosticsClear(w http.ResponseWriter, r *http.Request) {
	writeRawJSON(w, service.LumaClearOrphanProviderKeys())
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
	if strings.TrimSpace(payload.APIKey) == "" {
		if saved, key, ok := service.LumaProviderByID(payload.ID); ok {
			payload.APIKey = key
			if strings.TrimSpace(payload.BaseURL) == "" {
				payload.BaseURL = saved.BaseURL
			}
		}
	}
	data, err := service.LumaFetchProviderModels(payload, payload.APIKey)
	if err != nil {
		writeRawJSON(w, map[string]any{"ok": false, "status": 0, "message": err.Error(), "model_count": 0, "all": []string{}})
		return
	}
	writeRawJSON(w, data)
}

func LumaProviderProbeAsync(w http.ResponseWriter, r *http.Request) {
	var payload service.LumaAPIProvider
	var raw map[string]any
	_ = json.NewDecoder(r.Body).Decode(&raw)
	payload.ID = firstNonEmpty(firstMapString(raw, "provider_id"), "custom")
	payload.Name = payload.ID
	payload.BaseURL = firstMapString(raw, "base_url")
	payload.APIKey = firstMapString(raw, "api_key")
	if strings.TrimSpace(payload.APIKey) == "" {
		if saved, key, ok := service.LumaProviderByID(payload.ID); ok {
			payload.APIKey = key
			if strings.TrimSpace(payload.BaseURL) == "" {
				payload.BaseURL = saved.BaseURL
			}
			payload.Protocol = saved.Protocol
			payload.ImageModels = saved.ImageModels
			payload.ChatModels = saved.ChatModels
			payload.VideoModels = saved.VideoModels
		}
	}
	writeRawJSON(w, service.LumaProbeProviderProtocol(payload, payload.APIKey))
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
	settings, err := service.PublicSettings()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, settings)
}

func LumaAppInfo(w http.ResponseWriter, r *http.Request) {
	writeRawJSON(w, service.LumaAppInfo())
}

func LumaReleaseHealth(w http.ResponseWriter, r *http.Request) {
	writeRawJSON(w, service.LumaReleaseHealth())
}

func LumaUpdateState(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawJSON(w, service.LumaUpdateState())
}

func LumaUpdateCheck(w http.ResponseWriter, r *http.Request) {
	writeRawJSON(w, service.LumaUpdateCheck())
}

func LumaUpdateSettings(w http.ResponseWriter, r *http.Request) {
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
	check := service.LumaUpdateCheck()
	capability := service.LumaUpdateCapability()
	reason := firstNonEmpty(
		firstMapString(capability, "reason"),
		"当前环境没有连接桌面更新器，暂时不能自动升级。请使用桌面版启动后再试，或手动下载安装包。",
	)
	state := service.LumaSaveUpdateState(map[string]any{
		"phase":          "failed",
		"error":          reason,
		"latest_version": check["latest_version"],
		"asset":          check["selected_asset"],
		"assets":         check["assets"],
	})
	writeRawJSON(w, map[string]any{
		"ok":         false,
		"updated":    false,
		"message":    reason,
		"detail":     reason,
		"check":      check,
		"state":      state,
		"capability": capability,
	})
}

func LumaUpdateCleanup(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	state := service.LumaCleanupUpdatePackage()
	writeRawJSON(w, map[string]any{
		"ok":           true,
		"removed":      state["cleaned_files"],
		"update_state": state,
	})
}

func LumaLocalDataHealth(w http.ResponseWriter, r *http.Request) {
	writeRawJSON(w, map[string]any{
		"ok":    true,
		"paths": service.LumaAppPaths(),
	})
}

func LumaDiagnostics(w http.ResponseWriter, r *http.Request) {
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

func LumaAppRestart(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawError(w, http.StatusBadRequest, fmt.Errorf("当前 Go + Next 主体未连接桌面生命周期桥；请通过桌面版 LumaForge.exe 启动后再使用重启。"))
}

func LumaAppExit(w http.ResponseWriter, r *http.Request) {
	if proxyLegacy(w, r) {
		return
	}
	writeRawError(w, http.StatusBadRequest, fmt.Errorf("当前 Go + Next 主体未连接桌面生命周期桥；请通过桌面版 LumaForge.exe 启动后再使用退出。"))
}

func LumaAppOpenPath(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Target string `json:"target"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	path, err := service.LumaAppPath(payload.Target)
	if err != nil {
		writeRawError(w, http.StatusBadRequest, err)
		return
	}
	if err := openExternalPath(path); err != nil {
		writeRawError(w, http.StatusBadRequest, err)
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "path": path})
}

func LumaAppSelectPath(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Target string `json:"target"`
		Path   string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeRawError(w, http.StatusBadRequest, fmt.Errorf("缺少目录参数"))
		return
	}
	paths, err := service.LumaSaveAppPath(payload.Target, payload.Path)
	if err != nil {
		writeRawError(w, http.StatusBadRequest, err)
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "target": payload.Target, "path": paths[payload.Target], "paths": paths})
}

func LumaAppOpenURL(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeRawError(w, http.StatusBadRequest, fmt.Errorf("缺少 URL"))
		return
	}
	opened, err := openExternalURL(payload.URL)
	if err != nil {
		writeRawError(w, http.StatusBadRequest, err)
		return
	}
	writeRawJSON(w, map[string]any{"ok": true, "url": opened})
}

func openExternalURL(rawURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("URL 不合法")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("只允许打开 http 或 https 链接")
	}
	safeURL := parsed.String()
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", safeURL)
	case "darwin":
		command = exec.Command("open", safeURL)
	default:
		command = exec.Command("xdg-open", safeURL)
	}
	if err := command.Start(); err != nil {
		return "", err
	}
	return safeURL, nil
}

func openExternalPath(path string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("explorer.exe", path)
	case "darwin":
		command = exec.Command("open", path)
	default:
		command = exec.Command("xdg-open", path)
	}
	return command.Start()
}

func LumaAssetsHealth(w http.ResponseWriter, r *http.Request) {
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
