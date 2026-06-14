package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
)

func TestUploadAndServeReferenceMedia(t *testing.T) {
	previous := config.Cfg
	root := t.TempDir()
	config.Cfg = config.Config{
		PublicBaseURL: "http://127.0.0.1:18082",
		StorageDriver: "sqlite",
		DatabaseDSN:   filepath.Join(root, "app.db"),
	}
	t.Cleanup(func() { config.Cfg = previous })

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "reference.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write([]byte("png-bytes")); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/media/references", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	UploadReferenceMedia(recorder, request)

	payload := decodeEnvelopePayload(t, recorder)
	result, ok := payload["data"].(map[string]any)
	if !ok {
		t.Fatalf("upload payload = %#v", payload)
	}
	id := strings.TrimSpace(result["id"].(string))
	if id == "" || !strings.HasSuffix(id, ".png") {
		t.Fatalf("uploaded id = %q, want png id", id)
	}
	if result["mimeType"] != "image/png" {
		t.Fatalf("mimeType = %#v, want image/png", result["mimeType"])
	}

	serveRequest := httptest.NewRequest(http.MethodGet, "/api/media/references/"+id, nil)
	serveRecorder := httptest.NewRecorder()
	ReferenceMedia(serveRecorder, serveRequest, id)
	if serveRecorder.Code != http.StatusOK {
		t.Fatalf("serve status = %d, body = %s", serveRecorder.Code, serveRecorder.Body.String())
	}
	if contentType := serveRecorder.Header().Get("Content-Type"); !strings.Contains(contentType, "image/png") {
		t.Fatalf("content type = %q, want image/png", contentType)
	}
	if serveRecorder.Body.String() != "png-bytes" {
		t.Fatalf("served body = %q, want original bytes", serveRecorder.Body.String())
	}

	blockedRecorder := httptest.NewRecorder()
	ReferenceMedia(blockedRecorder, httptest.NewRequest(http.MethodGet, "/api/media/references/../secret", nil), "../secret")
	if blockedRecorder.Code != http.StatusNotFound {
		t.Fatalf("blocked traversal status = %d, want 404", blockedRecorder.Code)
	}
}

func TestUploadReferenceMediaRequiresPublicBaseURL(t *testing.T) {
	previous := config.Cfg
	config.Cfg = config.Config{PublicBaseURL: ""}
	t.Cleanup(func() { config.Cfg = previous })

	recorder := httptest.NewRecorder()
	UploadReferenceMedia(recorder, httptest.NewRequest(http.MethodPost, "/api/media/references", nil))

	payload := decodeEnvelopePayload(t, recorder)
	if payload["code"] == float64(0) {
		t.Fatalf("payload = %#v, want failure envelope", payload)
	}
}

func TestNormalizeReferenceMediaTypeSupportsAudio(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		ext         string
		wantMime    string
		wantExt     string
	}{
		{name: "jpeg mime", contentType: "image/jpeg; charset=binary", ext: ".bin", wantMime: "image/jpeg", wantExt: ".jpg"},
		{name: "webp ext fallback", contentType: "application/octet-stream", ext: ".webp", wantMime: "image/webp", wantExt: ".webp"},
		{name: "mov mime", contentType: "video/quicktime", ext: ".bin", wantMime: "video/quicktime", wantExt: ".mov"},
		{name: "mp3 mime", contentType: "audio/mpeg", ext: ".bin", wantMime: "audio/mpeg", wantExt: ".mp3"},
		{name: "wav ext fallback", contentType: "application/octet-stream", ext: ".wav", wantMime: "audio/wav", wantExt: ".wav"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mimeType, ext, ok := normalizeReferenceMediaType(tt.contentType, tt.ext)
			if !ok {
				t.Fatal("expected media type to be accepted")
			}
			if mimeType != tt.wantMime || ext != tt.wantExt {
				t.Fatalf("got (%q, %q), want (%q, %q)", mimeType, ext, tt.wantMime, tt.wantExt)
			}
		})
	}
}

