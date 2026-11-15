package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"faah/internal/session"
	"faah/internal/workspace"
)

func TestSessionAPIEndpoints(t *testing.T) {
	// Isolate session path to a temp dir
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	root := t.TempDir()
	ix := workspace.NewIndex(root)
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version, BasePath: "/rev-999/"})

	// 1. GET /rev-999/api/session initially
	req := httptest.NewRequest(http.MethodGet, "/rev-999/api/session", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /rev-999/api/session failed: code %d, body %s", rec.Code, rec.Body.String())
	}
	var initResp session.Workspace
	if err := json.Unmarshal(rec.Body.Bytes(), &initResp); err != nil {
		t.Fatalf("unmarshal session failed: %v", err)
	}
	if len(initResp.Tabs) != 0 {
		t.Errorf("expected 0 tabs initially, got %d", len(initResp.Tabs))
	}

	// 2. POST /rev-999/api/session with tabs and openDirs
	active := 1
	payload := map[string]any{
		"tabs": []map[string]string{
			{"path": "foo.go"},
			{"path": "bar.go"},
		},
		"active":   active,
		"openDirs": []string{"pkg", "cmd"},
	}
	b, _ := json.Marshal(payload)
	postReq := httptest.NewRequest(http.MethodPost, "/rev-999/api/session", bytes.NewReader(b))
	postReq.Host = "127.0.0.1:7777"
	postReq.Header.Set("Origin", "http://127.0.0.1:7777")
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	s.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusOK {
		t.Fatalf("POST /rev-999/api/session failed: code %d, body %s", postRec.Code, postRec.Body.String())
	}

	// 3. Verify file was written to disk under rev-999.json
	sessFile := filepath.Join(tmpDir, "faah", "sessions", "rev-999.json")
	if _, err := os.Stat(sessFile); err != nil {
		t.Fatalf("session file not found on disk: %v", err)
	}

	// 4. Create a new server instance with same basePath and check that state is restored
	s2 := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version, BasePath: "/rev-999/"})
	sess2 := s2.session.Get()
	if len(sess2.Tabs) != 2 {
		t.Fatalf("expected 2 tabs in restored session, got %d", len(sess2.Tabs))
	}
	if sess2.Tabs[0].Path != "foo.go" || sess2.Tabs[1].Path != "bar.go" {
		t.Errorf("unexpected tab paths: %+v", sess2.Tabs)
	}
	if sess2.Active != 1 {
		t.Errorf("expected active tab 1, got %d", sess2.Active)
	}
	if len(sess2.OpenDirs) != 2 || sess2.OpenDirs[0] != "pkg" || sess2.OpenDirs[1] != "cmd" {
		t.Errorf("unexpected openDirs: %+v", sess2.OpenDirs)
	}
}
