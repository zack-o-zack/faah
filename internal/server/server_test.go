package server

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"faah/internal/httpx"
	lsppkg "faah/internal/lsp"
	"faah/internal/ui"
	"faah/internal/workspace"
)

func TestVerboseRequestLogging(t *testing.T) {
	origVerbose := ui.Verbose
	origQuiet := ui.Quiet
	defer func() {
		ui.Verbose = origVerbose
		ui.Quiet = origQuiet
	}()

	s, _ := newTestServer(t)

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe() failed: %v", err)
	}
	origStdout := os.Stdout
	os.Stdout = w
	defer func() {
		os.Stdout = origStdout
	}()

	ui.Verbose = true
	ui.Quiet = false

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/tree", nil)
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	rec404 := httptest.NewRecorder()
	req404 := httptest.NewRequest(http.MethodGet, "/api/nonexistent", nil)
	s.ServeHTTP(rec404, req404)

	w.Close()
	out, _ := io.ReadAll(r)
	r.Close()

	logOutput := string(out)
	if !strings.Contains(logOutput, "GET /api/tree · 200") {
		t.Errorf("expected log output to contain 'GET /api/tree · 200', got:\n%s", logOutput)
	}
	if !strings.Contains(logOutput, "GET /api/nonexistent · 404") {
		t.Errorf("expected log output to contain 'GET /api/nonexistent · 404', got:\n%s", logOutput)
	}
}

func TestServerServeHTTPGzip(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Errorf("expected gzip Content-Encoding, got %q", rec.Header().Get("Content-Encoding"))
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("failed to create gzip reader on response body: %v (len=%d)", err, rec.Body.Len())
	}
	defer zr.Close()
	body, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("failed to read decompressed body: %v", err)
	}
	if len(body) == 0 {
		t.Errorf("expected non-empty decompressed body, got 0 bytes")
	}
	if !strings.Contains(string(body), "<!doctype html>") {
		t.Errorf("expected html content in body")
	}
}

func TestContentSecurityPolicyHeader(t *testing.T) {
	s, _ := newTestServer(t)

	endpoints := []string{"/", "/api/meta", "/api/raw?path=main.go"}
	for _, ep := range endpoints {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, ep, nil)
		s.ServeHTTP(rec, req)

		csp := rec.Header().Get("Content-Security-Policy")
		if csp == "" {
			t.Fatalf("%s: missing Content-Security-Policy header", ep)
		}
		if csp != httpx.ContentSecurityPolicy {
			t.Errorf("%s: got CSP %q, want %q", ep, csp, httpx.ContentSecurityPolicy)
		}

		requiredDirectives := []string{
			"default-src 'self'",
			"script-src 'self'",
			"style-src 'self' 'unsafe-inline'",
			"font-src 'self'",
			"img-src 'self' data: https: http:",
			"connect-src 'self'",
			"object-src 'none'",
			"base-uri 'self'",
			"frame-ancestors 'none'",
			"form-action 'none'",
		}
		for _, dir := range requiredDirectives {
			if !strings.Contains(csp, dir) {
				t.Errorf("%s: CSP missing directive %q", ep, dir)
			}
		}
	}
}

func BenchmarkHandleFileScrollChunk(b *testing.B) {
	wd, err := os.Getwd()
	if err != nil {
		b.Fatal(err)
	}
	ix := workspace.NewIndex(wd)
	ix.Build()
	srv := &Server{ix: ix, lsp: lsppkg.New(lsppkg.Options{Root: wd, Enabled: false, Version: version}), diffBase: "HEAD"}
	req := httptest.NewRequest(http.MethodGet, "/api/file?path=internal/lsp/manager.go&start=300&count=300", nil)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		srv.handleFile(w, req)
	}
}
