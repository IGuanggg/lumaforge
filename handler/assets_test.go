package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeLocalStaticFileMaybeServesOnlySafeChildren(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "image.png"), []byte("image-bytes"), 0644); err != nil {
		t.Fatalf("write image: %v", err)
	}
	if err := os.Mkdir(filepath.Join(root, "folder"), 0755); err != nil {
		t.Fatalf("mkdir folder: %v", err)
	}

	recorder := httptest.NewRecorder()
	if !serveLocalStaticFileMaybe(recorder, httptest.NewRequest(http.MethodGet, "/assets/image.png", nil), root, "image.png") {
		t.Fatal("expected safe child file to be served")
	}
	if recorder.Code != http.StatusOK || recorder.Body.String() != "image-bytes" {
		t.Fatalf("served response = status %d body %q", recorder.Code, recorder.Body.String())
	}

	blocked := []string{"../secret.txt", "/absolute/path.txt", "folder", ""}
	for _, requestPath := range blocked {
		recorder = httptest.NewRecorder()
		if serveLocalStaticFileMaybe(recorder, httptest.NewRequest(http.MethodGet, "/assets/"+requestPath, nil), root, requestPath) {
			t.Fatalf("request path %q should not be served", requestPath)
		}
	}
}

func TestAssetFileAndOutputFileUseConfiguredDirectories(t *testing.T) {
	assetRoot := t.TempDir()
	outputRoot := t.TempDir()
	t.Setenv("APP_ASSETS_DIR", assetRoot)
	t.Setenv("APP_OUTPUT_DIR", outputRoot)

	if err := os.WriteFile(filepath.Join(assetRoot, "asset.txt"), []byte("asset"), 0644); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	if err := os.WriteFile(filepath.Join(outputRoot, "output.txt"), []byte("output"), 0644); err != nil {
		t.Fatalf("write output: %v", err)
	}

	recorder := httptest.NewRecorder()
	AssetFile(recorder, httptest.NewRequest(http.MethodGet, "/assets/asset.txt", nil), "asset.txt")
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "asset") {
		t.Fatalf("asset response = status %d body %q", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	OutputFile(recorder, httptest.NewRequest(http.MethodGet, "/output/output.txt", nil), "output.txt")
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "output") {
		t.Fatalf("output response = status %d body %q", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	AssetFile(recorder, httptest.NewRequest(http.MethodGet, "/assets/../secret.txt", nil), "../secret.txt")
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("unsafe asset status = %d, want 404", recorder.Code)
	}
}
