package server

import (
	"net/http"
	"os"
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

func TestMetaIncludesHome(t *testing.T) {
	s, _ := newTestServer(t)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	code, body := get(t, s, "/api/meta")
	if code != http.StatusOK || body["home"] != home {
		t.Fatalf("expected home %q in /api/meta, got status %d: %v", home, code, body)
	}
}
