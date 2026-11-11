package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDevRootServesThemesFromDiskOnEveryRequest(t *testing.T) {
	root := t.TempDir()
	theme := filepath.Join(root, "web", "themes", "a.css")
	if err := os.MkdirAll(filepath.Dir(theme), 0755); err != nil {
		t.Fatal(err)
	}
	oldAssets, oldRoot := assets, devRoot
	t.Cleanup(func() { assets, devRoot = oldAssets, oldRoot })
	assets, devRoot = os.DirFS(root), root

	for _, want := range []string{"first", "second"} {
		if err := os.WriteFile(theme, []byte(want), 0644); err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		(&Server{}).handleThemes(rec, httptest.NewRequest(http.MethodGet, "/static/themes.css", nil))
		if !strings.Contains(rec.Body.String(), want) {
			t.Fatalf("themes.css = %q, want it to contain %q", rec.Body.String(), want)
		}
	}
}

func TestDevRootServesBuiltStylesheetFromDisk(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "web"), 0755); err != nil {
		t.Fatal(err)
	}
	oldAssets, oldRoot := assets, devRoot
	t.Cleanup(func() { assets, devRoot = oldAssets, oldRoot })
	assets, devRoot = os.DirFS(root), root
	s, _ := newTestServer(t)
	for _, want := range []string{"body{color:red}", "body{color:blue}"} {
		if err := os.WriteFile(filepath.Join(root, "web", "app.css"), []byte(want), 0644); err != nil {
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
