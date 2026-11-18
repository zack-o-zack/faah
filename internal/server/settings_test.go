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
		"raw": "{\n  \"editor.fontSize\": 15,\n  \"workbench.colorTheme\": \"dark\"\n}\n",
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
	if m2["workbench.colorTheme"] != "dark" {
		t.Errorf("expected workbench.colorTheme dark from raw, got %v", m2["workbench.colorTheme"])
	}
}

func schemaOptions(t *testing.T, srv *Server, key string) []string {
	t.Helper()
	code, body := get(t, srv, "/api/settings")
	if code != http.StatusOK {
		t.Fatalf("GET /api/settings: %d", code)
	}
	items, ok := body["schema"].([]any)
	if !ok {
		t.Fatal("settings response has no schema")
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok || item["key"] != key {
			continue
		}
		options, _ := item["options"].([]any)
		out := make([]string, 0, len(options))
		for _, option := range options {
			out = append(out, option.(string))
		}
		return out
	}
	t.Fatalf("schema has no %s", key)
	return nil
}

func TestCodeThemeSettingsSchema(t *testing.T) {
	isolateSettings(t)
	srv := fakeAgentServer(t, t.TempDir(), nil)

	light := schemaOptions(t, srv, "workbench.codeTheme.light")
	dark := schemaOptions(t, srv, "workbench.codeTheme.dark")
	contains := func(options []string, id string) bool {
		for _, option := range options {
			if option == id {
				return true
			}
		}
		return false
	}
	if len(light) == 0 || light[0] != "" || len(dark) == 0 || dark[0] != "" {
		t.Fatalf("empty option must lead both lists: %v / %v", light, dark)
	}
	for _, id := range []string{"classic-light", "gruvbox-light", "solarized-light", "catppuccin-latte"} {
		if !contains(light, id) {
			t.Fatalf("light list missing %s: %v", id, light)
		}
	}
	for _, id := range []string{"dracula", "midnight", "classic-dark", "nord"} {
		if !contains(dark, id) {
			t.Fatalf("dark list missing %s: %v", id, dark)
		}
	}
	if contains(light, "dracula") || contains(dark, "classic-light") {
		t.Fatal("code theme lists must filter by color-scheme")
	}
	app := schemaOptions(t, srv, "workbench.colorTheme")
	if !contains(app, "light") || !contains(app, "dark") {
		t.Fatalf("app theme options %v", app)
	}
	if contains(app, "dracula") || contains(app, "classic-dark") {
		t.Fatalf("app theme options must not include code themes: %v", app)
	}
}

func TestCodeThemeSettingsValidation(t *testing.T) {
	isolateSettings(t)
	srv := fakeAgentServer(t, t.TempDir(), nil)

	for _, key := range codeThemeKeys {
		if code, _ := agentPostJSON(t, srv, "/api/settings", map[string]any{key: "missing-theme"}); code != http.StatusBadRequest {
			t.Fatalf("%s accepted an unknown id: %d", key, code)
		}
		inner, err := json.Marshal(map[string]any{key: "missing-theme"})
		if err != nil {
			t.Fatal(err)
		}
		if code, _ := agentPostJSON(t, srv, "/api/settings", map[string]any{"raw": string(inner)}); code != http.StatusBadRequest {
			t.Fatalf("%s accepted an unknown id in raw JSON: %d", key, code)
		}
	}

	if code, _ := agentPostJSON(t, srv, "/api/settings", map[string]any{
		"workbench.codeTheme.light": "solarized-light",
		"workbench.codeTheme.dark":  "dracula",
	}); code != http.StatusOK {
		t.Fatalf("known code themes rejected: %d", code)
	}
	merged := settings.ReadMergedMap()
	if merged["workbench.codeTheme.light"] != "solarized-light" || merged["workbench.codeTheme.dark"] != "dracula" {
		t.Fatalf("code themes not stored: %v / %v", merged["workbench.codeTheme.light"], merged["workbench.codeTheme.dark"])
	}

	raw, err := json.Marshal(map[string]any{"workbench.codeTheme.dark": "classic-dark"})
	if err != nil {
		t.Fatal(err)
	}
	if code, _ := agentPostJSON(t, srv, "/api/settings", map[string]any{"raw": string(raw)}); code != http.StatusOK {
		t.Fatalf("known code theme rejected in raw JSON: %d", code)
	}
	if got := settings.ReadMergedMap()["workbench.codeTheme.dark"]; got != "classic-dark" {
		t.Fatalf("raw code theme not stored: %v", got)
	}
}
