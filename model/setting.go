package model

import "encoding/json"

type SettingKey string

const (
	SettingKeyPublic  SettingKey = "public"
	SettingKeyPrivate SettingKey = "private"
)

// ModelChannel 模型渠道配置。
type ModelChannel struct {
	Protocol string   `json:"protocol"`
	Name     string   `json:"name"`
	BaseURL  string   `json:"baseUrl"`
	APIKey   string   `json:"apiKey"`
	Models   []string `json:"models"`
	Weight   int      `json:"weight"`
	Enabled  bool     `json:"enabled"`
	Remark   string   `json:"remark"`
}

// ModelCost 模型算力点配置。
type ModelCost struct {
	Model   string `json:"model"`
	Credits int    `json:"credits"`
}

// ProviderModelOption 是 v2.1 前端使用的平台感知模型身份。
// AvailableModels 继续保留纯模型名，供旧页面和旧客户端兼容。
type ProviderModelOption struct {
	Value        string `json:"value"`
	ProviderID   string `json:"providerId"`
	ProviderName string `json:"providerName"`
	Model        string `json:"model"`
	Capability   string `json:"capability"`
	Label        string `json:"label"`
	Enabled      bool   `json:"enabled"`
}

// PublicModelChannelSetting 公开模型渠道配置。
type PublicModelChannelSetting struct {
	AvailableModels    []string              `json:"availableModels"`
	ProviderModels     []ProviderModelOption `json:"providerModels,omitempty"`
	ModelCosts         []ModelCost           `json:"modelCosts"`
	DefaultModel       string                `json:"defaultModel"`
	DefaultImageModel  string                `json:"defaultImageModel"`
	DefaultVideoModel  string                `json:"defaultVideoModel"`
	DefaultTextModel   string                `json:"defaultTextModel"`
	SystemPrompt       string                `json:"systemPrompt"`
	AllowCustomChannel *bool                 `json:"allowCustomChannel"`
}

// PublicSetting 公开配置。
type PublicSetting struct {
	ModelChannel PublicModelChannelSetting `json:"modelChannel"`
	Auth         PublicAuthSetting         `json:"auth"`
}

type PublicAuthSetting struct {
	AllowRegister *bool                    `json:"allowRegister"`
	LinuxDo       PublicLinuxDoAuthSetting `json:"linuxDo"`
}

type PublicLinuxDoAuthSetting struct {
	Enabled bool `json:"enabled"`
}

// PrivateSetting 私有配置。
type PrivateSetting struct {
	Channels   []ModelChannel     `json:"channels"`
	PromptSync PromptSyncSetting  `json:"promptSync"`
	Auth       PrivateAuthSetting `json:"auth"`
}

// PromptSyncSetting 提示词定时同步配置。
type PromptSyncSetting struct {
	Enabled *bool  `json:"enabled"`
	Cron    string `json:"cron"`
}

type PrivateAuthSetting struct {
	LinuxDo PrivateLinuxDoAuthSetting `json:"linuxDo"`
}

type PrivateLinuxDoAuthSetting struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

// Setting 系统配置。
type Setting struct {
	Key       SettingKey      `json:"key" gorm:"primaryKey"`
	Value     json.RawMessage `json:"value" gorm:"serializer:json"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

// Settings 系统公开和私有配置。
type Settings struct {
	Public  PublicSetting  `json:"public"`
	Private PrivateSetting `json:"private"`
}