func TestNormalizeReferenceMediaTypeRejectsUnknown(t *testing.T) {
	mimeType, ext, ok := normalizeReferenceMediaType("application/pdf", ".pdf")
	if ok || mimeType != "" || ext != "" {
		t.Fatalf("unknown media = (%q, %q, %v), want rejected", mimeType, ext, ok)
	}
}

func TestReferenceMediaMimeAndExtensionMapping(t *testing.T) {
	mimeToExt := map[string]string{
		"image/jpg":     ".jpg",
		"image/heic":    ".heic",
		"image/heif":    ".heif",
		"video/mov":     ".mov",
		"audio/x-wav":   ".wav",
		"audio/wave":    ".wav",
		"application/x": "",
	}
	for mimeType, want := range mimeToExt {
		if got := referenceMediaExtByMimeType(mimeType); got != want {
			t.Fatalf("referenceMediaExtByMimeType(%q) = %q, want %q", mimeType, got, want)
		}
	}

	extToMime := map[string]string{
		".jpeg": "image/jpeg",
		".gif":  "image/gif",
		".heif": "image/heif",
		".mp4":  "video/mp4",
		".mov":  "video/quicktime",
		".mp3":  "audio/mpeg",
		".bin":  "",
	}
	for ext, want := range extToMime {
		if got := mimeTypeByReferenceMediaExt(ext); got != want {
			t.Fatalf("mimeTypeByReferenceMediaExt(%q) = %q, want %q", ext, got, want)
		}
	}
}

func TestReferenceMediaTypeMaxBytes(t *testing.T) {
	if got := referenceMediaTypeMaxBytes("audio/mpeg"); got != referenceAudioMaxBytes {
		t.Fatalf("audio max bytes = %d, want %d", got, referenceAudioMaxBytes)
	}
	if got := referenceMediaTypeMaxBytes("video/mp4"); got != referenceVideoMaxBytes {
		t.Fatalf("video max bytes = %d, want %d", got, referenceVideoMaxBytes)
	}
	if got := referenceMediaTypeMaxBytes("image/png"); got != referenceImageMaxBytes {
		t.Fatalf("image max bytes = %d, want %d", got, referenceImageMaxBytes)
	}
	if got := referenceMediaTypeMaxBytes("application/octet-stream"); got != referenceMediaMaxBytes {
		t.Fatalf("fallback max bytes = %d, want %d", got, referenceMediaMaxBytes)
	}
}

func TestReferenceMediaSizeMessages(t *testing.T) {
	for _, mimeType := range []string{"image/png", "video/mp4", "audio/mpeg", "application/octet-stream"} {
		if message := referenceMediaSizeMessage(mimeType); strings.TrimSpace(message) == "" {
			t.Fatalf("empty size message for %q", mimeType)
		}
	}
}

func TestReferenceMediaDirUsesAbsoluteSQLiteDataDir(t *testing.T) {
	previous := config.Cfg
	t.Cleanup(func() { config.Cfg = previous })
	root := t.TempDir()
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: filepath.Join(root, "infinite-canvas.db")}

	if got := referenceMediaDir(); got != filepath.Join(root, "reference-media") {
		t.Fatalf("referenceMediaDir = %q", got)
	}
}

func TestReferenceDataDirFallback(t *testing.T) {
	previous := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
	t.Cleanup(func() { config.Cfg = previous })

	got := referenceDataDir()
	if got == "" {
		t.Fatal("referenceDataDir returned empty path")
	}
	if filepath.IsAbs(got) && !strings.HasSuffix(got, string(filepath.Separator)+"data") {
		if _, err := os.Stat(got); err != nil {
			t.Fatalf("absolute fallback path %q should exist or be data-like: %v", got, err)
		}
	}
}

func decodeEnvelopePayload(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, recorder.Body.String())
	}
	return payload
}
