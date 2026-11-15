package httpxtest

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func PostJSON(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest("POST", path, strings.NewReader(body))
	r.Host = "127.0.0.1:7777"
	r.Header.Set("Origin", "http://127.0.0.1:7777")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

// New folder takes a name inside the shown folder or a nested path, and
// refuses one that already exists.
