package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/IGuanggg/lumaforge/config"
	"github.com/IGuanggg/lumaforge/model"
)

const LumaForgeVersion = "2.1.15"
const LumaForgeBuildID = "20260617-v2115-desktop-info-hotfix"
const lumaUpdateDownloadStallSeconds = 45

var (
	lumaHTTPClient = &http.Client{Timeout: 45 * time.Second}
	providerIDRE   = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,48}$`)
)

type LumaCloudSession struct {
	BaseURL            string         `json:"base_url"`
	Token              string         `json:"token"`
	Email              string         `json:"email"`
	DisplayName        string         `json:"display_name"`
	AvatarURL          string         `json:"avatar_url"`
	EmailVerified      bool           `json:"email_verified"`
	CustomCloud        bool           `json:"custom_cloud"`
	CloudConfigMissing bool           `json:"cloud_config_missing"`
	UpdatedAt          int64          `json:"updated_at"`
	User               map[string]any `json:"user"`
}

type LumaAPIProvider struct {
	ID                string           `json:"id"`
	Name              string           `json:"name"`
	BaseURL           string           `json:"base_url"`
	Protocol          string           `json:"protocol"`
	ProtocolOverride  string           `json:"protocol_override,omitempty"`
	Enabled           bool             `json:"enabled"`
	Primary           bool             `json:"primary"`
	ImageModels       []string         `json:"image_models"`
	ChatModels        []string         `json:"chat_models"`
	VideoModels       []string         `json:"video_models"`
	MSLoras           []map[string]any `json:"ms_loras,omitempty"`
	MSDefaultsVersion int              `json:"ms_defaults_version,omitempty"`
	APIKey            string           `json:"api_key,omitempty"`
	ClearKey          bool             `json:"clear_key,omitempty"`
	HasKey            bool             `json:"has_key"`
	KeyPreview        string           `json:"key_preview"`
}

func LumaDataDir() string {
	if value := strings.TrimSpace(config.Cfg.LumaForgeDataDir); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("APP_RUNTIME_DIR")); value != "" {
		return filepath.Join(value, "data")
	}
	dsn := strings.TrimSpace(config.Cfg.DatabaseDSN)
	if index := strings.Index(dsn, "?"); index >= 0 {
		dsn = dsn[:index]
	}
	if dsn != "" && dsn != ":memory:" && !strings.HasPrefix(dsn, "file:") {
		return filepath.Dir(dsn)
	}
	return "data"
}

func LumaAssetsDir() string {
	if value := strings.TrimSpace(os.Getenv("APP_ASSETS_DIR")); value != "" {
		return value
	}
	if value := strings.TrimSpace(lumaLoadAppPathSettings()["save"]); value != "" {
		return value
	}
	return lumaDefaultAssetsDir()
}

func lumaDefaultAssetsDir() string {
	if value := strings.TrimSpace(os.Getenv("USERPROFILE")); value != "" {
		return filepath.Join(value, "Pictures", "LumaForge")
	}
	return filepath.Join(LumaDataDir(), "assets")
}

func LumaOutputDir() string {
	if value := strings.TrimSpace(os.Getenv("APP_OUTPUT_DIR")); value != "" {
		return value
	}
	settings := lumaLoadAppPathSettings()
	if value := strings.TrimSpace(settings["output"]); value != "" {
		return value
	}
	if saveDir := strings.TrimSpace(settings["save"]); saveDir != "" {
		return filepath.Join(saveDir, "output")
	}
	return lumaDefaultOutputDir()
}

func lumaDefaultOutputDir() string {
	if value := strings.TrimSpace(os.Getenv("APP_RUNTIME_DIR")); value != "" {
		return filepath.Join(value, "output")
	}
	return filepath.Join(LumaDataDir(), "output")
}

func lumaPath(name string) string {
	return filepath.Join(LumaDataDir(), name)
}

func readJSONFile(path string, target any) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return json.Unmarshal(data, target) == nil
}

func writeJSONFile(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

func LumaLoadCloudSession() LumaCloudSession {
	var session LumaCloudSession
	_ = readJSONFile(lumaPath("cloud_session.json"), &session)
	if session.BaseURL == "" {
		session.BaseURL = strings.TrimRight(config.Cfg.LumaForgeCloudURL, "/")
	}
	return session
}

func LumaSaveCloudSession(session LumaCloudSession) error {
	session.BaseURL = strings.TrimRight(strings.TrimSpace(session.BaseURL), "/")
	if session.BaseURL == "" {
		session.BaseURL = strings.TrimRight(config.Cfg.LumaForgeCloudURL, "/")
	}
	session.UpdatedAt = time.Now().UnixMilli()
	return writeJSONFile(lumaPath("cloud_session.json"), session)
}

func lumaCloudBaseURL(requested string) (string, bool, error) {
	value := strings.TrimRight(strings.TrimSpace(requested), "/")
	custom := value != ""
	if value == "" {
		value = strings.TrimRight(strings.TrimSpace(config.Cfg.LumaForgeCloudURL), "/")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", custom, errors.New("云端地址需要以 http:// 或 https:// 开头")
	}
	return value, custom, nil
}

func lumaCloudJSON(method string, baseURL string, path string, token string, payload any) (map[string]any, int, error) {
	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return nil, 0, err
		}
		body = bytes.NewReader(data)
	}
	request, err := http.NewRequest(method, strings.TrimRight(baseURL, "/")+path, body)
	if err != nil {
		return nil, 0, err
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(token) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}
	response, err := lumaHTTPClient.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 12<<20))
	var result map[string]any
	if len(data) > 0 {
		_ = json.Unmarshal(data, &result)
	}
	if response.StatusCode >= 400 {
		message := "云端请求失败"
		if detail, ok := result["detail"].(string); ok && detail != "" {
			message = detail
		} else if msg, ok := result["message"].(string); ok && msg != "" {
			message = msg
		}
		return result, response.StatusCode, errors.New(message)
	}
	if result == nil {
		result = map[string]any{}
	}
	return result, response.StatusCode, nil
}

func LumaCloudAuth(action string, payload map[string]any) (map[string]any, error) {
	email := strings.TrimSpace(stringFromAny(firstNonNil(payload["email"], payload["username"])))
	password := strings.TrimSpace(stringFromAny(payload["password"]))
	baseURL, custom, err := lumaCloudBaseURL(stringFromAny(payload["base_url"]))
	if err != nil {
		return nil, err
	}
	if email == "" || password == "" {
		return nil, errors.New("邮箱和密码不能为空")
	}
	data, _, err := lumaCloudJSON(http.MethodPost, baseURL, "/api/auth/"+action, "", map[string]any{
		"email":    email,
		"password": password,
	})
	if err != nil {
		return nil, err
	}
	token := stringFromAny(data["token"])
	user := map[string]any{
		"email":          stringFromAny(data["email"]),
		"email_verified": boolFromAny(data["email_verified"]),
		"display_name":   stringFromAny(data["display_name"]),
		"avatar_url":     stringFromAny(data["avatar_url"]),
	}
	session := LumaCloudSession{
		BaseURL:       baseURL,
		Token:         token,
		Email:         stringFromAny(user["email"]),
		DisplayName:   stringFromAny(user["display_name"]),
		AvatarURL:     stringFromAny(user["avatar_url"]),
		EmailVerified: boolFromAny(user["email_verified"]),
		CustomCloud:   custom,
		User:          user,
	}
	_ = LumaSaveCloudSession(session)
	configSync := map[string]any{"ok": false}
	if syncData, syncErr := LumaCloudConfigDownload(); syncErr == nil {
		configSync = map[string]any{
			"ok":               true,
			"cloud_updated_at": syncData["cloud_updated_at"],
			"applied":          syncData["applied"],
		}
	} else {
		configSync["error"] = syncErr.Error()
	}
	return map[string]any{
		"token":                token,
		"user":                 lumaAuthUserFromSession(session),
		"base_url":             baseURL,
		"custom_cloud":         custom,
		"cloud_config_missing": false,
		"config_sync":          configSync,
	}, nil
}

func LumaCurrentAuthUser(token string) (model.AuthUser, bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return model.AuthUser{}, false
	}
	session := LumaLoadCloudSession()
	if session.Token == token && session.Email != "" {
		return lumaAuthUserFromSession(session), true
	}
	baseURL := session.BaseURL
	if strings.TrimSpace(baseURL) == "" {
		baseURL = strings.TrimRight(config.Cfg.LumaForgeCloudURL, "/")
	}
	data, _, err := lumaCloudJSON(http.MethodGet, baseURL, "/api/me", token, nil)
	if err != nil {
		return model.AuthUser{}, false
	}
	session.Token = token
	session.BaseURL = baseURL
	session.Email = stringFromAny(data["email"])
	session.DisplayName = stringFromAny(data["display_name"])
	session.AvatarURL = stringFromAny(data["avatar_url"])
	session.EmailVerified = boolFromAny(data["email_verified"])
	session.User = data
	_ = LumaSaveCloudSession(session)
	return lumaAuthUserFromSession(session), true
}

func lumaAuthUserFromSession(session LumaCloudSession) model.AuthUser {
	name := strings.TrimSpace(session.DisplayName)
	if name == "" {
		name = session.Email
	}
	role := model.UserRoleUser
	if strings.EqualFold(session.Email, "admin") {
		role = model.UserRoleAdmin
	}
	return model.AuthUser{
		ID:          stableCloudUserID(session.Email),
		Username:    session.Email,
		DisplayName: name,
		AvatarURL:   session.AvatarURL,
		Role:        role,
		Credits:     999999,
		CreatedAt:   "",
		UpdatedAt:   "",
	}
}

func stableCloudUserID(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return "cloud-user"
	}
	sum := sha256.Sum256([]byte(email))
	return "cloud-" + fmt.Sprintf("%x", sum[:8])
}

func LumaCloudStatus(refresh bool) map[string]any {
	session := LumaLoadCloudSession()
	status := map[string]any{
		"logged_in":            session.Token != "",
		"base_url":             session.BaseURL,
		"custom_cloud":         session.CustomCloud,
		"email":                session.Email,
		"display_name":         session.DisplayName,
		"avatar_url":           session.AvatarURL,
		"email_verified":       session.EmailVerified,
		"cloud_config_missing": session.CloudConfigMissing,
	}
	if refresh && session.Token != "" {
		if user, ok := LumaCurrentAuthUser(session.Token); ok {
			status["logged_in"] = true
			status["email"] = user.Username
			status["display_name"] = user.DisplayName
			status["avatar_url"] = user.AvatarURL
		} else {
			_ = LumaSaveCloudSession(LumaCloudSession{BaseURL: session.BaseURL, CustomCloud: session.CustomCloud})
			status["logged_in"] = false
		}
	}
	return status
}

func LumaCloudConfigUpload(configPayload map[string]any) (map[string]any, error) {
	session := LumaLoadCloudSession()
	if session.Token == "" {
		return nil, errors.New("请先登录云端账户")
	}
	if configPayload == nil {
		configPayload = LumaBuildCloudConfig(true)
	}
	data, _, err := lumaCloudJSON(http.MethodPut, session.BaseURL, "/api/configs/current", session.Token, map[string]any{"config": configPayload})
	if err != nil {
		return nil, err
	}
	session.CloudConfigMissing = false
	_ = LumaSaveCloudSession(session)
	return map[string]any{"ok": true, "cloud": data}, nil
}

func LumaCloudConfigDownload() (map[string]any, error) {
	session := LumaLoadCloudSession()
	if session.Token == "" {
		return nil, errors.New("请先登录云端账户")
	}
	data, _, err := lumaCloudJSON(http.MethodGet, session.BaseURL, "/api/configs/current", session.Token, nil)
	if err != nil {
		return nil, err
	}
	session.CloudConfigMissing = data["config"] == nil
	_ = LumaSaveCloudSession(session)
	configMap, _ := data["config"].(map[string]any)
	applied, err := LumaApplyCloudConfig(configMap)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "cloud_updated_at": data["updated_at"], "config": data["config"], "applied": applied}, nil
}

func LumaBuildCloudConfig(includeSecrets bool) map[string]any {
	providers := LumaPublicProviders(LumaLoadProviders())
	apiKeys := map[string]string{}
	if includeSecrets {
		keys := LumaLoadProviderKeys()
		for i := range providers {
			if key := strings.TrimSpace(keys[providers[i].ID]); key != "" {
				providers[i].APIKey = key
				apiKeys[providers[i].ID] = key
			}
		}
	}
	config := map[string]any{
		"schema_version": "lumaforge-2.1.0",
		"api_providers":  providers,
		"updated_at":     time.Now().UnixMilli(),
	}
	if includeSecrets {
		config["api_keys"] = apiKeys
	}
	return config
}

func LumaApplyCloudConfig(configMap map[string]any) (map[string]any, error) {
	result := map[string]any{"providers": false, "keys": false}
	if configMap == nil {
		return result, nil
	}
	cloudKeys := map[string]string{}
	if rawKeys, ok := configMap["api_keys"].(map[string]any); ok {
		for id, value := range rawKeys {
			providerID := strings.ToLower(strings.TrimSpace(id))
			key := strings.TrimSpace(fmt.Sprint(value))
			if providerIDRE.MatchString(providerID) && key != "" {
				cloudKeys[providerID] = key
			}
		}
	}
	rawProviders, ok := configMap["api_providers"].([]any)
	if !ok {
		if len(cloudKeys) > 0 {
			keys := lumaLoadProviderKeyFile()
			for id, key := range cloudKeys {
				if strings.TrimSpace(keys[id]) == "" {
					keys[id] = key
				}
			}
			if err := lumaSaveProviderKeys(keys); err != nil {
				return result, err
			}
			result["keys"] = true
			result["keys_count"] = len(cloudKeys)
		}
		return result, nil
	}
	providers := make([]LumaAPIProvider, 0, len(rawProviders))
	for _, raw := range rawProviders {
		data, _ := json.Marshal(raw)
		var provider LumaAPIProvider
		if json.Unmarshal(data, &provider) == nil && strings.TrimSpace(provider.ID) != "" {
			provider.ID = strings.ToLower(strings.TrimSpace(provider.ID))
			if strings.TrimSpace(provider.APIKey) == "" {
				provider.APIKey = cloudKeys[provider.ID]
			}
			providers = append(providers, provider)
		}
	}
	if len(providers) == 0 {
		return result, nil
	}
	if _, err := LumaSaveProviders(providers); err != nil {
		return result, err
	}
	result["providers"] = true
	result["providers_count"] = len(providers)
	if len(cloudKeys) > 0 {
		result["keys"] = true
		result["keys_count"] = len(cloudKeys)
	}
	return result, nil
}

func LumaDefaultProviders() []LumaAPIProvider {
	return []LumaAPIProvider{
		{
			ID:          "openai",
			Name:        "OpenAI Compatible",
			BaseURL:     "https://api.openai.com/v1",
			Protocol:    "openai",
			Enabled:     true,
			Primary:     true,
			ImageModels: []string{"gpt-image-2-vip", "gpt-image-2", "nano-banana"},
			ChatModels:  []string{"gpt-5.5", "gpt-4.1", "gpt-4o"},
			VideoModels: []string{"sora-2"},
		},
	}
}

func LumaLoadProviders() []LumaAPIProvider {
	var providers []LumaAPIProvider
	if !readJSONFile(lumaPath("api_providers.json"), &providers) || len(providers) == 0 {
		providers = LumaDefaultProviders()
	}
	return normalizeLumaProviders(providers)
}

func LumaSaveProviders(providers []LumaAPIProvider) ([]LumaAPIProvider, error) {
	if len(providers) == 0 {
		return nil, errors.New("至少保留一个 API 平台")
	}
	keys := LumaLoadProviderKeys()
	cleaned := make([]LumaAPIProvider, 0, len(providers))
	seen := map[string]bool{}
	primaryIndex := -1
	for i, provider := range providers {
		normalized, err := normalizeLumaProvider(provider)
		if err != nil {
			return nil, err
		}
		if seen[normalized.ID] {
			return nil, fmt.Errorf("API 平台 ID 重复：%s", normalized.ID)
		}
		seen[normalized.ID] = true
		if provider.ClearKey {
			delete(keys, normalized.ID)
		} else if strings.TrimSpace(provider.APIKey) != "" {
			keys[normalized.ID] = strings.TrimSpace(provider.APIKey)
		}
		if normalized.Primary {
			primaryIndex = i
		}
		normalized.APIKey = ""
		normalized.ClearKey = false
		cleaned = append(cleaned, normalized)
	}
	if primaryIndex >= 0 {
		for i := range cleaned {
			cleaned[i].Primary = i == primaryIndex
		}
	}
	if err := lumaSaveProviderKeys(keys); err != nil {
		return nil, err
	}
	if err := writeJSONFile(lumaPath("api_providers.json"), cleaned); err != nil {
		return nil, err
	}
	return LumaPublicProviders(cleaned), nil
}

func normalizeLumaProviders(providers []LumaAPIProvider) []LumaAPIProvider {
	result := []LumaAPIProvider{}
	seen := map[string]bool{}
	for _, provider := range providers {
		normalized, err := normalizeLumaProvider(provider)
		if err != nil || seen[normalized.ID] {
			continue
		}
		seen[normalized.ID] = true
		result = append(result, normalized)
	}
	if len(result) == 0 {
		result = LumaDefaultProviders()
	}
	if !hasPrimaryProvider(result) {
		result[0].Primary = true
	}
	return result
}

func normalizeLumaProvider(provider LumaAPIProvider) (LumaAPIProvider, error) {
	provider.ID = strings.ToLower(strings.TrimSpace(provider.ID))
	if !providerIDRE.MatchString(provider.ID) {
		return provider, fmt.Errorf("API 平台 ID 不合法：%s", provider.ID)
	}
	provider.Name = strings.TrimSpace(provider.Name)
	if provider.Name == "" {
		provider.Name = provider.ID
	}
	provider.BaseURL = strings.TrimRight(strings.TrimSpace(provider.BaseURL), "/")
	provider.Name = repairLumaProviderName(provider.Name, provider.ID, provider.BaseURL)
	if provider.BaseURL != "" {
		parsed, err := url.Parse(provider.BaseURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return provider, fmt.Errorf("%s 的 Base URL 需要以 http:// 或 https:// 开头", provider.Name)
		}
	}
	provider.Protocol = strings.ToLower(strings.TrimSpace(provider.Protocol))
	if provider.Protocol != "apimart" {
		provider.Protocol = "openai"
	}
	provider.ProtocolOverride = normalizeProtocolOverride(provider.ProtocolOverride)
	provider = mergeBuiltInProviderDefaults(provider)
	provider.ImageModels = uniqueStrings(provider.ImageModels)
	provider.ChatModels = uniqueStrings(provider.ChatModels)
	provider.VideoModels = uniqueStrings(provider.VideoModels)
	return provider, nil
}

func repairLumaProviderName(name string, id string, baseURL string) string {
	name = strings.TrimSpace(name)
	id = strings.ToLower(strings.TrimSpace(id))
	lowerName := strings.ToLower(name)
	lowerBase := strings.ToLower(baseURL)
	suspicious := name == "" ||
		name == "??" ||
		name == "???" ||
		strings.Contains(name, "�") ||
		strings.Contains(name, "锟") ||
		strings.Contains(name, "ç¾ç¼") ||
		strings.Contains(name, "é»ä¸ç½") ||
		strings.Contains(name, "Gpt") ||
		strings.Contains(name, "鐧剧偧") ||
		strings.Contains(name, "榛戜笌鐧") ||
		strings.HasPrefix(name, "??? ") ||
		strings.Contains(name, "???")
	if !suspicious {
		return name
	}
	switch {
	case strings.Contains(lowerBase, "dashscope.aliyuncs.com"):
		return "百炼"
	case strings.Contains(lowerBase, "gemini") || strings.Contains(id, "gemini") || strings.Contains(lowerName, "gemini"):
		return "Gemini"
	case strings.Contains(id, "grsai") || strings.Contains(lowerBase, "grsai"):
		return "grsai"
	case strings.Contains(id, "gpt") || strings.Contains(lowerName, "gpt"):
		return "GPT"
	case id != "":
		return id
	default:
		return "API 平台"
	}
}

func normalizeProtocolOverride(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "force-openai", "force-apimart":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "auto"
	}
}

func mergeBuiltInProviderDefaults(provider LumaAPIProvider) LumaAPIProvider {
	for _, item := range LumaDefaultProviders() {
		if provider.ID != item.ID {
			continue
		}
		provider.ImageModels = append(provider.ImageModels, item.ImageModels...)
		provider.ChatModels = append(provider.ChatModels, item.ChatModels...)
		provider.VideoModels = append(provider.VideoModels, item.VideoModels...)
		break
	}
	return provider
}

func hasPrimaryProvider(providers []LumaAPIProvider) bool {
	for _, provider := range providers {
		if provider.Primary {
			return true
		}
	}
	return false
}

func LumaLoadProviderKeys() map[string]string {
	keys := lumaLoadProviderKeyFile()
	for _, provider := range LumaLoadProviders() {
		envName := "LUMAFORGE_PROVIDER_" + strings.ToUpper(strings.ReplaceAll(provider.ID, "-", "_")) + "_API_KEY"
		if value := strings.TrimSpace(os.Getenv(envName)); value != "" {
			keys[provider.ID] = value
		}
	}
	return keys
}

func lumaLoadProviderKeyFile() map[string]string {
	keys := map[string]string{}
	_ = readJSONFile(lumaPath("api_provider_keys.json"), &keys)
	return keys
}

func lumaSaveProviderKeys(keys map[string]string) error {
	return writeJSONFile(lumaPath("api_provider_keys.json"), keys)
}

func LumaProviderKeyDiagnostics() map[string]any {
	providers := LumaPublicProviders(LumaLoadProviders())
	providerIDs := map[string]bool{}
	for _, provider := range providers {
		providerIDs[provider.ID] = true
	}
	keys := lumaLoadProviderKeyFile()
	orphanKeys := []string{}
	referencedCount := 0
	for id, value := range keys {
		if !providerIDs[id] {
			orphanKeys = append(orphanKeys, id)
			continue
		}
		if strings.TrimSpace(value) != "" {
			referencedCount += 1
		}
	}
	sort.Strings(orphanKeys)
	keyPath := lumaPath("api_provider_keys.json")
	_, statErr := os.Stat(keyPath)
	cloudAvailable, recoverableCount, cloudErr := lumaCloudRecoverableProviderKeyCount(providers, keys)
	return map[string]any{
		"providers":               providers,
		"provider_count":          len(providers),
		"stored_key_count":        referencedCount,
		"orphan_keys":             orphanKeys,
		"orphan_count":            len(orphanKeys),
		"has_environment_keys":    hasProviderEnvironmentKeys(providers),
		"local_key_file_exists":   statErr == nil,
		"key_storage_mode":        "plaintext-json",
		"key_storage_secure":      false,
		"cloud_config_available":  cloudAvailable,
		"recoverable_from_cloud":  recoverableCount > 0,
		"recoverable_key_count":   recoverableCount,
		"cloud_diagnostics_error": cloudErr,
	}
}

func lumaCloudRecoverableProviderKeyCount(providers []LumaAPIProvider, localKeys map[string]string) (bool, int, string) {
	session := LumaLoadCloudSession()
	if strings.TrimSpace(session.Token) == "" || strings.TrimSpace(session.BaseURL) == "" {
		return false, 0, ""
	}
	data, _, err := lumaCloudJSON(http.MethodGet, session.BaseURL, "/api/configs/current", session.Token, nil)
	if err != nil {
		return false, 0, err.Error()
	}
	configMap, _ := data["config"].(map[string]any)
	if configMap == nil {
		return false, 0, ""
	}
	cloudKeys := map[string]string{}
	if rawKeys, ok := configMap["api_keys"].(map[string]any); ok {
		for id, value := range rawKeys {
			providerID := strings.ToLower(strings.TrimSpace(id))
			key := strings.TrimSpace(fmt.Sprint(value))
			if providerIDRE.MatchString(providerID) && key != "" {
				cloudKeys[providerID] = key
			}
		}
	}
	if rawProviders, ok := configMap["api_providers"].([]any); ok {
		for _, raw := range rawProviders {
			data, _ := json.Marshal(raw)
			var provider LumaAPIProvider
			if json.Unmarshal(data, &provider) == nil {
				provider.ID = strings.ToLower(strings.TrimSpace(provider.ID))
				if providerIDRE.MatchString(provider.ID) && strings.TrimSpace(provider.APIKey) != "" {
					cloudKeys[provider.ID] = strings.TrimSpace(provider.APIKey)
				}
			}
		}
	}
	providerIDs := map[string]bool{}
	for _, provider := range providers {
		providerIDs[provider.ID] = true
	}
	count := 0
	for id, key := range cloudKeys {
		if providerIDs[id] && strings.TrimSpace(localKeys[id]) == "" && key != "" {
			count += 1
		}
	}
	return true, count, ""
}

func LumaClearOrphanProviderKeys() map[string]any {
	keys := lumaLoadProviderKeyFile()
	providerIDs := map[string]bool{}
	for _, provider := range LumaLoadProviders() {
		providerIDs[provider.ID] = true
	}
	removed := []string{}
	for id := range keys {
		if !providerIDs[id] {
			delete(keys, id)
			removed = append(removed, id)
		}
	}
	sort.Strings(removed)
	_ = lumaSaveProviderKeys(keys)
	diagnostics := LumaProviderKeyDiagnostics()
	diagnostics["removed"] = removed
	diagnostics["removed_count"] = len(removed)
	return diagnostics
}

func hasProviderEnvironmentKeys(providers []LumaAPIProvider) bool {
	for _, provider := range providers {
		envName := "LUMAFORGE_PROVIDER_" + strings.ToUpper(strings.ReplaceAll(provider.ID, "-", "_")) + "_API_KEY"
		if strings.TrimSpace(os.Getenv(envName)) != "" {
			return true
		}
	}
	return false
}

func LumaPublicProviders(providers []LumaAPIProvider) []LumaAPIProvider {
	keys := LumaLoadProviderKeys()
	public := make([]LumaAPIProvider, 0, len(providers))
	for _, provider := range normalizeLumaProviders(providers) {
		key := strings.TrimSpace(keys[provider.ID])
		provider.APIKey = ""
		provider.ClearKey = false
		provider.HasKey = key != ""
		provider.KeyPreview = keyPreview(key)
		public = append(public, provider)
	}
	return public
}

func LumaProviderByID(id string) (LumaAPIProvider, string, bool) {
	id = strings.ToLower(strings.TrimSpace(id))
	keys := LumaLoadProviderKeys()
	for _, provider := range LumaLoadProviders() {
		if provider.ID == id {
			return provider, keys[provider.ID], true
		}
	}
	return LumaAPIProvider{}, "", false
}

func LumaPrimaryProvider() (LumaAPIProvider, string, bool) {
	keys := LumaLoadProviderKeys()
	providers := LumaLoadProviders()
	for _, provider := range providers {
		if provider.Primary && provider.Enabled {
			return provider, keys[provider.ID], true
		}
	}
	if len(providers) > 0 {
		return providers[0], keys[providers[0].ID], true
	}
	return LumaAPIProvider{}, "", false
}

const lumaModelRefSeparator = "::"

func LumaModelRef(providerID string, modelName string) string {
	providerID = strings.ToLower(strings.TrimSpace(providerID))
	modelName = strings.TrimSpace(modelName)
	if providerID == "" || modelName == "" {
		return modelName
	}
	return providerID + lumaModelRefSeparator + modelName
}

func LumaSplitModelRef(value string) (string, string, bool) {
	value = strings.TrimSpace(value)
	parts := strings.SplitN(value, lumaModelRefSeparator, 2)
	if len(parts) != 2 {
		return "", value, false
	}
	providerID := strings.ToLower(strings.TrimSpace(parts[0]))
	modelName := strings.TrimSpace(parts[1])
	if providerID == "" || modelName == "" {
		return "", value, false
	}
	return providerID, modelName, true
}

func LumaRawModelName(value string) string {
	_, modelName, _ := LumaSplitModelRef(value)
	return modelName
}

func LumaModelChannel(modelName string) (model.ModelChannel, bool) {
	modelName = strings.TrimSpace(modelName)
	providerID, rawModelName, hasProviderRef := LumaSplitModelRef(modelName)
	providers := LumaLoadProviders()
	keys := LumaLoadProviderKeys()
	var fallback *LumaAPIProvider
	for i := range providers {
		provider := providers[i]
		if !provider.Enabled {
			continue
		}
		if provider.Primary {
			copyProvider := provider
			fallback = &copyProvider
		}
		models := append(append([]string{}, provider.ImageModels...), append(provider.ChatModels, provider.VideoModels...)...)
		if hasProviderRef {
			if provider.ID == providerID && stringInSlice(rawModelName, models) {
				return lumaProviderModelChannel(provider, keys[provider.ID], models), true
			}
			continue
		}
		if stringInSlice(modelName, models) {
			return lumaProviderModelChannel(provider, keys[provider.ID], models), true
		}
	}
	if fallback != nil {
		models := append(append([]string{}, fallback.ImageModels...), append(fallback.ChatModels, fallback.VideoModels...)...)
		return lumaProviderModelChannel(*fallback, keys[fallback.ID], models), true
	}
	return model.ModelChannel{}, false
}

func lumaProviderModelChannel(provider LumaAPIProvider, apiKey string, models []string) model.ModelChannel {
	return model.ModelChannel{
		Protocol: "openai",
		Name:     provider.Name,
		BaseURL:  provider.BaseURL,
		APIKey:   apiKey,
		Models:   models,
		Weight:   1,
		Enabled:  true,
	}
}

func stringInSlice(value string, values []string) bool {
	for _, item := range values {
		if strings.TrimSpace(item) == value {
			return true
		}
	}
	return false
}

func LumaFetchProviderModels(provider LumaAPIProvider, apiKey string) (map[string]any, error) {
	models, status, message, err := fetchOpenAIModels(provider.BaseURL, firstNonEmptyString(apiKey, provider.APIKey))
	if err != nil {
		if len(provider.ImageModels)+len(provider.ChatModels)+len(provider.VideoModels) > 0 {
			all := uniqueStrings(append(append([]string{}, provider.ImageModels...), append(provider.ChatModels, provider.VideoModels...)...))
			payload := classifiedModelPayload(all, status, message)
			payload["ok"] = false
			payload["fallback"] = true
			payload["message"] = fmt.Sprintf("模型列表接口不可用，当前展示的是手动保存模型。上游返回：%s", firstNonEmptyString(message, err.Error()))
			payload["reason"] = err.Error()
			return payload, nil
		}
		return nil, err
	}
	payload := classifiedModelPayload(models, status, message)
	payload["fallback"] = false
	return payload, nil
}

func LumaProbeProviderProtocol(provider LumaAPIProvider, apiKey string) map[string]any {
	baseURL := strings.TrimRight(strings.TrimSpace(provider.BaseURL), "/")
	if baseURL == "" {
		return map[string]any{
			"ok":         false,
			"protocol":   "manual",
			"confidence": "low",
			"message":    "请先填写 Base URL",
			"reason":     "missing_base_url",
		}
	}
	switch normalizeProtocolOverride(provider.ProtocolOverride) {
	case "force-openai":
		return map[string]any{
			"ok":         true,
			"protocol":   "openai",
			"confidence": "manual",
			"message":    "已按手动覆盖使用 OpenAI 兼容协议",
			"endpoint":   baseURL,
			"reason":     "user_override",
		}
	case "force-apimart":
		return map[string]any{
			"ok":         true,
			"protocol":   "apimart",
			"confidence": "manual",
			"message":    "已按手动覆盖使用 APIMart 异步协议",
			"endpoint":   baseURL,
			"reason":     "user_override",
		}
	}
	lowerURL := strings.ToLower(baseURL)
	if strings.Contains(lowerURL, "/contents/generations/tasks") || strings.Contains(lowerURL, "apimart") || strings.Contains(lowerURL, "volces") {
		return map[string]any{
			"ok":         true,
			"protocol":   "apimart",
			"confidence": "medium",
			"message":    "检测到异步任务式接口特征，建议使用 APIMart 异步协议",
			"endpoint":   baseURL,
			"reason":     "url_async_task_hint",
		}
	}
	models, status, message, err := fetchOpenAIModels(baseURL, firstNonEmptyString(apiKey, provider.APIKey))
	if err == nil {
		confidence := "high"
		if len(models) == 0 {
			confidence = "medium"
		}
		return map[string]any{
			"ok":          true,
			"protocol":    "openai",
			"confidence":  confidence,
			"status_code": status,
			"message":     fmt.Sprintf("OpenAI 兼容模型列表可访问，识别到 %d 个模型", len(models)),
			"model_count": len(models),
			"endpoint":    "models",
			"reason":      "models_endpoint_ok",
		}
	}
	if len(provider.ImageModels)+len(provider.ChatModels)+len(provider.VideoModels) > 0 {
		return map[string]any{
			"ok":          false,
			"fallback":    true,
			"protocol":    "openai",
			"confidence":  "low",
			"status_code": status,
			"message":     "模型列表接口不可用，但已存在手动模型，按 OpenAI 兼容处理",
			"model_count": len(provider.ImageModels) + len(provider.ChatModels) + len(provider.VideoModels),
			"reason":      "manual_models_fallback",
			"raw":         message,
		}
	}
	return map[string]any{
		"ok":          false,
		"protocol":    "manual",
		"confidence":  "low",
		"status_code": status,
		"message":     "未识别到可用协议，请手动选择",
		"reason":      err.Error(),
		"raw":         message,
	}
}

func fetchOpenAIModels(baseURL string, apiKey string) ([]string, int, string, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, 0, "Base URL 为空", errors.New("Base URL 为空")
	}
	modelURL := baseURL + "/models"
	if !strings.HasSuffix(strings.ToLower(baseURL), "/v1") {
		modelURL = baseURL + "/v1/models"
	}
	request, err := http.NewRequest(http.MethodGet, modelURL, nil)
	if err != nil {
		return nil, 0, "", err
	}
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	response, err := lumaHTTPClient.Do(request)
	if err != nil {
		return nil, 0, err.Error(), err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if response.StatusCode >= 400 {
		return nil, response.StatusCode, string(data), fmt.Errorf("上游返回 HTTP %d", response.StatusCode)
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, response.StatusCode, "模型列表返回格式异常", err
	}
	models := []string{}
	for _, item := range payload.Data {
		if strings.TrimSpace(item.ID) != "" {
			models = append(models, strings.TrimSpace(item.ID))
		}
	}
	sort.Strings(models)
	return models, response.StatusCode, "地址验证通过", nil
}

func classifiedModelPayload(models []string, status int, message string) map[string]any {
	models = uniqueStrings(models)
	imageModels := []string{}
	chatModels := []string{}
	videoModels := []string{}
	for _, name := range models {
		lower := strings.ToLower(name)
		switch {
		case strings.Contains(lower, "video") || strings.Contains(lower, "sora") || strings.Contains(lower, "veo") || strings.Contains(lower, "seedance") || strings.Contains(lower, "kling"):
			videoModels = append(videoModels, name)
		case strings.Contains(lower, "image") || strings.Contains(lower, "dall") || strings.Contains(lower, "banana") || strings.Contains(lower, "flux") || strings.Contains(lower, "seedream"):
			imageModels = append(imageModels, name)
		default:
			chatModels = append(chatModels, name)
		}
	}
	return map[string]any{
		"ok":           true,
		"status":       status,
		"message":      message,
		"all":          models,
		"total":        len(models),
		"model_count":  len(models),
		"image_models": imageModels,
		"chat_models":  chatModels,
		"video_models": videoModels,
	}
}

func LumaAppInfo() map[string]any {
	paths := LumaAppPaths()
	updateCapability := LumaUpdateCapability()
	return map[string]any{
		"name":                    "LumaForge",
		"display_name":            "光绘工坊",
		"version":                 LumaForgeVersion,
		"build_id":                LumaForgeBuildID,
		"desktop":                 updateCapability["desktop"],
		"runtime_dir":             filepath.Dir(LumaDataDir()),
		"data_dir":                LumaDataDir(),
		"assets_dir":              LumaAssetsDir(),
		"output_dir":              LumaOutputDir(),
		"paths":                   paths,
		"update_capable":          true,
		"update_capability":       updateCapability,
		"update_check_configured": strings.TrimSpace(config.Cfg.UpdateCheckURL) != "",
		"update_check_url":        config.Cfg.UpdateCheckURL,
		"legacy_api_url":          strings.TrimRight(config.Cfg.LumaForgeLegacyAPI, "/"),
		"entry":                   LumaEntryInfo(),
		"update_state":            LumaUpdateState(),
		"app_actions":             LumaAppActionCapability(),
	}
}

func LumaAppActionCapability() map[string]any {
	legacyURL := strings.TrimRight(strings.TrimSpace(config.Cfg.LumaForgeLegacyAPI), "/")
	desktop := os.Getenv("LUMAFORGE_DESKTOP") == "1" || os.Getenv("INFINITE_CANVAS_DESKTOP") == "1"
	supported := legacyURL != ""
	reason := ""
	restartMode := ""
	exitMode := ""
	if supported {
		restartMode = "desktop-bridge"
		exitMode = "desktop-bridge"
	} else {
		reason = "当前 Go + Next 主体未连接桌面生命周期桥；请通过 LumaForge.exe 启动后再重启或退出。"
	}
	return map[string]any{
		"restart_supported": supported,
		"exit_supported":    supported,
		"restart_mode":      restartMode,
		"exit_mode":         exitMode,
		"desktop":           desktop,
		"legacy_api_url":    legacyURL,
		"reason":            reason,
	}
}

func LumaEntryInfo() map[string]any {
	apiURL := strings.TrimRight(strings.TrimSpace(os.Getenv("LUMAFORGE_API_URL")), "/")
	if apiURL == "" {
		apiURL = "http://127.0.0.1:" + strings.TrimSpace(config.Cfg.Port)
	}
	appURL := strings.TrimSpace(os.Getenv("LUMAFORGE_APP_URL"))
	if appURL == "" {
		appURL = strings.TrimSpace(config.Cfg.PublicBaseURL)
	}
	return map[string]any{
		"canonical_host": "127.0.0.1",
		"app_url":        appURL,
		"api_url":        apiURL,
		"api_port":       strings.TrimSpace(config.Cfg.Port),
		"legacy_api_url": strings.TrimRight(strings.TrimSpace(config.Cfg.LumaForgeLegacyAPI), "/"),
	}
}

func LumaReleaseHealth() map[string]any {
	checks := []map[string]any{}
	add := func(id string, label string, status string, detail string, action string) {
		check := map[string]any{
			"id":     id,
			"label":  label,
			"status": status,
			"detail": detail,
		}
		if strings.TrimSpace(action) != "" {
			check["action"] = action
		}
		checks = append(checks, check)
	}

	if strings.TrimSpace(LumaForgeVersion) != "" && strings.TrimSpace(LumaForgeBuildID) != "" {
		add("version", "版本与构建", "ok", LumaForgeVersion+" / "+LumaForgeBuildID, "")
	} else {
		add("version", "版本与构建", "error", "版本或构建号缺失", "重新执行发布构建")
	}

	entry := LumaEntryInfo()
	entryDetail := fmt.Sprintf("入口 %s，API %s", stringFromAny(entry["app_url"]), stringFromAny(entry["api_url"]))
	if strings.Contains(stringFromAny(entry["api_url"]), "127.0.0.1") {
		add("entry", "桌面入口", "ok", entryDetail, "")
	} else {
		add("entry", "桌面入口", "warn", entryDetail, "建议统一使用 127.0.0.1")
	}

	updateCapability := LumaUpdateCapability()
	if strings.TrimSpace(config.Cfg.UpdateCheckURL) == "" {
		add("update_source", "更新源", "error", "未配置更新检查地址", "配置 APP_UPDATE_CHECK_URL")
	} else {
		add("update_source", "更新源", "ok", config.Cfg.UpdateCheckURL, "")
	}
	if boolFromAny(updateCapability["supported"]) {
		add("auto_update", "自动更新器", "ok", "桌面更新器已连接", "")
	} else if stringFromAny(updateCapability["mode"]) == "source-mode" {
		add("auto_update", "自动更新器", "warn", stringFromAny(updateCapability["reason"]), "构建桌面版后再验证自动更新闭环")
	} else {
		add("auto_update", "自动更新器", "error", stringFromAny(updateCapability["reason"]), "通过桌面启动器启动应用")
	}
	updateState := LumaUpdateState()
	phase := stringFromAny(updateState["phase"])
	if phase == "failed" {
		add("update_state", "更新状态", "warn", stringFromAny(updateState["error"]), "清理失败任务后重试")
	} else if boolFromAny(updateState["stalled"]) {
		add("update_state", "更新状态", "warn", fmt.Sprintf("%s，下载进度疑似停滞 %d 秒", firstNonEmptyString(phase, "idle"), intFromAny(updateState["stalled_seconds"])), "清理临时更新文件后重试")
	} else {
		add("update_state", "更新状态", "ok", firstNonEmptyString(phase, "idle"), "")
	}

	session := LumaLoadCloudSession()
	if strings.TrimSpace(session.Token) != "" {
		add("login_recovery", "登录恢复", "ok", "已保存云端会话，可静默恢复", "")
	} else {
		add("login_recovery", "登录恢复", "warn", "当前没有保存登录会话", "登录一次后再检查")
	}

	keyDiagnostics := LumaProviderKeyDiagnostics()
	providerCount := intFromAny(keyDiagnostics["provider_count"])
	storedKeyCount := intFromAny(keyDiagnostics["stored_key_count"])
	orphanKeyCount := intFromAny(keyDiagnostics["orphan_count"])
	if providerCount <= 0 {
		add("api_config", "API 配置", "error", "没有可用 API 平台", "在 API 设置中添加本地平台")
	} else if storedKeyCount <= 0 && !boolFromAny(keyDiagnostics["has_environment_keys"]) && !boolFromAny(keyDiagnostics["recoverable_from_cloud"]) {
		add("api_config", "API 配置", "warn", fmt.Sprintf("已配置 %d 个平台，但没有本地密钥", providerCount), "在本地 API 中保存密钥或从云端恢复")
	} else {
		add("api_config", "API 配置", "ok", fmt.Sprintf("已配置 %d 个平台，%d 个本地密钥", providerCount, storedKeyCount), "")
	}
	if orphanKeyCount > 0 {
		add("api_orphan_keys", "API 孤立密钥", "warn", fmt.Sprintf("%d 个密钥没有对应平台", orphanKeyCount), "在 API 设置里清理孤立 Key")
	} else {
		add("api_orphan_keys", "API 孤立密钥", "ok", "没有孤立 Key", "")
	}
	if boolFromAny(keyDiagnostics["cloud_config_available"]) {
		add("api_cloud_boundary", "API 云端边界", "ok", "云端配置可用于恢复 Key，本地平台仍由本机保存", "")
	} else if boolFromAny(keyDiagnostics["recoverable_from_cloud"]) {
		add("api_cloud_boundary", "API 云端边界", "warn", "云端有可恢复 Key", "进入 API 设置执行恢复")
	} else {
		add("api_cloud_boundary", "API 云端边界", "ok", "本地 API 平台独立保存", "")
	}

	paths := LumaAppPaths()
	if err := os.MkdirAll(paths["save"], 0755); err != nil {
		add("assets", "素材库", "error", err.Error(), "检查素材目录权限")
	} else {
		add("assets", "素材库", "ok", paths["save"], "")
	}
	if err := os.MkdirAll(paths["output"], 0755); err != nil {
		add("canvas_save", "画布保存与输出", "error", err.Error(), "检查输出目录权限")
	} else {
		add("canvas_save", "画布保存与输出", "ok", paths["output"], "")
	}
	if lumaCanvasStaticExists() {
		add("canvas_static", "画布静态资源", "ok", "画布页面可用", "")
	} else {
		add("canvas_static", "画布静态资源", "warn", "未在当前工作目录发现画布静态文件", "确认桌面包包含 web/static 资源")
	}
	if strings.TrimSpace(config.Cfg.LumaForgeLegacyAPI) != "" {
		add("canvas_assets", "画布生成素材入库", "ok", "素材上传桥已连接", "")
	} else {
		add("canvas_assets", "画布生成素材入库", "warn", "未连接 legacy 素材上传桥", "通过桌面启动器启动完整服务")
	}
	canvasCaps := lumaCanvasSourceCapabilities()
	if boolFromAny(canvasCaps["prompt_refs"]) {
		add("canvas_prompt_refs", "画布引用链路", "ok", "支持 promptRefs、inputReferenceOrder、runPromptRefs", "")
	} else {
		add("canvas_prompt_refs", "画布引用链路", "warn", "未检测到完整 prompt 引用字段", "确认 React 画布源码已包含结构化引用")
	}
	if boolFromAny(canvasCaps["history"]) {
		add("canvas_history", "画布撤销重做", "ok", "画布结构历史栈可用", "")
	} else {
		add("canvas_history", "画布撤销重做", "warn", "未检测到画布级 undo/redo", "补齐画布历史栈")
	}
	if boolFromAny(canvasCaps["asset_sync"]) {
		add("canvas_asset_sync", "画布素材同步桥", "ok", "生成素材会写前端素材库并同步 /api/assets/upload", "")
	} else {
		add("canvas_asset_sync", "画布素材同步桥", "warn", "未检测到画布生成素材同步入口", "确认 saveCanvasGeneratedAsset 或同步桥存在")
	}
	if boolFromAny(canvasCaps["connections"]) {
		add("canvas_connections", "画布连线操作", "ok", "连线选择与删除入口可用", "")
	} else {
		add("canvas_connections", "画布连线操作", "warn", "未检测到连线删除/选择入口", "检查连接交互实现")
	}

	status := "ok"
	for _, check := range checks {
		switch check["status"] {
		case "error":
			status = "error"
		case "warn":
			if status == "ok" {
				status = "warn"
			}
		}
	}
	return map[string]any{
		"ok":         status != "error",
		"status":     status,
		"version":    LumaForgeVersion,
		"build_id":   LumaForgeBuildID,
		"entry":      entry,
		"checked_at": time.Now().Format(time.RFC3339),
		"checks":     checks,
	}
}

func lumaCanvasStaticExists() bool {
	candidates := []string{
		filepath.Join("static", "smart-canvas.html"),
		filepath.Join("_internal", "static", "smart-canvas.html"),
	}
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		exeParent := filepath.Dir(exeDir)
		candidates = append(candidates,
			filepath.Join(exeDir, "static", "smart-canvas.html"),
			filepath.Join(exeDir, "_internal", "static", "smart-canvas.html"),
			filepath.Join(exeParent, "static", "smart-canvas.html"),
			filepath.Join(exeParent, "_internal", "static", "smart-canvas.html"),
		)
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

func lumaCanvasSourceCapabilities() map[string]any {
	if caps, err := lumaFetchCanvasCapabilities(); err == nil {
		caps["source"] = "frontend"
		return caps
	}
	return map[string]any{
		"prompt_refs": false,
		"history":     false,
		"asset_sync":  false,
		"connections": false,
		"source":      "frontend_unreachable",
	}
}

func lumaFetchCanvasCapabilities() (map[string]any, error) {
	appURL := strings.TrimSpace(os.Getenv("LUMAFORGE_APP_URL"))
	if appURL == "" {
		appURL = strings.TrimSpace(config.Cfg.PublicBaseURL)
	}
	if appURL == "" {
		return nil, errors.New("frontend app url missing")
	}
	endpoint := strings.TrimRight(appURL, "/") + "/api/canvas/capabilities"
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(endpoint)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("frontend capabilities returned HTTP %d", response.StatusCode)
	}
	var caps map[string]any
	if err := json.NewDecoder(response.Body).Decode(&caps); err != nil {
		return nil, err
	}
	return caps, nil
}

func LumaUpdateCapability() map[string]any {
	legacyURL := strings.TrimSpace(config.Cfg.LumaForgeLegacyAPI)
	desktop := os.Getenv("LUMAFORGE_DESKTOP") == "1" || os.Getenv("INFINITE_CANVAS_DESKTOP") == "1"
	supported := legacyURL != ""
	mode := "source-mode"
	reason := "当前是源码/开发模式，自动替换桌面程序不可用；桌面版启动后会启用自动更新器。"
	if desktop {
		mode = "legacy-updater-missing"
		reason = "当前桌面主体未连接 legacy updater；请通过桌面启动器启动 LumaForge 后再执行自动升级。"
	}
	if supported {
		mode = "desktop-updater"
		reason = ""
	}
	return map[string]any{
		"supported":      supported,
		"mode":           mode,
		"updater_path":   "",
		"reason":         reason,
		"desktop":        desktop,
		"legacy_api_url": strings.TrimRight(legacyURL, "/"),
	}
}

func lumaProbeWritableDir(path string, create bool) map[string]any {
	if create {
		if err := os.MkdirAll(path, 0755); err != nil {
			return map[string]any{"ok": false, "path": path, "detail": err.Error()}
		}
	}
	info, err := os.Stat(path)
	if err != nil {
		return map[string]any{"ok": false, "path": path, "detail": err.Error()}
	}
	if !info.IsDir() {
		return map[string]any{"ok": false, "path": path, "detail": "not a directory"}
	}
	probe := filepath.Join(path, ".lumaforge-write-test-"+strconv.FormatInt(time.Now().UnixNano(), 36)+".tmp")
	if err := os.WriteFile(probe, []byte("ok"), 0644); err != nil {
		return map[string]any{"ok": false, "path": path, "detail": err.Error()}
	}
	_ = os.Remove(probe)
	return map[string]any{"ok": true, "path": path, "detail": "writable"}
}

func LumaUpdatePreflight() map[string]any {
	capability := LumaUpdateCapability()
	mode := stringFromAny(capability["mode"])
	appDir, _ := os.Getwd()
	checks := []map[string]any{}
	add := func(id string, label string, ok bool, detail string, blocking bool) {
		checks = append(checks, map[string]any{
			"id":       id,
			"label":    label,
			"ok":       ok,
			"detail":   detail,
			"blocking": blocking,
		})
	}
	add("version", "Current version", strings.TrimSpace(LumaForgeVersion) != "", LumaForgeVersion+" / "+LumaForgeBuildID, true)
	add("update_source", "Update source", strings.TrimSpace(config.Cfg.UpdateCheckURL) != "", firstNonEmptyString(strings.TrimSpace(config.Cfg.UpdateCheckURL), "not configured"), true)
	add("source_mode", "Source mode", mode != "source-mode", firstNonEmptyString(stringFromAny(capability["reason"]), mode), false)
	add("auto_update", "Auto update capability", boolFromAny(capability["supported"]), firstNonEmptyString(stringFromAny(capability["legacy_api_url"]), stringFromAny(capability["reason"]), mode), mode != "source-mode")
	add("desktop_updater", "Desktop updater", boolFromAny(capability["supported"]), firstNonEmptyString(stringFromAny(capability["updater_path"]), stringFromAny(capability["legacy_api_url"]), "not connected"), mode != "source-mode")

	paths := map[string]string{
		"downloads_dir": filepath.Join(lumaPath("updates"), "downloads"),
		"staging_dir":   filepath.Join(lumaPath("updates"), "staging"),
		"backups_dir":   filepath.Join(lumaPath("updates"), "backups"),
		"data_dir":      LumaDataDir(),
		"assets_dir":    LumaAssetsDir(),
	}
	labels := map[string]string{
		"downloads_dir": "Downloads directory",
		"staging_dir":   "Staging directory",
		"backups_dir":   "Backups directory",
		"data_dir":      "Data directory",
		"assets_dir":    "Assets directory",
	}
	for _, id := range []string{"downloads_dir", "staging_dir", "backups_dir", "data_dir", "assets_dir"} {
		probe := lumaProbeWritableDir(paths[id], true)
		add(id, labels[id], boolFromAny(probe["ok"]), stringFromAny(probe["path"])+" - "+stringFromAny(probe["detail"]), true)
	}
	blocking := []map[string]any{}
	warnings := []map[string]any{}
	for _, check := range checks {
		if boolFromAny(check["ok"]) {
			continue
		}
		if boolFromAny(check["blocking"]) {
			blocking = append(blocking, check)
		} else {
			warnings = append(warnings, check)
		}
	}
	return map[string]any{
		"ok":                len(blocking) == 0,
		"blocking_count":    len(blocking),
		"warning_count":     len(warnings),
		"current_version":   LumaForgeVersion,
		"build_id":          LumaForgeBuildID,
		"mode":              mode,
		"source_mode":       mode == "source-mode",
		"app_dir":           appDir,
		"runtime_dir":       filepath.Dir(LumaDataDir()),
		"data_dir":          LumaDataDir(),
		"assets_dir":        LumaAssetsDir(),
		"downloads_dir":     paths["downloads_dir"],
		"staging_dir":       paths["staging_dir"],
		"backups_dir":       paths["backups_dir"],
		"update_capability": capability,
		"update_check_url":  strings.TrimSpace(config.Cfg.UpdateCheckURL),
		"update_configured": strings.TrimSpace(config.Cfg.UpdateCheckURL) != "",
		"checks":            checks,
		"blocking":          blocking,
		"warnings":          warnings,
	}
}

func LumaAppPaths() map[string]string {
	settings := lumaLoadAppPathSettings()
	defaults := lumaDefaultAppPaths()
	paths := map[string]string{}
	for key, value := range defaults {
		if override := strings.TrimSpace(settings[key]); override != "" {
			paths[key] = override
		} else {
			paths[key] = value
		}
	}
	if strings.TrimSpace(settings["save"]) != "" {
		if strings.TrimSpace(settings["output"]) == "" {
			paths["output"] = filepath.Join(paths["save"], "output")
		}
		if strings.TrimSpace(settings["input"]) == "" {
			paths["input"] = filepath.Join(paths["save"], "input")
		}
		if strings.TrimSpace(settings["thumbs"]) == "" {
			paths["thumbs"] = filepath.Join(paths["save"], "thumbs")
		}
	}
	return paths
}

func LumaSaveAppPath(target string, rawPath string) (map[string]string, error) {
	target = strings.ToLower(strings.TrimSpace(target))
	if !lumaValidAppPathTarget(target) || target == "data" {
		return nil, fmt.Errorf("不支持修改该目录")
	}
	path := strings.TrimSpace(rawPath)
	if path == "" {
		return nil, fmt.Errorf("目录不能为空")
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(absPath, 0755); err != nil {
		return nil, err
	}
	settings := lumaLoadAppPathSettings()
	settings[target] = absPath
	if target == "save" {
		for _, child := range []string{"input", "output", "thumbs"} {
			if strings.TrimSpace(settings[child]) == "" {
				_ = os.MkdirAll(filepath.Join(absPath, child), 0755)
			}
		}
	}
	if err := writeJSONFile(lumaPath("app_paths.json"), settings); err != nil {
		return nil, err
	}
	return LumaAppPaths(), nil
}

func LumaAppPath(target string) (string, error) {
	target = strings.ToLower(strings.TrimSpace(target))
	paths := LumaAppPaths()
	path := strings.TrimSpace(paths[target])
	if path == "" || !lumaValidAppPathTarget(target) {
		return "", fmt.Errorf("未知目录")
	}
	if err := os.MkdirAll(path, 0755); err != nil {
		return "", err
	}
	return path, nil
}

func lumaLoadAppPathSettings() map[string]string {
	paths := map[string]string{}
	_ = readJSONFile(lumaPath("app_paths.json"), &paths)
	return paths
}

func lumaDefaultAppPaths() map[string]string {
	runtimeDir := filepath.Dir(LumaDataDir())
	saveDir := lumaDefaultAssetsDir()
	return map[string]string{
		"save":   saveDir,
		"output": lumaDefaultOutputDir(),
		"input":  filepath.Join(saveDir, "input"),
		"thumbs": filepath.Join(saveDir, "thumbs"),
		"logs":   filepath.Join(runtimeDir, "logs"),
		"cache":  filepath.Join(runtimeDir, "cache"),
		"data":   LumaDataDir(),
	}
}

func lumaValidAppPathTarget(target string) bool {
	switch target {
	case "save", "output", "input", "thumbs", "logs", "cache", "data":
		return true
	default:
		return false
	}
}

func RunLumaMigration() {
	reportPath := lumaPath("migration-2.1.0.json")
	if _, err := os.Stat(reportPath); err == nil {
		return
	}
	report := map[string]any{
		"version":            LumaForgeVersion,
		"build_id":           LumaForgeBuildID,
		"created_at":         time.Now().Format(time.RFC3339),
		"mode":               "non_destructive_reuse",
		"data_dir":           LumaDataDir(),
		"assets_dir":         LumaAssetsDir(),
		"api_providers_file": fileExists(lumaPath("api_providers.json")),
		"cloud_session_file": fileExists(lumaPath("cloud_session.json")),
		"notes":              []string{"旧数据目录只读复用；未删除、未搬移用户文件。", "深度画布/素材迁移将在后续迁移器中扩展。"},
	}
	_ = writeJSONFile(reportPath, report)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func LumaUpdateState() map[string]any {
	state := map[string]any{}
	_ = readJSONFile(lumaPath("update_state.json"), &state)
	if state["phase"] == nil {
		state["phase"] = "idle"
	}
	if latest := firstNonEmptyString(stringFromAny(state["latest_version"]), stringFromAny(state["target_version"]), stringFromAny(state["version"])); latest != "" && compareVersion(latest, LumaForgeVersion) <= 0 {
		clearLumaCurrentUpdateState(state)
	}
	state["current_version"] = LumaForgeVersion
	state["build_id"] = LumaForgeBuildID
	downloaded := intFromAny(state["downloaded_bytes"])
	total := intFromAny(firstNonNil(state["total_bytes"], state["package_size"], state["size"]))
	progress := 0.0
	if total > 0 {
		progress = float64(downloaded) / float64(total) * 100
		if progress < 0 {
			progress = 0
		}
		if progress > 100 {
			progress = 100
		}
	}
	lastProgressAt := intFromAny(firstNonNil(state["last_progress_at"], state["saved_at"], state["updated_at"]))
	stalledSeconds := 0
	if lastProgressAt > 0 {
		stalledSeconds = int((time.Now().UnixMilli() - int64(lastProgressAt)) / 1000)
		if stalledSeconds < 0 {
			stalledSeconds = 0
		}
	}
	phase := stringFromAny(state["phase"])
	stalled := phase == "downloading" && stalledSeconds >= lumaUpdateDownloadStallSeconds
	tempPath := stringFromAny(state["temp_path"])
	canCleanup := (phase == "failed" || phase == "downloading" || phase == "downloaded" || phase == "verifying" || phase == "idle") &&
		(tempPath != "" || stringFromAny(state["path"]) != "" || stringFromAny(state["filename"]) != "")
	state["download_progress"] = float64(int(progress*10)) / 10
	state["stalled_seconds"] = stalledSeconds
	state["stalled"] = stalled
	state["can_cleanup"] = canCleanup
	state["update_capability"] = LumaUpdateCapability()
	return state
}

func clearLumaCurrentUpdateState(state map[string]any) {
	state["phase"] = "idle"
	state["latest_version"] = LumaForgeVersion
	state["target_version"] = ""
	state["version"] = ""
	state["asset"] = nil
	state["assets"] = []map[string]any{}
	state["selected_asset"] = nil
	state["download"] = nil
	state["filename"] = ""
	state["path"] = ""
	state["temp_path"] = ""
	state["package_size"] = 0
	state["total_bytes"] = 0
	state["downloaded_bytes"] = 0
	state["sha256"] = ""
	state["sha256_expected"] = ""
	state["sha256_verified"] = false
	state["error"] = nil
	state["backup_dir"] = ""
	state["notes"] = ""
}

func LumaSaveUpdateState(patch map[string]any) map[string]any {
	state := LumaUpdateState()
	for key, value := range patch {
		state[key] = value
	}
	state["updated_at"] = time.Now().UnixMilli()
	_ = writeJSONFile(lumaPath("update_state.json"), state)
	return LumaUpdateState()
}

func LumaCleanupUpdatePackage() map[string]any {
	state := LumaUpdateState()
	removed := []string{}
	downloadsDir := filepath.Join(lumaPath("updates"), "downloads")
	candidates := []string{
		stringFromAny(state["temp_path"]),
		stringFromAny(state["path"]),
	}
	if filename := strings.TrimSpace(stringFromAny(state["filename"])); filename != "" {
		candidates = append(candidates, filepath.Join(downloadsDir, filename+".part"))
	}
	for _, candidate := range candidates {
		path := strings.TrimSpace(candidate)
		if path == "" {
			continue
		}
		abs, err := filepath.Abs(path)
		if err != nil || !lumaIsSafeChildPath(abs, downloadsDir) {
			continue
		}
		if info, err := os.Stat(abs); err == nil && !info.IsDir() {
			_ = os.Remove(abs)
			removed = append(removed, abs)
		}
	}
	return LumaSaveUpdateState(map[string]any{
		"phase":         "idle",
		"error":         nil,
		"temp_path":     "",
		"cleaned_files": removed,
	})
}

func lumaIsSafeChildPath(path string, root string) bool {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return false
	}
	return rel == "." || (rel != "" && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

func LumaUpdateCheck() map[string]any {
	checkURL := strings.TrimSpace(config.Cfg.UpdateCheckURL)
	if checkURL == "" {
		updateCapability := LumaUpdateCapability()
		autoUpdateReason := stringFromAny(updateCapability["reason"])
		LumaSaveUpdateState(map[string]any{
			"phase":            "idle",
			"current_version":  LumaForgeVersion,
			"latest_version":   "",
			"target_version":   "",
			"version":          "",
			"asset":            nil,
			"assets":           []map[string]any{},
			"selected_asset":   nil,
			"download":         nil,
			"filename":         "",
			"path":             "",
			"temp_path":        "",
			"package_size":     0,
			"total_bytes":      0,
			"downloaded_bytes": 0,
			"sha256":           "",
			"sha256_expected":  "",
			"sha256_verified":  false,
			"backup_dir":       "",
			"notes":            "",
			"error":            nil,
		})
		return map[string]any{
			"configured":            false,
			"ok":                    false,
			"current_version":       LumaForgeVersion,
			"latest_version":        "",
			"is_newer":              false,
			"asset":                 nil,
			"assets":                []map[string]any{},
			"selected_asset":        nil,
			"download_url":          "",
			"release_notes":         "",
			"notes":                 "",
			"message":               "未配置更新检查地址",
			"auto_update_supported": false,
			"auto_update_reason":    firstNonEmpty(autoUpdateReason, "未配置更新检查地址，暂时不能自动升级。"),
			"update_mode":           updateCapability["mode"],
			"update_capability":     updateCapability,
		}
	}
	LumaSaveUpdateState(map[string]any{"phase": "checking", "error": nil})
	latest, asset, notes, err := fetchLatestGitHubRelease(checkURL)
	if err != nil {
		LumaSaveUpdateState(map[string]any{"phase": "failed", "error": err.Error()})
		updateCapability := LumaUpdateCapability()
		return map[string]any{
			"configured":            true,
			"ok":                    false,
			"current_version":       LumaForgeVersion,
			"latest_version":        "",
			"is_newer":              false,
			"asset":                 nil,
			"assets":                []map[string]any{},
			"selected_asset":        nil,
			"download_url":          "",
			"release_notes":         "",
			"notes":                 "",
			"message":               err.Error(),
			"source_url":            checkURL,
			"auto_update_supported": false,
			"auto_update_reason":    err.Error(),
			"update_mode":           updateCapability["mode"],
			"update_capability":     updateCapability,
		}
	}
	isNewer := compareVersion(latest, LumaForgeVersion) > 0
	updateCapability := LumaUpdateCapability()
	autoUpdateSupported := boolFromAny(updateCapability["supported"])
	autoUpdateReason := stringFromAny(updateCapability["reason"])
	phase := "idle"
	var stateAsset any
	stateAssets := []map[string]any{}
	if isNewer {
		phase = "found"
		if asset != nil && strings.TrimSpace(stringFromAny(asset["url"])) != "" {
			stateAsset = asset
			stateAssets = []map[string]any{asset}
		}
	}
	statePatch := map[string]any{
		"phase":          phase,
		"latest_version": latest,
		"asset":          stateAsset,
		"assets":         stateAssets,
		"selected_asset": stateAsset,
		"error":          nil,
	}
	if !isNewer {
		statePatch["target_version"] = ""
		statePatch["version"] = ""
		statePatch["download"] = nil
		statePatch["filename"] = ""
		statePatch["path"] = ""
		statePatch["temp_path"] = ""
		statePatch["package_size"] = 0
		statePatch["total_bytes"] = 0
		statePatch["downloaded_bytes"] = 0
		statePatch["sha256"] = ""
		statePatch["sha256_expected"] = ""
		statePatch["sha256_verified"] = false
		statePatch["backup_dir"] = ""
		statePatch["notes"] = ""
	}
	LumaSaveUpdateState(statePatch)
	downloadURL := ""
	if stateAsset != nil {
		downloadURL = stringFromAny(asset["url"])
	}
	return map[string]any{
		"configured":            true,
		"ok":                    true,
		"current_version":       LumaForgeVersion,
		"latest_version":        latest,
		"is_newer":              isNewer,
		"asset":                 stateAsset,
		"assets":                stateAssets,
		"selected_asset":        stateAsset,
		"download_url":          downloadURL,
		"release_notes":         notes,
		"notes":                 notes,
		"source_url":            checkURL,
		"auto_update_supported": autoUpdateSupported,
		"auto_update_reason":    autoUpdateReason,
		"update_mode":           updateCapability["mode"],
		"update_capability":     updateCapability,
	}
}

func fetchLatestGitHubRelease(checkURL string) (string, map[string]any, string, error) {
	request, err := http.NewRequest(http.MethodGet, checkURL, nil)
	if err != nil {
		return "", nil, "", err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "LumaForge/"+LumaForgeVersion)
	response, err := lumaHTTPClient.Do(request)
	if err != nil {
		return "", nil, "", err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if response.StatusCode >= 400 {
		return "", nil, "", fmt.Errorf("更新检查失败：HTTP %d", response.StatusCode)
	}
	var releases []map[string]any
	if strings.HasSuffix(strings.TrimRight(checkURL, "/"), "/latest") {
		var single map[string]any
		if err := json.Unmarshal(data, &single); err != nil {
			return "", nil, "", err
		}
		releases = []map[string]any{single}
	} else if err := json.Unmarshal(data, &releases); err != nil {
		var single map[string]any
		if err2 := json.Unmarshal(data, &single); err2 != nil {
			return "", nil, "", err
		}
		releases = []map[string]any{single}
	}
	sort.SliceStable(releases, func(i, j int) bool {
		return compareVersion(releaseVersion(releases[i]), releaseVersion(releases[j])) > 0
	})
	for _, release := range releases {
		if boolFromAny(release["draft"]) || boolFromAny(release["prerelease"]) {
			continue
		}
		version := releaseVersion(release)
		if !strings.HasPrefix(version, "2.") {
			continue
		}
		asset := selectDesktopZipAsset(release)
		return version, asset, stringFromAny(release["body"]), nil
	}
	return "", nil, "", errors.New("没有找到可用的 2.x GitHub Release")
}

func releaseVersion(release map[string]any) string {
	value := strings.TrimSpace(firstNonEmptyString(stringFromAny(release["tag_name"]), stringFromAny(release["name"])))
	value = strings.TrimPrefix(strings.TrimPrefix(value, "v"), "V")
	if strings.HasPrefix(value, "20.0.") {
		value = "2.0." + strings.TrimPrefix(value, "20.0.")
	}
	return value
}

func selectDesktopZipAsset(release map[string]any) map[string]any {
	rawAssets, _ := release["assets"].([]any)
	fallback := map[string]any{}
	for _, raw := range rawAssets {
		asset, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := stringFromAny(asset["name"])
		url := firstNonEmptyString(stringFromAny(asset["browser_download_url"]), stringFromAny(asset["url"]))
		if strings.TrimSpace(url) == "" {
			continue
		}
		lower := strings.ToLower(name)
		lowerURL := strings.ToLower(url)
		if index := strings.IndexAny(lowerURL, "?#"); index >= 0 {
			lowerURL = lowerURL[:index]
		}
		if !strings.HasSuffix(lower, ".zip") && !strings.HasSuffix(lowerURL, ".zip") {
			continue
		}
		sha256 := ""
		if digest := stringFromAny(asset["digest"]); strings.HasPrefix(strings.ToLower(digest), "sha256:") {
			sha256 = strings.TrimSpace(strings.SplitN(digest, ":", 2)[1])
		}
		if sha256 == "" {
			sha256 = strings.TrimSpace(stringFromAny(asset["sha256"]))
		}
		item := map[string]any{
			"name":   name,
			"url":    url,
			"size":   asset["size"],
			"sha256": sha256,
			"type":   "asset",
		}
		if fallback["name"] == nil {
			fallback = item
		}
		isZip := strings.HasSuffix(lower, ".zip") || strings.HasSuffix(lowerURL, ".zip")
		isDesktop := strings.Contains(lower, "desktop") || strings.Contains(lowerURL, "desktop")
		if isZip && isDesktop {
			return item
		}
	}
	return fallback
}

func compareVersion(a string, b string) int {
	ap := versionParts(a)
	bp := versionParts(b)
	for i := 0; i < 3; i++ {
		if ap[i] > bp[i] {
			return 1
		}
		if ap[i] < bp[i] {
			return -1
		}
	}
	return 0
}

func versionParts(value string) [3]int {
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	parts := strings.Split(value, ".")
	result := [3]int{}
	for i := 0; i < len(parts) && i < 3; i++ {
		n, _ := strconv.Atoi(regexp.MustCompile(`\D.*$`).ReplaceAllString(parts[i], ""))
		result[i] = n
	}
	return result
}

func keyPreview(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return strings.Repeat("*", len(key))
	}
	return key[:4] + "..." + key[len(key)-4:]
}

func uniqueStrings(values []string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		result = append(result, item)
	}
	return result
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func boolFromAny(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "1" || strings.EqualFold(typed, "true") || strings.EqualFold(typed, "yes")
	default:
		return false
	}
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return int(parsed)
		}
		return 0
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(typed))
		return parsed
	default:
		return 0
	}
}
