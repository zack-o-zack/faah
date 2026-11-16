package httpx

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var assets fs.FS
var devRoot string

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
		Themes(assets, devRoot, t.TempDir()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/themes.css", nil))
		if !strings.Contains(rec.Body.String(), want) {
			t.Fatalf("themes.css = %q, want it to contain %q", rec.Body.String(), want)
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
	handler := Static(os.DirFS(root), "/review/static/")
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
