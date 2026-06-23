package service

import (
	"reflect"
	"testing"

	"github.com/IGuanggg/lumaforge/model"
)

func TestPromptMarkdownHelpers(t *testing.T) {
	markdown := "# Intro\nbody\n## Section A\ntext\n## Section B\nmore"
	blocks := splitBeforeHeading(markdown, "## ")
	if len(blocks) != 3 {
		t.Fatalf("splitBeforeHeading returned %d blocks: %#v", len(blocks), blocks)
	}

	if got := firstMatch("title: hello", `title:\s+(\w+)`); got != "hello" {
		t.Fatalf("firstMatch = %q, want hello", got)
	}
	if got := firstMatch("no match", `title:\s+(\w+)`); got != "" {
		t.Fatalf("firstMatch missing = %q, want empty", got)
	}
}

func TestPromptTagHelpers(t *testing.T) {
	categoryTags := tagsFromCategory("Portrait and Product Cases")
	if want := []string{"portrait", "product"}; !reflect.DeepEqual(categoryTags, want) {
		t.Fatalf("tagsFromCategory = %#v, want %#v", categoryTags, want)
	}

	headingTags := tagsFromHeading("商业海报 / Product & UI!!!")
	if want := []string{"商业海报", "product", "ui"}; !reflect.DeepEqual(headingTags, want) {
		t.Fatalf("tagsFromHeading = %#v, want %#v", headingTags, want)
	}

	youMind := youMindTags("商业广告 - A clean product shot", "gpt-image-2")
	if want := []string{"gpt-image-2", "商业广告"}; !reflect.DeepEqual(youMind, want) {
		t.Fatalf("youMindTags = %#v, want %#v", youMind, want)
	}

	david := davidWuGptImage2Tags(davidWuGptImage2Prompt{
		CategoryCN: "商业",
		Category:   "Poster",
		Author:     "Alice",
		Source:     "Lab",
		NeedsRef:   true,
	})
	if want := []string{"商业", "poster", "alice", "lab", "需要参考图"}; !reflect.DeepEqual(david, want) {
		t.Fatalf("davidWuGptImage2Tags = %#v, want %#v", david, want)
	}
}

func TestPromptImagePreviewHelpers(t *testing.T) {
	baseURL := "https://raw.example.com/repo/main"
	block := `<img src="./images/a.png">
![B](../images/b.jpg)
![Duplicate](images/a.png)
![External](https://cdn.example.com/c.png)`

	images := extractMarkdownImages(baseURL, block)
	wantImages := []string{
		baseURL + "/images/a.png",
		baseURL + "/images/b.jpg",
		"https://cdn.example.com/c.png",
	}
	if !reflect.DeepEqual(images, wantImages) {
		t.Fatalf("extractMarkdownImages = %#v, want %#v", images, wantImages)
	}

	if got := absoluteImage(baseURL, "../assets/out.webp"); got != baseURL+"/assets/out.webp" {
		t.Fatalf("absoluteImage relative = %q", got)
	}
	if got := absoluteImage(baseURL, "https://cdn.example.com/x.png"); got != "https://cdn.example.com/x.png" {
		t.Fatalf("absoluteImage external = %q", got)
	}
	if got := markdownPreview([]string{"a.png", "", "b.png"}); got != "![](a.png)\n\n![](b.png)" {
		t.Fatalf("markdownPreview = %q", got)
	}
}

func TestCollectGptImage2CasesParsesPromptAndImages(t *testing.T) {
	markdown := `### Case 1: [Tweet](https://x.example.com/1)
Text before.
![Output](cases/portrait/output.jpg)
**Prompt:**
` + "```text\nA cinematic portrait\n```" + `

### Case 2: [Tweet](https://x.example.com/2)
<img src="../shared/ref.png">
**Prompt:**
` + "```prompt\nProduct poster\n```"

	cases := map[string]gptImage2Case{}
	collectGptImage2Cases(cases, markdown)

	if len(cases) != 2 {
		t.Fatalf("collected %d cases: %#v", len(cases), cases)
	}
	if got := cases["https://x.example.com/1"].Prompt; got != "A cinematic portrait" {
		t.Fatalf("case 1 prompt = %q", got)
	}
	if got := cases["https://x.example.com/2"].Images; !reflect.DeepEqual(got, []string{gptImage2RawBase + "/shared/ref.png"}) {
		t.Fatalf("case 2 images = %#v", got)
	}
}

func TestDavidWuGptImage2PreviewAndLeftPad(t *testing.T) {
	preview := davidWuGptImage2Preview(davidWuGptImage2Prompt{
		TitleEN: "English title",
		Note:    "Use a reference",
	}, "https://cdn.example.com/out.png")
	want := "English title\n\nUse a reference\n\n![](https://cdn.example.com/out.png)"
	if preview != want {
		t.Fatalf("preview = %q, want %q", preview, want)
	}

	padding := map[int]string{1: "001", 42: "042", 999: "999", 1000: "1000"}
	for value, want := range padding {
		if got := leftPad(value); got != want {
			t.Fatalf("leftPad(%d) = %q, want %q", value, got, want)
		}
	}
}

func TestPromptCategoryCodesSkipsEmptyValues(t *testing.T) {
	codes := promptCategoryCodes([]model.PromptCategory{
		{Category: "system"},
		{Category: ""},
		{Category: "remote"},
	})
	if want := []string{"system", "remote"}; !reflect.DeepEqual(codes, want) {
		t.Fatalf("promptCategoryCodes = %#v, want %#v", codes, want)
	}
}
