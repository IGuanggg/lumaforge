package handler

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestFailUserKeepsResponseCompatibilityAndAction(t *testing.T) {
	recorder := httptest.NewRecorder()
	FailUser(recorder, ErrLoginRequired)

	payload := map[string]any{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["code"] != float64(1) || payload["msg"] != ErrLoginRequired.Message {
		t.Fatalf("unexpected compatibility payload: %#v", payload)
	}
	if payload["errorCode"] != ErrLoginRequired.Code || payload["action"] != ErrLoginRequired.Action {
		t.Fatalf("missing actionable error fields: %#v", payload)
	}
}
