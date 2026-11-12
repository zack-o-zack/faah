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

func TestStaticPrefersAnyDistAssetAndFallsThrough(t *testing.T) {
	root := t.TempDir()
	for name, body := range map[string]string{
		"dist/chunks/editor.js":   "built chunk",
		"chunks/editor.js":        "source chunk",
		"fonts/custom.woff2":      "font asset",
		"dist/styles/new.css":     "built stylesheet",
		"dist/directory/child.js": "nested asset",
		"directory/index.html":    "static directory",
	} {
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	handler := (&Server{}).handleStatic(os.DirFS(root), "/review/static/")
	for _, tc := range []struct {
		path, want string
		status     int
	}{
		{"chunks/editor.js", "built chunk", http.StatusOK},
		{"styles/new.css", "built stylesheet", http.StatusOK},
		{"fonts/custom.woff2", "font asset", http.StatusOK},
		{"directory/", "static directory", http.StatusOK},
		{"missing.js", "", http.StatusNotFound},
	} {
		t.Run(tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/review/static/"+tc.path, nil))
			if rec.Code != tc.status {
				t.Fatalf("status = %d, want %d", rec.Code, tc.status)
			}
			if tc.want != "" && rec.Body.String() != tc.want {
				t.Fatalf("body = %q, want %q", rec.Body.String(), tc.want)
			}
		})
	}
}
