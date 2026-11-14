package httpx

import (
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCleanBasePath(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", "/"},
		{"/", "/"},
		{".", "/"},
		{"rev-123", "/rev-123/"},
		{"/rev-123", "/rev-123/"},
		{"/rev-123/", "/rev-123/"},
		{"//rev-123///", "/rev-123/"},
		{"sub/path", "/sub/path/"},
		{"/a/b/", "/a/b/"},
	}
	for _, tc := range cases {
		got := CleanBasePath(tc.in)
		if got != tc.want {
			t.Errorf("CleanBasePath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestStatusRecorderInterfaces(t *testing.T) {
	rec := httptest.NewRecorder()
	sr := &StatusRecorder{ResponseWriter: rec}

	// Verify http.Flusher
	if flusher, ok := any(sr).(http.Flusher); ok {
		flusher.Flush()
		if !rec.Flushed {
			t.Error("expected Flush to propagate to underlying recorder")
		}
	} else {
		t.Error("StatusRecorder does not implement http.Flusher")
	}

	// Verify Unwrap
	if unwrapped := sr.Unwrap(); unwrapped != rec {
		t.Errorf("expected Unwrap to return %p, got %p", rec, unwrapped)
	}

	// Verify GzipWriter Flusher and Unwrap
	gw := GzipWriter{ResponseWriter: rec}
	if _, ok := any(gw).(http.Flusher); !ok {
		t.Error("GzipWriter does not implement http.Flusher")
	}
	if unwrapped := gw.Unwrap(); unwrapped != rec {
		t.Errorf("expected GzipWriter Unwrap to return %p, got %p", rec, unwrapped)
	}
}

func TestGzipWriterBodilessResponsesAndContentLength(t *testing.T) {
	rec := httptest.NewRecorder()
	gz, _ := gzip.NewWriterLevel(rec, gzip.BestSpeed)
	gw := &GzipWriter{ResponseWriter: rec, w: gz}

	// 1. Test 304 Not Modified
	gw.Header().Set("Content-Length", "1234")
	gw.Header().Set("Content-Encoding", "gzip")
	gw.WriteHeader(http.StatusNotModified)
	gz.Close()

	if rec.Header().Get("Content-Length") != "" {
		t.Errorf("expected Content-Length to be deleted on 304, got: %q", rec.Header().Get("Content-Length"))
	}
	if rec.Header().Get("Content-Encoding") != "" {
		t.Errorf("expected Content-Encoding to be deleted on 304, got: %q", rec.Header().Get("Content-Encoding"))
	}
	if rec.Body.Len() != 0 {
		t.Errorf("expected no body written on 304, got %d bytes: %q", rec.Body.Len(), rec.Body.String())
	}

	// 2. Test 200 with normal body
	rec2 := httptest.NewRecorder()
	gz2, _ := gzip.NewWriterLevel(rec2, gzip.BestSpeed)
	gw2 := &GzipWriter{ResponseWriter: rec2, w: gz2}
	gw2.Header().Set("Content-Length", "999")
	gw2.Header().Set("Content-Encoding", "gzip")
	gw2.WriteHeader(http.StatusOK)
	gw2.Write([]byte("hello compressed world"))
	gz2.Close()

	if rec2.Header().Get("Content-Length") != "" {
		t.Errorf("expected Content-Length to be stripped from compressed response, got: %q", rec2.Header().Get("Content-Length"))
	}
	if rec2.Header().Get("Content-Encoding") != "gzip" {
		t.Errorf("expected Content-Encoding to be gzip on 200, got: %q", rec2.Header().Get("Content-Encoding"))
	}
	if rec2.Body.Len() == 0 {
		t.Errorf("expected compressed body on 200")
	}
}
