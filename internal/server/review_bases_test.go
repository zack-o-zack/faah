package server

import (
	"faah/internal/forge"
	"faah/internal/git/gittest"
	prpkg "faah/internal/pr"
	"faah/internal/workspace"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReviewBaseValidation(t *testing.T) {
	root := gittest.Repo(t)
	ix := workspace.NewIndex(root)
	ix.Build()
	s := &Server{ix: ix, diffBase: "HEAD"}
	for _, base := range []string{"--output=bad", "main..HEAD", "missing-branch"} {
		rec := httptest.NewRecorder()
		s.handleReviewWalkthrough(rec, httptest.NewRequest(http.MethodGet, "/api/review/walkthrough?base="+base, nil))
		if rec.Code != 400 {
			t.Fatalf("%s: %d %s", base, rec.Code, rec.Body.String())
		}
	}
	s.pr = prpkg.New(nil, forge.PRTarget{}, forge.PRMeta{}, "", "HEAD")
	s.prHeadSHA = "HEAD"
	rec := httptest.NewRecorder()
	s.handleReviewWalkthrough(rec, httptest.NewRequest(http.MethodGet, "/api/review/walkthrough?base=--invalid", nil))
	if rec.Code != 200 {
		t.Fatalf("PR: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	s.handleReviewBases(rec, httptest.NewRequest(http.MethodGet, "/api/review/bases", nil))
	if rec.Body.String() != "{\"branches\":[]}\n" {
		t.Fatal(rec.Body.String())
	}
}
