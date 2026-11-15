package server

import (
	"net/http"
	"testing"
)

func TestMetaIncludesVersion(t *testing.T) {
	s, _ := newTestServer(t)
	code, body := get(t, s, "/api/meta")
	if code != http.StatusOK {
		t.Fatalf("/api/meta returned %d: %v", code, body)
	}
	v, ok := body["version"].(string)
	if !ok || v != version {
		t.Fatalf("expected version %q in /api/meta, got %v", version, body["version"])
	}
}
