package repository

import (
	"testing"

	"github.com/IGuanggg/lumaforge/model"
)

func TestSaveSettingsRoundTripsPublicAndPrivateRows(t *testing.T) {
	useTempRepositoryDB(t)

	allowRegister := true
	promptSyncEnabled := false
	settings := model.Settings{
		Public: model.PublicSetting{
			ModelChannel: model.PublicModelChannelSetting{
				AvailableModels:   []string{"gpt-image-2", "gpt-5.5"},
				DefaultImageModel: "gpt-image-2",
				DefaultTextModel:  "gpt-5.5",
			},
			Auth: model.PublicAuthSetting{AllowRegister: &allowRegister},
		},
		Private: model.PrivateSetting{
			Channels: []model.ModelChannel{
				{Name: "Local", BaseURL: "https://api.example.com/v1", Models: []string{"gpt-image-2"}, Enabled: true},
			},
			PromptSync: model.PromptSyncSetting{Enabled: &promptSyncEnabled, Cron: "0 0 * * *"},
		},
	}

	if _, err := SaveSettings(settings, "2026-06-14T00:00:00Z"); err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}
	got, err := GetSettings()
	if err != nil {
		t.Fatalf("GetSettings failed: %v", err)
	}

	if got.Public.ModelChannel.DefaultImageModel != "gpt-image-2" {
		t.Fatalf("expected default image model to round trip, got %q", got.Public.ModelChannel.DefaultImageModel)
	}
	if got.Public.Auth.AllowRegister == nil || *got.Public.Auth.AllowRegister != true {
		t.Fatalf("expected public auth flag to round trip, got %#v", got.Public.Auth.AllowRegister)
	}
	if len(got.Private.Channels) != 1 || got.Private.Channels[0].Name != "Local" {
		t.Fatalf("expected private channel to round trip, got %#v", got.Private.Channels)
	}
	if got.Private.PromptSync.Enabled == nil || *got.Private.PromptSync.Enabled != false {
		t.Fatalf("expected private prompt sync flag to round trip, got %#v", got.Private.PromptSync.Enabled)
	}
}

func TestSaveSettingsUpsertsExistingRows(t *testing.T) {
	useTempRepositoryDB(t)

	first := model.Settings{
		Public: model.PublicSetting{
			ModelChannel: model.PublicModelChannelSetting{DefaultTextModel: "gpt-5.5"},
		},
	}
	second := model.Settings{
		Public: model.PublicSetting{
			ModelChannel: model.PublicModelChannelSetting{DefaultTextModel: "gpt-5.5-mini"},
		},
	}

	if _, err := SaveSettings(first, "2026-06-14T00:00:00Z"); err != nil {
		t.Fatalf("first SaveSettings failed: %v", err)
	}
	if _, err := SaveSettings(second, "2026-06-14T00:01:00Z"); err != nil {
		t.Fatalf("second SaveSettings failed: %v", err)
	}
	got, err := GetSettings()
	if err != nil {
		t.Fatalf("GetSettings failed: %v", err)
	}

	if got.Public.ModelChannel.DefaultTextModel != "gpt-5.5-mini" {
		t.Fatalf("expected updated text model, got %q", got.Public.ModelChannel.DefaultTextModel)
	}
}
