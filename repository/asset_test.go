package repository

import (
	"reflect"
	"testing"

	"github.com/IGuanggg/lumaforge/model"
)

func TestAssetRepositoryListFilterAndTags(t *testing.T) {
	useTempRepositoryDB(t)

	assets := []model.Asset{
		{ID: "asset-1", Title: "Portrait", Type: model.AssetTypeImage, Tags: []string{"canvas", "face"}, Description: "bright", UpdatedAt: "2026-06-14T02:00:00Z"},
		{ID: "asset-2", Title: "Prompt note", Type: model.AssetTypeText, Tags: []string{"note"}, Content: "portrait text", UpdatedAt: "2026-06-14T01:00:00Z"},
		{ID: "asset-3", Title: "Landscape", Type: model.AssetTypeImage, Tags: []string{"canvas", "wide"}, Description: "mountain", UpdatedAt: "2026-06-14T03:00:00Z"},
	}
	for _, asset := range assets {
		if _, err := SaveAsset(asset); err != nil {
			t.Fatalf("SaveAsset(%s) failed: %v", asset.ID, err)
		}
	}

	items, total, err := ListAssets(model.Query{Keyword: "portrait", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListAssets keyword failed: %v", err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("keyword list total/items = %d/%d, want 2/2: %#v", total, len(items), items)
	}

	items, total, err = ListAssets(model.Query{Type: string(model.AssetTypeImage), Tags: []string{"wide"}, Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListAssets type+tag failed: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != "asset-3" {
		t.Fatalf("type+tag list = total %d items %#v, want asset-3", total, items)
	}

	tags, err := ListAssetTags(model.Query{Type: string(model.AssetTypeImage)})
	if err != nil {
		t.Fatalf("ListAssetTags failed: %v", err)
	}
	expectedTags := []string{"canvas", "face", "wide"}
	if !reflect.DeepEqual(tags, expectedTags) {
		t.Fatalf("image tags = %#v, want %#v", tags, expectedTags)
	}
}

func TestSaveAssetPreservesCreatedAtOnUpdate(t *testing.T) {
	useTempRepositoryDB(t)

	if _, err := SaveAsset(model.Asset{ID: "asset-created", Title: "Old", CreatedAt: "created", UpdatedAt: "old"}); err != nil {
		t.Fatalf("initial SaveAsset failed: %v", err)
	}
	updated, err := SaveAsset(model.Asset{ID: "asset-created", Title: "New", UpdatedAt: "new"})
	if err != nil {
		t.Fatalf("update SaveAsset failed: %v", err)
	}

	if updated.CreatedAt != "created" {
		t.Fatalf("CreatedAt = %q, want preserved created", updated.CreatedAt)
	}
	if err := DeleteAsset("asset-created"); err != nil {
		t.Fatalf("DeleteAsset failed: %v", err)
	}
	items, total, err := ListAssets(model.Query{Keyword: "New", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListAssets after delete failed: %v", err)
	}
	if total != 0 || len(items) != 0 {
		t.Fatalf("deleted asset still listed: total=%d items=%#v", total, items)
	}
}

func TestAssetTagsFromItemsDeduplicatesInFirstSeenOrder(t *testing.T) {
	items := []model.Asset{
		{Tags: []string{"portrait", "canvas", ""}},
		{Tags: []string{"canvas", "upscale", "portrait"}},
	}

	tags := assetTagsFromItems(items)

	expected := []string{"portrait", "canvas", "upscale"}
	if !reflect.DeepEqual(tags, expected) {
		t.Fatalf("expected tags %#v, got %#v", expected, tags)
	}
}

func TestIsActiveAssetOption(t *testing.T) {
	cases := []struct {
		value string
		want  bool
	}{
		{"", false},
		{"all", false},
		{"全部", false},
		{"image", true},
		{"video", true},
	}

	for _, tc := range cases {
		if got := isActiveAssetOption(tc.value); got != tc.want {
			t.Fatalf("isActiveAssetOption(%q) = %v, want %v", tc.value, got, tc.want)
		}
	}
}
