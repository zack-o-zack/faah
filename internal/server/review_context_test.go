package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/git/gittest"
)

func contextRequest(s *Server, query string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	s.handleReviewContext(w, httptest.NewRequest("GET", "/api/review/context?"+query, nil))
	return w
}

func TestReviewContext(t *testing.T) {
	s := fixtureExplainPR(t)
	if err := os.WriteFile(filepath.Join(s.ix.Root(), "change.go"), []byte("LOCAL EDIT\n"), 0600); err != nil {
		t.Fatal(err)
	}
	w := contextRequest(s, "path=change.go&from=-3&to=99")
	var reply struct {
		Path  string
		Total int
		Rows  []reviewContextRow
	}
	if err := json.Unmarshal(w.Body.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || reply.Path != "change.go" || reply.Total != 2 || len(reply.Rows) != reply.Total {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if reply.Rows[0].Line != 1 || reply.Rows[0].Text != "package fixture" || !strings.Contains(reply.Rows[0].HTML, "<i class=k>package</i>") || reply.Rows[1].Text != "// UNIQUE_BODY_MARKER" {
		t.Fatalf("%+v", reply)
	}
	for _, tc := range []struct {
		query  string
		status int
	}{
		{"path=change.go&from=1&to=2001", 400},
		{"path=change.go&from=3&to=2", 400},
		{"path=change.go&from=x&to=2", 400},
		{"path=outside.go&from=1&to=2", 404},
		{"path=../change.go&from=1&to=2", 400},
		{"path=change.go&from=999&to=999", 200},
	} {
		if w := contextRequest(s, tc.query); w.Code != tc.status {
			t.Errorf("%s: %d %s", tc.query, w.Code, w.Body)
		}
	}
	s.prHeadSHA = ""
	if w := contextRequest(s, "path=change.go&from=1&to=1"); w.Code != 409 {
		t.Fatal(w.Code)
	}
	s.pr = nil
	if w := contextRequest(s, "path=change.go&from=1&to=1"); w.Code != 409 {
		t.Fatal(w.Code)
	}
}

func TestReviewContextBinary(t *testing.T) {
	s := fixtureExplainPR(t)
	if err := os.WriteFile(filepath.Join(s.ix.Root(), "change.go"), []byte("binary\x00data"), 0600); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, s.ix.Root(), "add", "change.go")
	gittest.Run(t, s.ix.Root(), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "binary")
	s.prHeadSHA = strings.TrimSpace(gittest.Run(t, s.ix.Root(), "rev-parse", "HEAD"))
	if w := contextRequest(s, "path=change.go&from=1&to=1"); w.Code != 415 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestReviewContextEmptyHead(t *testing.T) {
	s := fixtureExplainPR(t)
	if err := os.WriteFile(filepath.Join(s.ix.Root(), "change.go"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, s.ix.Root(), "add", "change.go")
	gittest.Run(t, s.ix.Root(), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "empty")
	s.prHeadSHA = strings.TrimSpace(gittest.Run(t, s.ix.Root(), "rev-parse", "HEAD"))
	w := contextRequest(s, "path=change.go&from=1&to=3")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"total":0`) || !strings.Contains(w.Body.String(), `"rows":[]`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
