package server

import (
	"net/http"
	"testing"
)

func TestPathTraversalRefused(t *testing.T) {
	s, _ := newTestServer(t)
	for _, bad := range []string{
		"/api/file?path=../../../etc/passwd",
		"/api/file?path=/etc/passwd",
		"/api/file?path=sub/../../outside",
		"/api/outline?path=..%2F..%2Fetc%2Fpasswd",
	} {
		code, body := get(t, s, bad)
		if code == http.StatusOK {
			t.Errorf("%s returned 200: %v", bad, body)
		}
	}
}
