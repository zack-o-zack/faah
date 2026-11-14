package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDevRootServesBuiltStylesheetFromDisk(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "web", "dist"), 0755); err != nil {
		t.Fatal(err)
	}
	oldAssets, oldRoot := assets, devRoot
	t.Cleanup(func() { assets, devRoot = oldAssets, oldRoot })
	assets, devRoot = os.DirFS(root), root
	s, _ := newTestServer(t)
	for _, want := range []string{"body{color:var(--foreground)}", "body{background:var(--background)}"} {
		if err := os.WriteFile(filepath.Join(root, "web", "dist", "app.css"), []byte(want), 0644); err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/app.css", nil))
		if rec.Code != http.StatusOK || rec.Body.String() != want {
			t.Fatalf("app.css: status %d body %q", rec.Code, rec.Body.String())
		}
		if !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/css") {
			t.Fatal("app.css must be served as CSS")
		}
	}
}
