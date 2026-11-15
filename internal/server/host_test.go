package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"faah/internal/forge"
	prpkg "faah/internal/pr"
	"faah/internal/session"
	"faah/internal/workspace"
)

func TestPRDraftSessionPersistence(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	root := t.TempDir()
	ix := workspace.NewIndex(root)
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version, BasePath: "/rev-42/"})
	pr := prpkg.New(nil, forge.PRTarget{}, forge.PRMeta{}, "", "HEAD")
	s.SetPR(pr)

	// Add a draft comment via POST /rev-42/api/pr/comments
	payload := map[string]any{
		"path": "main.go",
		"line": 25,
		"side": "RIGHT",
		"body": "Check this line",
	}
	b, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/rev-42/api/pr/comments", bytes.NewReader(b))
	req.Host = "127.0.0.1:7777"
	req.Header.Set("Origin", "http://127.0.0.1:7777")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /rev-42/api/pr/comments failed: code %d, body %s", rec.Code, rec.Body.String())
	}

	// Create a second server instance simulating a restart
	s2 := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version, BasePath: "/rev-42/"})
	pr2 := prpkg.New(nil, forge.PRTarget{}, forge.PRMeta{}, "", "HEAD")
	s2.SetPR(pr2)

	// Verify drafts were restored in pr2
	pr2.WithDrafts(func(drafts *[]forge.DraftComment, nextID *int64) {
		if len((*drafts)) != 1 {
			t.Fatalf("expected 1 restored draft comment, got %d", len((*drafts)))
		}
		if (*drafts)[0].Path != "main.go" || (*drafts)[0].Body != "Check this line" {
			t.Errorf("unexpected restored comment: %+v", (*drafts)[0])
		}
	})
}

// A direct `faah <pr-url>` run has no base path and checks out into a new
// temporary directory each time; drafts must still come back.
func TestPRDraftsSurviveNewCheckoutRoot(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	pt := forge.PRTarget{Provider: "github", Owner: "acme", Repo: "widget", Number: 7}

	s := New(Options{Workspace: workspace.NewIndex(t.TempDir()), LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})
	s.SetPR(prpkg.New(nil, pt, forge.PRMeta{}, "", "HEAD"))
	postDraft(t, s, "", "first run")

	s2 := New(Options{Workspace: workspace.NewIndex(t.TempDir()), LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})
	pr2 := prpkg.New(nil, pt, forge.PRMeta{}, "", "HEAD")
	s2.SetPR(pr2)
	pr2.WithDrafts(func(drafts *[]forge.DraftComment, nextID *int64) {
		if len((*drafts)) != 1 || (*drafts)[0].Body != "first run" {
			t.Fatalf("expected the draft from the earlier run, got %+v", (*drafts))
		}
	})

	other := prpkg.New(nil, forge.PRTarget{Provider: "github", Owner: "acme", Repo: "widget", Number: 8}, forge.PRMeta{}, "", "HEAD")
	New(Options{Workspace: workspace.NewIndex(t.TempDir()), LSP: nil, Assets: assets, DevRoot: devRoot, Version: version}).SetPR(other)
	other.WithDrafts(func(drafts *[]forge.DraftComment, nextID *int64) {
		if len((*drafts)) != 0 {
			t.Fatalf("another PR must not see these drafts, got %+v", (*drafts))
		}
	})
}

// Drafts an older faah saved under the base-path file move to the PR's file.
func TestPRDraftsMigrateFromBasePathFile(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	root := t.TempDir()
	session.New("/w/abc/", root).Update(func(ws *session.Workspace) {
		ws.Drafts = []forge.DraftComment{{ID: 3, Path: "a.go", Line: 1, Side: "RIGHT", Body: "old"}}
	})

	pt := forge.PRTarget{Provider: "github", Owner: "acme", Repo: "widget", Number: 7}
	pr := prpkg.New(nil, pt, forge.PRMeta{}, "", "HEAD")
	New(Options{Workspace: workspace.NewIndex(root), LSP: nil, Assets: assets, DevRoot: devRoot, Version: version, BasePath: "/w/abc/"}).SetPR(pr)
	pr.WithDrafts(func(drafts *[]forge.DraftComment, nextID *int64) {
		if len((*drafts)) != 1 || (*drafts)[0].Body != "old" || (*nextID) != 3 {
			t.Fatalf("expected the migrated draft, got %+v (nextID %d)", (*drafts), (*nextID))
		}
	})
	if got := session.NewPR(pt).Get().Drafts; len(got) != 1 {
		t.Fatalf("expected the draft in the PR session file, got %+v", got)
	}
	if got := session.New("/w/abc/", root).Get().Drafts; len(got) != 0 {
		t.Fatalf("expected the base-path file's drafts cleared, got %+v", got)
	}
}
