package forge

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestGiteaMergeMethodsAndState(t *testing.T) {
	f, tr := false, true
	cases := []struct {
		r    giteaRepo
		want string
	}{
		{giteaRepo{}, "merge,squash,rebase"},
		{giteaRepo{AllowMerge: &f, AllowRebase: &f, AllowSquash: &tr}, "squash"},
		{giteaRepo{AllowMerge: &tr, AllowRebase: &f, AllowSquash: &f, AllowFastForward: &tr}, "merge,rebase"},
	}
	for _, c := range cases {
		if got := strings.Join(giteaMergeMethods(c.r), ","); got != c.want {
			t.Errorf("%+v: %q, want %q", c.r, got, c.want)
		}
	}
	states := []struct {
		pr   giteaPR
		want string
	}{
		{giteaPR{Merged: true, State: "closed"}, mergeStateMerged},
		{giteaPR{State: "closed"}, mergeStateClosed},
		{giteaPR{State: "open", Title: "WIP: thing", Mergeable: true}, mergeStateDraft},
		{giteaPR{State: "open", Title: "[Draft] thing"}, mergeStateDraft},
		{giteaPR{State: "open", Mergeable: true}, mergeStateClean},
		{giteaPR{State: "open"}, mergeStateConflicts},
	}
	for _, c := range states {
		if got, _ := giteaMergeState(c.pr); got != c.want {
			t.Errorf("%+v: %q, want %q", c.pr, got, c.want)
		}
	}
}

func fakeGitea(t *testing.T, routes map[string]func(http.ResponseWriter, *http.Request)) (*recorder, PRTarget) {
	rc := &recorder{routes: routes}
	srv := rc.serve(t, "token tok")
	orig := giteaAPIBase
	giteaAPIBase = func(string) string { return srv.URL + "/api/v1" }
	t.Cleanup(func() { giteaAPIBase = orig })
	return rc, PRTarget{Provider: "gitea", Host: "codeberg.org", Owner: "o", Repo: "r", Number: 3}
}

const giteaPRJSON = `{"number":3,"title":"Add x","state":"open","mergeable":true,"user":{"login":"ana"},
	"base":{"ref":"main"},"head":{"ref":"feat","sha":"h1","repo":{"clone_url":"https://codeberg.org/ana/r.git","full_name":"ana/r"}}}`

