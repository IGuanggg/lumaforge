package repository

import (
	"reflect"
	"testing"

	"github.com/IGuanggg/lumaforge/model"
)

func TestPromptCategoriesReturnCopy(t *testing.T) {
	categories := PromptCategories()
	if len(categories) == 0 {
		t.Fatal("expected built-in prompt categories")
	}

	originalName := categories[0].Name
	categories[0].Name = "mutated"

	fresh := PromptCategories()
	if fresh[0].Name != originalName {
		t.Fatalf("PromptCategories leaked mutable backing array, got %q want %q", fresh[0].Name, originalName)
	}
}

func TestPromptCategoryByCode(t *testing.T) {
	category, ok := PromptCategoryByCode("system")
	if !ok {
		t.Fatal("expected system category to exist")
	}
	if category.Category != "system" {
		t.Fatalf("category code = %q, want system", category.Category)
	}

	if _, ok := PromptCategoryByCode("missing-category"); ok {
		t.Fatal("unexpected match for missing category")
	}
}

func TestPromptRepositoryListFilterAndTags(t *testing.T) {
	useTempRepositoryDB(t)

	prompts := []model.Prompt{
		{ID: "prompt-1", Title: "Portrait", Prompt: "soft portrait light", Tags: []string{"canvas", "face"}, Category: "system", UpdatedAt: "2026-06-14T02:00:00Z"},
		{ID: "prompt-2", Title: "Landscape", Prompt: "wide mountain", Tags: []string{"canvas", "wide"}, Category: "awesome-gpt-image", UpdatedAt: "2026-06-14T03:00:00Z"},
		{ID: "prompt-3", Title: "Utility", Prompt: "portrait notes", Tags: []string{"note"}, Category: "system", UpdatedAt: "2026-06-14T01:00:00Z"},
	}
	for _, prompt := range prompts {
		if _, err := SavePrompt(prompt); err != nil {
			t.Fatalf("SavePrompt(%s) failed: %v", prompt.ID, err)
		}
	}

	items, total, err := ListPrompts(model.Query{Keyword: "portrait", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListPrompts keyword failed: %v", err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("keyword list total/items = %d/%d, want 2/2: %#v", total, len(items), items)
	}

	items, total, err = ListPrompts(model.Query{Category: "awesome-gpt-image", Tags: []string{"wide"}, Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListPrompts category+tag failed: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != "prompt-2" {
		t.Fatalf("category+tag list = total %d items %#v, want prompt-2", total, items)
	}
	if items[0].GithubURL == "" {
		t.Fatal("expected ListPrompts to enrich remote category GithubURL")
	}

	tags, err := ListPromptTags(model.Query{Category: "system"})
	if err != nil {
		t.Fatalf("ListPromptTags failed: %v", err)
	}
	expectedTags := []string{"canvas", "face", "note"}
	if !reflect.DeepEqual(tags, expectedTags) {
		t.Fatalf("system tags = %#v, want %#v", tags, expectedTags)
	}
}

func TestSavePromptPreservesCreatedAtAndClearsGithubURL(t *testing.T) {
	useTempRepositoryDB(t)

	if _, err := SavePrompt(model.Prompt{ID: "prompt-created", Title: "Old", CreatedAt: "created", UpdatedAt: "old", GithubURL: "https://example.com/old"}); err != nil {
		t.Fatalf("initial SavePrompt failed: %v", err)
	}
	updated, err := SavePrompt(model.Prompt{ID: "prompt-created", Title: "New", UpdatedAt: "new", GithubURL: "https://example.com/new"})
	if err != nil {
		t.Fatalf("update SavePrompt failed: %v", err)
	}

	if updated.CreatedAt != "created" {
		t.Fatalf("CreatedAt = %q, want preserved created", updated.CreatedAt)
	}
	if updated.GithubURL != "" {
		t.Fatalf("GithubURL = %q, want cleared", updated.GithubURL)
	}
}

func TestDeletePromptsAndReplacePromptCategory(t *testing.T) {
	useTempRepositoryDB(t)

	initial := []model.Prompt{
		{ID: "keep", Title: "Keep", Category: "system", UpdatedAt: "2026-06-14T01:00:00Z"},
		{ID: "remove-1", Title: "Remove 1", Category: "system", UpdatedAt: "2026-06-14T02:00:00Z"},
		{ID: "remove-2", Title: "Remove 2", Category: "system", UpdatedAt: "2026-06-14T03:00:00Z"},
		{ID: "remote-old", Title: "Old Remote", Category: "awesome-gpt-image", UpdatedAt: "2026-06-14T04:00:00Z"},
	}
	for _, prompt := range initial {
		if _, err := SavePrompt(prompt); err != nil {
			t.Fatalf("SavePrompt(%s) failed: %v", prompt.ID, err)
		}
	}

	if err := DeletePrompts([]string{"remove-1", "remove-2"}); err != nil {
		t.Fatalf("DeletePrompts failed: %v", err)
	}
	items, total, err := ListPrompts(model.Query{Category: "system", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListPrompts after DeletePrompts failed: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != "keep" {
		t.Fatalf("after batch delete = total %d items %#v, want keep only", total, items)
	}

	category := model.PromptCategory{Category: "awesome-gpt-image"}
	replacement := []model.Prompt{
		{ID: "remote-new", Title: "New Remote", Category: "wrong-category", GithubURL: "https://example.com/source", UpdatedAt: "2026-06-14T05:00:00Z"},
	}
	if err := ReplacePromptCategory(category, replacement); err != nil {
		t.Fatalf("ReplacePromptCategory failed: %v", err)
	}

	items, total, err = ListPrompts(model.Query{Category: "awesome-gpt-image", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListPrompts after ReplacePromptCategory failed: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != "remote-new" {
		t.Fatalf("after replace = total %d items %#v, want remote-new only", total, items)
	}
	if items[0].Category != "awesome-gpt-image" {
		t.Fatalf("replacement category = %q, want awesome-gpt-image", items[0].Category)
	}
	if items[0].GithubURL == "" {
		t.Fatal("expected ListPrompts to rehydrate GithubURL for replaced remote prompt")
	}

	if err := ReplacePromptCategory(category, nil); err != nil {
		t.Fatalf("ReplacePromptCategory empty failed: %v", err)
	}
	_, total, err = ListPrompts(model.Query{Category: "awesome-gpt-image", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListPrompts after empty ReplacePromptCategory failed: %v", err)
	}
	if total != 0 {
		t.Fatalf("empty replace total = %d, want 0", total)
	}
}

func TestPromptTagsFromItemsDeduplicatesInFirstSeenOrder(t *testing.T) {
	items := []model.Prompt{
		{Tags: []string{"portrait", "canvas", ""}},
		{Tags: []string{"canvas", "upscale", "portrait"}},
	}

	tags := promptTagsFromItems(items)

	expected := []string{"portrait", "canvas", "upscale"}
	if !reflect.DeepEqual(tags, expected) {
		t.Fatalf("expected tags %#v, got %#v", expected, tags)
	}
}

func TestIsActivePromptOption(t *testing.T) {
	cases := []struct {
		value string
		want  bool
	}{
		{"", false},
		{"all", false},
		{"全部", false},
		{"system", true},
		{"awesome-gpt-image", true},
	}

	for _, tc := range cases {
		if got := isActivePromptOption(tc.value); got != tc.want {
			t.Fatalf("isActivePromptOption(%q) = %v, want %v", tc.value, got, tc.want)
		}
	}
}
