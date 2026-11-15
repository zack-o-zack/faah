package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	lsppkg "faah/internal/lsp"
	"faah/internal/workspace"
)

// Only paths a server actually named may be opened outside the indexed tree.
func TestExternalAllowlist(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	ix := workspace.NewIndex(root)
	ix.Build()
	m := lsppkg.New(lsppkg.Options{Root: root, Enabled: false, Version: version})
	s := New(Options{Workspace: ix, LSP: m, Assets: assets, DevRoot: devRoot, Version: version})

	if _, _, ok := s.resolvePath("/etc/passwd"); ok {
		t.Error("resolvePath allowed an arbitrary absolute path")
	}
	m.Allow("/usr/lib/go/src/strings/builder.go")
	abs, _, ok := s.resolvePath("/usr/lib/go/src/strings/builder.go")
	if !ok || abs != "/usr/lib/go/src/strings/builder.go" {
		t.Errorf("resolvePath refused an allowlisted path: %q %v", abs, ok)
	}
	if _, _, ok := s.resolvePath("/usr/lib/go/src/strings/other.go"); ok {
		t.Error("allowlisting one file allowed a sibling")
	}
	if _, _, ok := s.resolvePath("../../../etc/shadow"); ok {
		t.Error("relative traversal still escapes the root")
	}
}

func TestLSPServersEndpoint(t *testing.T) {
	s, root := newTestServer(t)
	s.lsp = lsppkg.New(lsppkg.Options{Root: root, Enabled: true, Version: version})

	// Ensure we have Go and Python files
	_ = os.WriteFile(filepath.Join(root, "app.py"), []byte("print('hello')\n"), 0o644)
	s.ix.Build()

	req := httptest.NewRequest(http.MethodGet, "/api/lsp/servers", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var res struct {
		Enabled    bool             `json:"enabled"`
		AnyRunning bool             `json:"anyRunning"`
		Servers    []map[string]any `json:"servers"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("json parse error: %v", err)
	}

	foundGo := false
	foundPy := false
	for _, srv := range res.Servers {
		name, _ := srv["name"].(string)
		if name == "gopls" {
			foundGo = true
		}
		if name == "pyright" || name == "pylsp" || name == "ruff" {
			foundPy = true
		}
	}
	if !foundGo {
		t.Errorf("expected gopls in relevant servers for Go files")
	}
	if !foundPy {
		t.Errorf("expected python language server in relevant servers for Python files")
	}
}

func TestLSPStopAndStart(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping real LSP stop/start in short mode")
	}
	s, root := newTestServer(t)
	s.lsp = lsppkg.New(lsppkg.Options{Root: root, Enabled: true, Version: version})
	_ = os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o644)

	// Stop gopls
	stopReq := httptest.NewRequest(http.MethodPost, "/api/lsp/stop?server=gopls", nil)
	stopReq.Host = "127.0.0.1:8080"
	stopReq.Header.Set("Origin", "http://127.0.0.1:8080")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, stopReq)

	if rec.Code != http.StatusOK {
		t.Fatalf("stop returned code %d", rec.Code)
	}

	state, _ := s.lsp.State("main.go")
	if state != "off" {
		t.Errorf("expected lspOff after stop, got %v", state)
	}

	// Verify Stop All
	stopAllReq := httptest.NewRequest(http.MethodPost, "/api/lsp/stop", nil)
	stopAllReq.Host = "127.0.0.1:8080"
	stopAllReq.Header.Set("Origin", "http://127.0.0.1:8080")
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, stopAllReq)

	if rec.Code != http.StatusOK {
		t.Fatalf("stop all returned code %d", rec.Code)
	}

	if s.lsp.AnyRunning() {
		t.Errorf("expected no servers running after stop all")
	}
}
