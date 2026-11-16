package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"faah/internal/explain"
	"faah/internal/explain/notes"
	"faah/internal/forge"
	"faah/internal/git/gittest"
	prpkg "faah/internal/pr"
	"faah/internal/pr/prtest"
	"faah/internal/render"
	"faah/internal/review"
)

func fixtureExplainPR(t *testing.T) *Server {
	t.Helper()
	root := prtest.RepoWithRemotes(t, nil)
	write := func(path, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, path), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	commit := func(message string) string {
		gittest.Run(t, root, "add", "-A")
		gittest.Run(t, root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", message)
		return strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	}
	write("change.go", "package fixture\n// old\n")
	write("deleted.go", "package deleted\n")
	write("old.go", "package renamed\n")
	base := commit("base")
	write("change.go", "package fixture\n// UNIQUE_BODY_MARKER\n")
	write("added.go", "package added\n// UNIQUE_BODY_MARKER\n")
	if err := os.Remove(filepath.Join(root, "deleted.go")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(root, "old.go"), filepath.Join(root, "new.go")); err != nil {
		t.Fatal(err)
	}
	head := commit("head")
	s := fakeAgentServer(t, root, fakeReply("Explained\n"))
	p := prpkg.New(nil, forge.PRTarget{URL: "https://example.test/pr/7"}, forge.PRMeta{Number: 7, Title: "Update fixture", BaseRef: "main", HeadRef: "topic", HeadSHA: head}, root, base)
	s.SetPR(p)
	s.overviewCache.pr = p
	s.overviewCache.head = head
	s.overviewCache.expires = time.Now().Add(time.Hour)
	s.overviewCache.data = forge.PROverview{Description: forge.PRDescription{Body: "  " + strings.Repeat("é", 1100) + "TAIL_MUST_BE_CAPPED  "}}
	return s
}

func TestExplainPRPacket(t *testing.T) {
	s := fixtureExplainPR(t)
	target, ev, err := s.explainPRTarget(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !target.PR || target.Rel != "" || target.L1 != 0 || target.L2 != 0 || explainTitle(target) != "Explain PR #7" {
		t.Fatalf("target: %+v", target)
	}
	for _, want := range []string{"#7", "added.go:1-2", "change.go:1-2", "D deleted.go (deleted)", "R old.go → new.go", "pr.diff", "git diff"} {
		if !strings.Contains(ev.Packet, want) {
			t.Errorf("missing %q in %s", want, ev.Packet)
		}
	}
	for _, bad := range []string{"UNIQUE_BODY_MARKER", "TAIL_MUST_BE_CAPPED", "package fixture"} {
		if strings.Contains(ev.Packet, bad) {
			t.Errorf("leaked %q", bad)
		}
	}
	if !utf8.ValidString(ev.Packet) || ev.Hash != ev.Key || ev.Summary.Source != "" {
		t.Fatalf("evidence %+v", ev)
	}
	t.Log("PR PACKET:\n" + ev.Packet)
	old := ev.Key
	s.prHeadSHA = "different-head"
	_, next, err := s.explainPRTarget(context.Background())
	if err != nil || next.Key == old {
		t.Fatalf("head identity: %v %+v", err, next)
	}
}

func TestExplainPRRequestAndRefresh(t *testing.T) {
	s := fixtureExplainPR(t)
	code, result := agentPostJSON(t, s, "/api/explain", map[string]any{"pr": true})
	if code != 200 {
		t.Fatalf("%d %v", code, result)
	}
	id := result["thread"].(map[string]any)["id"].(string)
	thread := waitThreadIdle(t, s, id)
	if thread.ExplainReq == nil || !thread.ExplainReq.PR || thread.Path != "" || thread.Title != "Explain PR #7" {
		t.Fatalf("thread %+v", thread)
	}
	code, result = agentPostJSON(t, s, "/api/explain", thread.ExplainReq)
	if code != 200 || result["cached"] != true {
		t.Fatalf("reopen %d %v", code, result)
	}
	req := *thread.ExplainReq
	req.Force = true
	code, result = agentPostJSON(t, s, "/api/explain", req)
	if code != 200 || result["cached"] != false {
		t.Fatalf("refresh %d %v", code, result)
	}
	waitThreadIdle(t, s, result["thread"].(map[string]any)["id"].(string))
	s.pr = nil
	code, result = agentPostJSON(t, s, "/api/explain", map[string]any{"pr": true})
	if code != 409 {
		t.Fatalf("outside PR %d %v", code, result)
	}
}

func TestPRFileReferences(t *testing.T) {
	files := []review.WalkthroughFile{{Path: "a.go", Status: "M", Hunks: []render.DiffHunk{{NewStart: 9, Rows: []render.DiffRow{{Type: "del", OldLine: 9, Text: "PRIVATE"}}}}}}
	if got := prFileReferences(files); got != "- M a.go: (removed lines near a.go:9)" {
		t.Fatal(got)
	}
	for i := 1; i < 65; i++ {
		files = append(files, review.WalkthroughFile{Path: fmt.Sprintf("file-%d.go", i), Status: "M"})
	}
	got := prFileReferences(files)
	if !strings.Contains(got, "(+5 more)") || strings.Contains(got, "file-60.go") {
		t.Fatal(got)
	}
	text := explain.Instructions(explain.KindPR, "")
	if strings.Count(text, "saved diff file") != 1 || !strings.Contains(text, "even if it is outside the workspace") {
		t.Fatalf("saved diff permission must appear once: %s", text)
	}
	for _, want := range []string{"Explain what this pull request changes and why", "one walkthrough", "PR head", "saved diff file", "Removed code"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestExplainTurnNotes(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, fakeReply("ok\n"))
	_, result := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "file": true})
	id := result["thread"].(map[string]any)["id"].(string)
	waitThreadIdle(t, s, id)
	saveNotes(s, toolScope{tid: id, turn: 1}, []notes.Note{
		{Path: "main.go", Kind: "line", L1: 4, L2: 4, Text: "\thelper()", Summary: "Call"},
		{Path: "gone.go", Kind: "line", L1: 2, L2: 2, Text: "gone", Summary: "Missing file"},
	})
	req := httptest.NewRequest("GET", "/api/explain/notes?thread="+id+"&turn=1", nil)
	w := httptest.NewRecorder()
	s.handleExplainNotes(w, req)
	var reply struct {
		Notes []notes.View `json:"notes"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || len(reply.Notes) != 2 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if reply.Notes[0].Path != "gone.go" || reply.Notes[0].Stale != "text" || reply.Notes[1].Stale != "" {
		t.Fatalf("notes %+v", reply.Notes)
	}
	if got := fileNotes(t, s, "main.go"); len(got) != 1 || got[0].Summary != "Call" {
		t.Fatalf("path mode %+v", got)
	}
}

func TestExplainPRWithoutOverview(t *testing.T) {
	s := fixtureExplainPR(t)
	snap := s.pr.Snapshot()
	provider := &overviewProvider{head: snap.Meta.HeadSHA, fail: true}
	target := snap.Target
	target.Number = 7
	s.pr = prpkg.New(provider, target, snap.Meta, s.ix.Root(), snap.DiffBase)
	s.pr.ReplaceCredentials("token", "session", false)
	_, ev, err := s.explainPRTarget(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	section := strings.Split(strings.Split(ev.Packet, "Merge-base ")[1], "\n")[0]
	if !strings.Contains(section, "head ") {
		t.Fatalf("missing head: %s", ev.Packet)
	}
	if strings.Contains(ev.Packet, "é") || strings.Contains(ev.Packet, "Description") || strings.Contains(ev.Packet, "forge unavailable") {
		t.Fatalf("unexpected description: %s", ev.Packet)
	}
	code, result := agentPostJSON(t, s, "/api/explain", explain.Request{PR: true})
	if code != 200 {
		t.Fatalf("%d %v", code, result)
	}
	id := result["thread"].(map[string]any)["id"].(string)
	waitThreadIdle(t, s, id)
	if provider.calls < 2 {
		t.Fatal("overview failure was not exercised")
	}
}