func TestGiteaProvider(t *testing.T) {
	rc, tg := fakeGitea(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /api/v1/repos/o/r/pulls/3":                    reply(200, giteaPRJSON),
		"GET /api/v1/repos/o/r":                            reply(200, `{"permissions":{"push":true},"allow_merge_commits":true,"allow_rebase":false,"allow_squash_merge":true,"allow_fast_forward_only_merge":true}`),
		"POST /api/v1/repos/o/r/pulls/3/reviews":           reply(200, `{"id":5}`),
		"GET /api/v1/repos/o/r/issues/3/comments":          reply(200, `[{"id":1,"body":"hi","user":{"login":"bo"},"created_at":"2026-01-01T00:00:00Z"}]`),
		"GET /api/v1/repos/o/r/pulls/3/reviews":            reply(200, `[{"id":7},{"id":8}]`),
		"GET /api/v1/repos/o/r/pulls/3/reviews/7/comments": reply(200, `[{"id":70,"body":"first","path":"a.go","position":4,"user":{"login":"bo"},"created_at":"2026-01-02T00:00:00Z"}]`),
		"GET /api/v1/repos/o/r/pulls/3/reviews/8/comments": reply(200, `[{"id":80,"body":"answer","path":"a.go","position":4,"user":{"login":"ana"},"created_at":"2026-01-03T00:00:00Z"},
			{"id":81,"body":"elsewhere","path":"b.go","position":1,"user":{"login":"ana"},"created_at":"2026-01-03T00:00:01Z"}]`),
		"POST /api/v1/repos/o/r/pulls/3/merge": reply(200, ``),
	})
	g := &gitea{}
	ctx := context.Background()
	m, err := g.FetchPR(ctx, tg, "tok")
	if err != nil || m.HeadSHA != "h1" || !m.HeadIsFork || m.HeadRepoCloneURL != "https://codeberg.org/ana/r.git" || m.BaseRef != "main" {
		t.Fatalf("FetchPR = %+v, %v", m, err)
	}
	st, err := g.MergeStatus(ctx, tg, "tok")
	if err != nil || st.State != mergeStateClean || !st.CanMerge || strings.Join(st.Methods, ",") != "merge,squash,rebase" {
		t.Errorf("MergeStatus = %+v, %v", st, err)
	}

	err = g.SubmitReview(ctx, tg, "tok", "h1", []DraftComment{{Path: "a.go", Line: 4, Side: "RIGHT", Body: "nit"}, {Path: "b.go", Line: 2, Side: "LEFT", Body: "old"}}, "APPROVE", "ok")
	if err != nil {
		t.Fatal(err)
	}
	b := rc.bodies[0]
	cs := b["comments"].([]any)
	if b["event"] != "APPROVED" || b["commit_id"] != "h1" || cs[0].(map[string]any)["new_position"] != float64(4) || cs[1].(map[string]any)["old_position"] != float64(2) {
		t.Errorf("review payload = %v", b)
	}

	issue, review, err := g.FetchComments(ctx, tg, "tok")
	if err != nil || len(issue) != 1 || len(review) != 3 {
		t.Fatalf("comments: %v %v %v", issue, review, err)
	}
	if review[1].ID != 80 || review[1].InReplyTo != 70 || review[2].InReplyTo != 0 {
		t.Errorf("threading = %+v", review)
	}

	if _, err := g.ReplyToReviewComment(ctx, tg, "tok", 80, "ack"); err != nil {
		t.Fatal(err)
	}
	last := rc.bodies[len(rc.bodies)-1]
	if c := last["comments"].([]any)[0].(map[string]any); c["path"] != "a.go" || c["new_position"] != float64(4) || last["event"] != "COMMENT" {
		t.Errorf("reply payload = %v", last)
	}

	// Rebase is disallowed but fast-forward-only isn't: that's what's used.
	if _, err := g.Merge(ctx, tg, "tok", PRMergeRequest{Method: MergeMethodRebase, Title: "ignored", HeadSHA: "h1"}); err != nil {
		t.Fatal(err)
	}
	if last := rc.bodies[len(rc.bodies)-1]; last["Do"] != "fast-forward-only" || last["head_commit_id"] != "h1" || last["MergeTitleField"] != nil {
		t.Errorf("merge payload = %v", last)
	}
	g.Merge(ctx, tg, "tok", PRMergeRequest{Method: MergeMethodSquash, Title: "T", Message: "B"})
	if last := rc.bodies[len(rc.bodies)-1]; last["Do"] != "squash" || last["MergeTitleField"] != "T" || last["MergeMessageField"] != "B" {
		t.Errorf("squash payload = %v", last)
	}
}

func TestGiteaMergeErrors(t *testing.T) {
	status, msg := 409, `{"message":"head out of date"}`
	_, tg := fakeGitea(t, map[string]func(http.ResponseWriter, *http.Request){
		"POST /api/v1/repos/o/r/pulls/3/merge": func(w http.ResponseWriter, r *http.Request) { reply(status, msg)(w, r) },
	})
	g := &gitea{}
	if _, err := g.Merge(context.Background(), tg, "tok", PRMergeRequest{Method: MergeMethodMerge}); !errors.Is(err, ErrPRHeadMoved) {
		t.Errorf("409 head: %v", err)
	}
	msg = `{"message":"merge conflict"}`
	if _, err := g.Merge(context.Background(), tg, "tok", PRMergeRequest{Method: MergeMethodMerge}); !errors.Is(err, ErrPRNotMergeable) {
		t.Errorf("409 conflict: %v", err)
	}
	status, msg = 405, `{"message":"not allowed"}`
	if _, err := g.Merge(context.Background(), tg, "tok", PRMergeRequest{Method: MergeMethodMerge}); !errors.Is(err, ErrPRNotMergeable) {
		t.Errorf("405: %v", err)
	}
}
