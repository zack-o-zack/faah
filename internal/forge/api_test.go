package forge

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// recorder is a fake forge API: handlers keyed by "METHOD path", writes logged.
type recorder struct {
	mu     sync.Mutex
	routes map[string]func(w http.ResponseWriter, r *http.Request)
	writes []string
	bodies []map[string]any
}

func (rc *recorder) serve(t *testing.T, wantAuth string) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != wantAuth {
			t.Errorf("%s %s: Authorization = %q, want %q", r.Method, r.URL.Path, got, wantAuth)
		}
		key := r.Method + " " + r.URL.EscapedPath()
		if r.Method != http.MethodGet {
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			rc.mu.Lock()
			rc.writes = append(rc.writes, key)
			rc.bodies = append(rc.bodies, body)
			rc.mu.Unlock()
		}
		w.Header().Set("Content-Type", "application/json")
		if h, ok := rc.routes[key]; ok {
			h(w, r)
			return
		}
		t.Errorf("unexpected %s (query %s)", key, r.URL.RawQuery)
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func reply(status int, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		io.WriteString(w, body)
	}
}
