package main

import (
	"bytes"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"faah/internal/httpx"
)

func TestEmbeddedBrandAssets(t *testing.T) {
	web, err := fs.Sub(embedded, "web")
	if err != nil {
		t.Fatal(err)
	}
	handler := httpx.Static(web, "/static/")
	icon, err := os.ReadFile("web/favicon.svg")
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/static/favicon.svg", nil))
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), icon) {
		t.Fatalf("embedded favicon: status %d, body %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("favicon content type: %q", response.Header().Get("Content-Type"))
	}
	for _, part := range []string{`aria-label="fibo"`, `rx="24"`, `fill="#cfe8b1"`, `stroke="#1d2620"`} {
		if !bytes.Contains(icon, []byte(part)) {
			t.Errorf("favicon is missing %s", part)
		}
	}
	for _, theme := range []string{"dark", "light"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/static/logo-"+theme+".svg", nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("old %s logo: status %d, want 404", theme, response.Code)
		}
	}
	for _, entry := range []string{"app", "workbench", "holding"} {
		bundle, err := fs.ReadFile(web, "dist/"+entry+".js")
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(bundle, []byte("static/logo-")) {
			t.Errorf("%s still requests an old logo", entry)
		}
	}
	for name, title := range map[string]string{
		"index.html":     "fibo",
		"workbench.html": "fibo workbench",
	} {
		page, err := fs.ReadFile(web, name)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(page), "<title>"+title+"</title>") {
			t.Errorf("%s is missing the %q title", name, title)
		}
	}
}
