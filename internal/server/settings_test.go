package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"faah/internal/settings"
)

func TestSettingsAPIEndpoints(t *testing.T) {
	isolateSettings(t)
	root := t.TempDir()
	srv := fakeAgentServer(t, root, nil)

	// 1. GET /api/settings
	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/settings failed: code %d, body: %s", rec.Code, rec.Body.String())
	}
	var getResp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("invalid GET json response: %v", err)
	}
	if _, ok := getResp["schema"]; !ok {
		t.Errorf("missing schema in GET /api/settings response")
	}

	// 2. POST /api/settings with key/value updates
	payload := map[string]any{
		"editor.tabSize":              2,
		"diffEditor.renderSideBySide": false,
	}
	b, _ := json.Marshal(payload)
	postReq := httptest.NewRequest(http.MethodPost, "/api/settings", bytes.NewReader(b))
	postReq.Host = "127.0.0.1:7777"
	postReq.Header.Set("Origin", "http://127.0.0.1:7777")
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	srv.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusOK {
		t.Fatalf("POST /api/settings failed: code %d, body: %s", postRec.Code, postRec.Body.String())
	}

	// 3. Verify changes persisted
	m := settings.ReadMergedMap()
	if m["editor.tabSize"] != float64(2) && m["editor.tabSize"] != 2 {
		t.Errorf("expected editor.tabSize 2, got %v", m["editor.tabSize"])
	}
	if m["diffEditor.renderSideBySide"] != false {
		t.Errorf("expected diffEditor.renderSideBySide false, got %v", m["diffEditor.renderSideBySide"])
	}

	// 4. POST /api/settings with raw JSON
	rawPayload := map[string]any{
		"raw": "{\n  \"editor.fontSize\": 15,\n  \"workbench.colorTheme\": \"nord\"\n}\n",
	}
	rb, _ := json.Marshal(rawPayload)
	rawReq := httptest.NewRequest(http.MethodPost, "/api/settings", bytes.NewReader(rb))
	rawReq.Host = "127.0.0.1:7777"
	rawReq.Header.Set("Origin", "http://127.0.0.1:7777")
	rawReq.Header.Set("Content-Type", "application/json")
	rawRec := httptest.NewRecorder()
	srv.ServeHTTP(rawRec, rawReq)
	if rawRec.Code != http.StatusOK {
		t.Fatalf("POST /api/settings raw failed: code %d, body: %s", rawRec.Code, rawRec.Body.String())
	}

	m2 := settings.ReadMergedMap()
	if m2["editor.fontSize"] != float64(15) && m2["editor.fontSize"] != 15 {
		t.Errorf("expected editor.fontSize 15 from raw, got %v", m2["editor.fontSize"])
	}
	if m2["workbench.colorTheme"] != "nord" {
		t.Errorf("expected workbench.colorTheme nord from raw, got %v", m2["workbench.colorTheme"])
	}
}
