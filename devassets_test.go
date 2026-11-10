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
