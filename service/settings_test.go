package service

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
)

func TestFetchAdminChannelModelsParsesOpenAIModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"z-model"},{"id":"a-model"},{"id":""}]}`))
	}))
	defer server.Close()

	models, err := fetchAdminChannelModels(model.ModelChannel{
		BaseURL: server.URL,
		APIKey:  "test-key",
	})
	if err != nil {
		t.Fatalf("fetchAdminChannelModels returned error: %v", err)
	}
	if want := []string{"a-model", "z-model"}; !reflect.DeepEqual(models, want) {
		t.Fatalf("models = %#v, want %#v", models, want)
	}
}

func TestFetchAdminChannelModelsReportsArkPlanModelsUnsupported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/plan/v3/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	_, err := fetchAdminChannelModels(model.ModelChannel{
		BaseURL: server.URL + "/api/plan/v3/contents/generations/tasks",
		APIKey:  "test-key",
	})
	if err == nil {
		t.Fatal("expected unsupported /models error")
	}
	if !strings.Contains(err.Error(), "Agent Plan 未提供 OpenAI /models") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestBuildModelChannelURLNormalizesArkPlanTaskPath(t *testing.T) {
	got := BuildModelChannelURL(model.ModelChannel{BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks?debug=1"}, "/models")
	want := "https://ark.cn-beijing.volces.com/api/plan/v3/models"
	if got != want {
		t.Fatalf("BuildModelChannelURL = %q, want %q", got, want)
	}
}

func TestNormalizeSettingsPublishesProviderModelsAndRepairsDefaults(t *testing.T) {
	withTempLumaDataDir(t)
	if err := writeJSONFile(lumaPath("api_providers.json"), []LumaAPIProvider{{
		ID:          "custom",
		Name:        "Custom",
		BaseURL:     "https://example.com/v1",
		Protocol:    "openai",
		Enabled:     true,
		Primary:     true,
		ImageModels: []string{"custom-image", "gpt-image-2-vip"},
		ChatModels:  []string{"custom-chat"},
		VideoModels: []string{"custom-video"},
	}}); err != nil {
		t.Fatalf("write providers: %v", err)
	}

	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{
			ModelChannel: model.PublicModelChannelSetting{
				AvailableModels:   []string{"grok-imagine-video", "disabled-model"},
				DefaultModel:      "grok-imagine-video",
				DefaultTextModel:  "missing-text",
				DefaultImageModel: "missing-image",
				DefaultVideoModel: "missing-video",
			},
		},
		Private: model.PrivateSetting{
			Channels: []model.ModelChannel{
				{Enabled: true, Models: []string{"private-chat", "private-image"}},
				{Enabled: false, Models: []string{"disabled-model"}},
			},
		},
	})

	channel := settings.Public.ModelChannel
	wantModels := []string{"custom-image", "gpt-image-2-vip", "custom-chat", "custom-video"}
	if !reflect.DeepEqual(channel.AvailableModels, wantModels) {
		t.Fatalf("available models = %#v, want %#v", channel.AvailableModels, wantModels)
	}
	if len(channel.ProviderModels) != 4 {
		t.Fatalf("provider models = %d, want 4", len(channel.ProviderModels))
	}
	if channel.ProviderModels[0].Value != "custom::custom-image" || channel.ProviderModels[0].Label != "Custom / custom-image" {
		t.Fatalf("first provider model = %#v, want provider-aware image option", channel.ProviderModels[0])
	}
	if channel.DefaultModel != "custom::custom-chat" {
		t.Fatalf("default model = %q, want provider text model", channel.DefaultModel)
	}
	if channel.DefaultTextModel != "custom::custom-chat" {
		t.Fatalf("default text model = %q, want provider text model", channel.DefaultTextModel)
	}
	if channel.DefaultImageModel != "custom::gpt-image-2-vip" {
		t.Fatalf("default image model = %q, want custom::gpt-image-2-vip", channel.DefaultImageModel)
	}
	if channel.DefaultVideoModel != "custom::custom-video" {
		t.Fatalf("default video model = %q, want provider video model", channel.DefaultVideoModel)
	}
}

func TestLumaModelChannelSelectsProviderRef(t *testing.T) {
	withTempLumaDataDir(t)
	if err := writeJSONFile(lumaPath("api_providers.json"), []LumaAPIProvider{
		{
			ID:          "primary",
			Name:        "Primary",
			BaseURL:     "https://primary.example.com/v1",
			Protocol:    "openai",
			Enabled:     true,
			Primary:     true,
			ImageModels: []string{"shared-image"},
		},
		{
			ID:          "backup",
			Name:        "Backup",
			BaseURL:     "https://backup.example.com/v1",
			Protocol:    "openai",
			Enabled:     true,
			Primary:     false,
			ImageModels: []string{"shared-image"},
		},
	}); err != nil {
		t.Fatalf("write providers: %v", err)
	}

	channel, ok := LumaModelChannel("backup::shared-image")
	if !ok {
		t.Fatal("expected provider-aware model channel")
	}
	if channel.BaseURL != "https://backup.example.com/v1" {
		t.Fatalf("base url = %q, want backup provider", channel.BaseURL)
	}

	channel, ok = LumaModelChannel("shared-image")
	if !ok {
		t.Fatal("expected legacy raw model channel")
	}
	if channel.BaseURL != "https://primary.example.com/v1" {
		t.Fatalf("legacy base url = %q, want first matching primary provider", channel.BaseURL)
	}
}

func TestNormalizeOpenAIProviderMergesBuiltInModels(t *testing.T) {
	providers := normalizeLumaProviders([]LumaAPIProvider{{
		ID:          "openai",
		Name:        "OpenAI Compatible",
		BaseURL:     "https://api.openai.com/v1",
		Protocol:    "openai",
		Enabled:     true,
		Primary:     true,
		ImageModels: []string{"gpt-image-2-vip", "gpt-image-2"},
		ChatModels:  []string{"gpt-5.5"},
	}})
	if len(providers) != 1 {
		t.Fatalf("providers = %d, want 1", len(providers))
	}
	if !reflect.DeepEqual(providers[0].ImageModels, []string{"gpt-image-2-vip", "gpt-image-2", "nano-banana"}) {
		t.Fatalf("image models = %#v, want built-in image defaults merged", providers[0].ImageModels)
	}
	if !reflect.DeepEqual(providers[0].VideoModels, []string{"sora-2"}) {
		t.Fatalf("video models = %#v, want built-in video defaults merged", providers[0].VideoModels)
	}
}

func TestNormalizeSettingsFallsBackToPrivateChannelsWhenProvidersHaveNoModels(t *testing.T) {
	withTempLumaDataDir(t)
	if err := writeJSONFile(lumaPath("api_providers.json"), []LumaAPIProvider{{
		ID:       "empty",
		Name:     "Empty",
		BaseURL:  "https://example.com/v1",
		Protocol: "openai",
		Enabled:  true,
		Primary:  true,
	}}); err != nil {
		t.Fatalf("write providers: %v", err)
	}

	settings := normalizeSettings(model.Settings{
		Private: model.PrivateSetting{
			Channels: []model.ModelChannel{
				{Enabled: true, Models: []string{"gpt-5.5", "doubao-seedream-5.0-lite", "doubao-seedance-2.0-fast", "gpt-5.5"}},
				{Enabled: false, Models: []string{"disabled-model"}},
			},
		},
	})

	channel := settings.Public.ModelChannel
	wantModels := []string{"gpt-5.5", "doubao-seedream-5.0-lite", "doubao-seedance-2.0-fast"}
	if !reflect.DeepEqual(channel.AvailableModels, wantModels) {
		t.Fatalf("available models = %#v, want %#v", channel.AvailableModels, wantModels)
	}
	if channel.DefaultModel != "gpt-5.5" || channel.DefaultTextModel != "gpt-5.5" {
		t.Fatalf("default text models = %q/%q, want gpt-5.5", channel.DefaultModel, channel.DefaultTextModel)
	}
	if channel.DefaultImageModel != "doubao-seedream-5.0-lite" {
		t.Fatalf("default image model = %q, want seedream", channel.DefaultImageModel)
	}
	if channel.DefaultVideoModel != "doubao-seedance-2.0-fast" {
		t.Fatalf("default video model = %q, want seedance", channel.DefaultVideoModel)
	}
}

func withTempLumaDataDir(t *testing.T) {
	t.Helper()
	oldDataDir := config.Cfg.LumaForgeDataDir
	config.Cfg.LumaForgeDataDir = t.TempDir()
	t.Cleanup(func() {
		config.Cfg.LumaForgeDataDir = oldDataDir
	})
}
