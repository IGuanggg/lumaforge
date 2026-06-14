package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLumaProviderProbeAsyncHonorsProtocolOverride(t *testing.T) {
	body := []byte(`{
		"provider_id": "custom",
		"base_url": "https://example.com/apimart-looking-path",
		"protocol_override": "force-openai"
	}`)
	request := httptest.NewRequest(http.MethodPost, "/api/providers/probe-async", bytes.NewReader(body))
	recorder := httptest.NewRecorder()

	LumaProviderProbeAsync(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if payload["protocol"] != "openai" || payload["confidence"] != "manual" || payload["reason"] != "user_override" {
		t.Fatalf("expected manual OpenAI override response, got %#v", payload)
	}
}
