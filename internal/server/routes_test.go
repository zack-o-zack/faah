package server

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/workspace"
)

func TestThemesStylesheetJoinsEveryThemeFile(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/themes.css", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/css") {
		t.Fatalf("content type %q", ct)
	}
	files, _ := filepath.Glob(filepath.Join("web", "themes", "*.css"))
	if len(files) == 0 {
		t.Fatal("no themes in web/themes")
	}
	// Required theme tokens read by the Tailwind entry. Keep in sync with docs/internals/styling-and-themes.md.
	required := []string{
		"--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
		"--secondary", "--secondary-foreground", "--muted", "--muted-foreground", "--accent", "--accent-foreground",
		"--sidebar", "--sidebar-foreground", "--sidebar-accent", "--sidebar-accent-foreground",
		"--border", "--input", "--sidebar-border", "--primary", "--ring", "--sidebar-primary", "--sidebar-ring",
		"--primary-foreground", "--sidebar-primary-foreground", "--primary-text", "--faint",
		"--destructive", "--sel", "--mark", "--mark-active", "--cur", "--shadow",
		"--k", "--nf", "--s", "--m", "--c", "--err",
	}
	body := rec.Body.String()
	for _, f := range files {
		// The file name is the theme id, which the picker and saved preference use.
		id := strings.TrimSuffix(filepath.Base(f), ".css")
		if !strings.Contains(body, `:root[data-theme="`+id+`"]`) {
			t.Errorf("%s: no :root[data-theme=%q] rule", f, id)
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, old := range []string{"--bg", "--bg2", "--bg3", "--bg4", "--fg", "--dim", "--line", "--accent-fg", "--on-accent"} {
			if strings.Contains(string(src), old+":") {
				t.Errorf("%s: obsolete token %s", f, old)
			}
		}
		for _, tok := range required {
			if !strings.Contains(string(src), tok+":") {
				t.Errorf("%s: missing required token %s", f, tok)
			}
		}
	}
}

func TestStaticAssetServing(t *testing.T) {
	s, _ := newTestServer(t)

	// 1. Serving uncompressed assets (e.g. app.css)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/app.css", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("app.css status %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/css") {
		t.Errorf("app.css content-type: %s", ct)
	}

	// 2. Serving compressed vendor assets with Accept-Encoding: gzip
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/static/vendor/mermaid-12.0.0.min.js", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("mermaid gzip status %d", rec.Code)
	}
	if ce := rec.Header().Get("Content-Encoding"); ce != "gzip" {
		t.Errorf("mermaid content-encoding = %q, want gzip", ce)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Errorf("mermaid content-type = %q, want text/javascript", ct)
	}
	gzr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("failed to create gzip reader: %v", err)
	}
	decompressed, err := io.ReadAll(gzr)
	gzr.Close()
	if err != nil {
		t.Fatalf("failed to decompress gzip body: %v", err)
	}
	if bytes.HasPrefix(decompressed, []byte("\x1f\x8b")) {
		t.Errorf("decompressed mermaid body is still gzipped (double gzip detected)")
	}
	if !strings.HasPrefix(string(decompressed), "\"use strict\";") {
		t.Errorf("decompressed mermaid body missing expected javascript prefix")
	}
	if !strings.Contains(string(decompressed), "mermaid") {
		t.Errorf("decompressed mermaid body missing 'mermaid' keyword")
	}

	// 3. Serving compressed vendor assets without Accept-Encoding: gzip (transparent decompression)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/static/vendor/mermaid-12.0.0.min.js", nil)
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("mermaid uncompressed status %d", rec.Code)
	}
	if ce := rec.Header().Get("Content-Encoding"); ce != "" {
		t.Errorf("mermaid content-encoding without gzip request = %q, want none", ce)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Errorf("mermaid content-type = %q, want text/javascript", ct)
	}
	if !strings.Contains(rec.Body.String(), "mermaid") {
		t.Errorf("uncompressed mermaid body missing 'mermaid' keyword")
	}

	// 4. Missing static file returns 404
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/nonexistent.js", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("missing asset status = %d, want 404", rec.Code)
	}

	// 5. Path traversal attempts are rejected (never 200 OK)
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/../server.go", nil))
	if rec.Code == http.StatusOK {
		t.Errorf("traversal returned 200 OK")
	}
}

func TestServerBasePathRouting(t *testing.T) {
	root := t.TempDir()
	ix := workspace.NewIndex(root)
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version, BasePath: "/rev-123/"})

	if s.baseURLPath() != "/rev-123/" {
		t.Fatalf("BasePath() = %q, want /rev-123/", s.baseURLPath())
	}

	// 1. GET /rev-123/ should return 200 and have injected <base href="/rev-123/">
	req := httptest.NewRequest(http.MethodGet, "/rev-123/", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /rev-123/ code = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `<base href="/rev-123/">`) {
		t.Errorf("GET /rev-123/ body missing injected base href: %s", rec.Body.String())
	}

	// 2. GET /rev-123 without trailing slash should redirect to /rev-123/
	reqNoSlash := httptest.NewRequest(http.MethodGet, "/rev-123", nil)
	recNoSlash := httptest.NewRecorder()
	s.ServeHTTP(recNoSlash, reqNoSlash)
	if recNoSlash.Code != http.StatusMovedPermanently && recNoSlash.Code != http.StatusFound {
		t.Errorf("GET /rev-123 code = %d, want redirect", recNoSlash.Code)
	}
	if loc := recNoSlash.Header().Get("Location"); loc != "/rev-123/" {
		t.Errorf("GET /rev-123 redirect Location = %q, want /rev-123/", loc)
	}

	// 3. GET / should redirect to /rev-123/
	reqRoot := httptest.NewRequest(http.MethodGet, "/", nil)
	recRoot := httptest.NewRecorder()
	s.ServeHTTP(recRoot, reqRoot)
	if recRoot.Code != http.StatusFound {
		t.Errorf("GET / code = %d, want 302", recRoot.Code)
	}
	if loc := recRoot.Header().Get("Location"); loc != "/rev-123/" {
		t.Errorf("GET / redirect Location = %q, want /rev-123/", loc)
	}

	// 4. GET /rev-123/api/meta returns 200 and basePath
	reqMeta := httptest.NewRequest(http.MethodGet, "/rev-123/api/meta", nil)
	recMeta := httptest.NewRecorder()
	s.ServeHTTP(recMeta, reqMeta)
	if recMeta.Code != http.StatusOK {
		t.Fatalf("GET /rev-123/api/meta code = %d, want 200", recMeta.Code)
	}
	var meta map[string]any
	if err := json.Unmarshal(recMeta.Body.Bytes(), &meta); err != nil {
		t.Fatalf("failed to decode meta: %v", err)
	}
	if meta["basePath"] != "/rev-123/" {
		t.Errorf("meta.basePath = %v, want /rev-123/", meta["basePath"])
	}

	// 5. GET /api/meta without prefix should 404
	reqRootMeta := httptest.NewRequest(http.MethodGet, "/api/meta", nil)
	recRootMeta := httptest.NewRecorder()
	s.ServeHTTP(recRootMeta, reqRootMeta)
	if recRootMeta.Code != http.StatusNotFound {
		t.Errorf("GET /api/meta code = %d, want 404", recRootMeta.Code)
	}
}
