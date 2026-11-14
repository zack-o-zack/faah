package forge

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func fakeBitbucket(t *testing.T, routes map[string]func(http.ResponseWriter, *http.Request)) (*recorder, PRTarget) {
	t.Setenv("BITBUCKET_EMAIL", "")
	rc := &recorder{routes: routes}
	srv := rc.serve(t, "Bearer tok")
	orig := bitbucketAPIBase
	bitbucketAPIBase = srv.URL + "/2.0"
	t.Cleanup(func() { bitbucketAPIBase = orig })
	return rc, PRTarget{Provider: "bitbucket", Host: "bitbucket.org", Owner: "ws", Repo: "r", Number: 9}
}

const bbFull = "abcdef0123456789abcdef0123456789abcdef01"

var bbPRJSON = `{"id":9,"title":"Add y","state":"OPEN","author":{"nickname":"ana"},
	"source":{"branch":{"name":"feat"},"commit":{"hash":"abcdef012345"},"repository":{"full_name":"ana/r"}},
	"destination":{"branch":{"name":"main"},"commit":{"hash":"000000000000"},"repository":{"full_name":"ws/r"}}}`

func bbRoutes(extra map[string]func(http.ResponseWriter, *http.Request)) map[string]func(http.ResponseWriter, *http.Request) {
	routes := map[string]func(http.ResponseWriter, *http.Request){
		"GET /2.0/repositories/ws/r/pullrequests/9":          reply(200, bbPRJSON),
		"GET /2.0/repositories/ana/r/commit/abcdef012345":    reply(200, `{"hash":"`+bbFull+`"}`),
		"GET /2.0/repositories/ws/r/pullrequests/9/diffstat": reply(200, `{"values":[{"status":"modified"}]}`),
		"GET /2.0/repositories/ws/r/refs/branches/main":      reply(200, `{"merge_strategies":["merge_commit","squash","rebase_fast_forward","fast_forward"]}`),
		"GET /2.0/user/permissions/repositories":             reply(200, `{"values":[{"permission":"write"}]}`),
	}
	for k, v := range extra {
		routes[k] = v
	}
	return routes
}

func TestBitbucketProvider(t *testing.T) {
	comments := `{"values":[
		{"id":1,"content":{"raw":"general"},"user":{"nickname":"bo"},"created_on":"2026-01-01"},
		{"id":2,"content":{"raw":"on a line"},"user":{"nickname":"bo"},"inline":{"path":"a.go","to":7,"from":null}},
		{"id":3,"content":{"raw":"reply"},"user":{"nickname":"ana"},"parent":{"id":2},"inline":{"path":"a.go","to":7}},
		{"id":4,"content":{"raw":"reply to reply"},"user":{"nickname":"bo"},"parent":{"id":3}},
		{"id":5,"content":{"raw":""},"deleted":true}
	],"next":""}`
	rc, tg := fakeBitbucket(t, bbRoutes(map[string]func(http.ResponseWriter, *http.Request){
		"GET /2.0/repositories/ws/r/pullrequests/9/comments":         reply(200, comments),
		"POST /2.0/repositories/ws/r/pullrequests/9/comments":        reply(201, `{"id":50,"content":{"raw":"x"}}`),
		"POST /2.0/repositories/ws/r/pullrequests/9/approve":         reply(200, `{}`),
		"POST /2.0/repositories/ws/r/pullrequests/9/request-changes": reply(200, `{}`),
		"POST /2.0/repositories/ws/r/pullrequests/9/merge":           reply(200, `{"merge_commit":{"hash":"m1"}}`),
	}))
	b := &bitbucket{}
	ctx := context.Background()
	m, err := b.FetchPR(ctx, tg, "tok")
	if err != nil || m.HeadSHA != bbFull || !m.HeadIsFork || m.HeadRepoCloneURL != "https://bitbucket.org/ana/r.git" || m.BaseRef != "main" || m.State != "open" {
		t.Fatalf("FetchPR = %+v, %v", m, err)
	}
	if b.PRHeadRef(tg) != "" {
		t.Error("Bitbucket has no PR head ref")
	}
	st, err := b.MergeStatus(ctx, tg, "tok")
	if err != nil || st.State != mergeStateClean || !st.CanMerge || st.HeadSHA != bbFull || strings.Join(st.Methods, ",") != "merge,squash,rebase" {
		t.Errorf("MergeStatus = %+v, %v", st, err)
	}

	issue, review, err := b.FetchComments(ctx, tg, "tok")
	if err != nil || len(issue) != 1 || len(review) != 3 {
		t.Fatalf("comments: %+v %+v %v", issue, review, err)
	}
	if review[0].Line != 7 || review[0].Side != "RIGHT" || review[1].InReplyTo != 2 || review[2].InReplyTo != 2 || review[2].Path != "a.go" {
		t.Errorf("threads = %+v", review)
	}

	if err := b.SubmitReview(ctx, tg, "tok", bbFull, []DraftComment{{Path: "a.go", Line: 3, Side: "LEFT", Body: "old"}}, "REQUEST_CHANGES", "fix"); err != nil {
		t.Fatal(err)
	}
	want := []string{"POST /2.0/repositories/ws/r/pullrequests/9/comments", "POST /2.0/repositories/ws/r/pullrequests/9/comments", "POST /2.0/repositories/ws/r/pullrequests/9/request-changes"}
	if strings.Join(rc.writes, "|") != strings.Join(want, "|") {
		t.Fatalf("writes = %v", rc.writes)
	}
	if in := rc.bodies[0]["inline"].(map[string]any); in["from"] != float64(3) || in["to"] != nil {
		t.Errorf("inline = %v", in)
	}

	if c, err := b.ReplyToReviewComment(ctx, tg, "tok", 3, "ok"); err != nil || c.InReplyTo != 2 || c.Path != "a.go" {
		t.Errorf("reply = %+v, %v", c, err)
	}
	if p := rc.bodies[len(rc.bodies)-1]["parent"].(map[string]any); p["id"] != float64(3) {
		t.Errorf("reply parent = %v", p)
	}

	res, err := b.Merge(ctx, tg, "tok", PRMergeRequest{Method: MergeMethodRebase, HeadSHA: bbFull, Title: "ignored"})
	if err != nil || res.SHA != "m1" {
		t.Fatalf("merge = %+v, %v", res, err)
	}
	if last := rc.bodies[len(rc.bodies)-1]; last["merge_strategy"] != "rebase_fast_forward" || last["message"] != nil || last["close_source_branch"] != false {
		t.Errorf("merge payload = %v", last)
	}
	b.Merge(ctx, tg, "tok", PRMergeRequest{Method: MergeMethodSquash, HeadSHA: bbFull, Title: "T", Message: "B"})
	if last := rc.bodies[len(rc.bodies)-1]; last["merge_strategy"] != "squash" || last["message"] != "T\n\nB" {
		t.Errorf("squash payload = %v", last)
	}

	// Bitbucket has no head guard: faah refuses itself when the head moved.
	n := len(rc.writes)
	if _, err := b.Merge(ctx, tg, "tok", PRMergeRequest{Method: MergeMethodMerge, HeadSHA: "1111111111111111111111111111111111111111"}); !errors.Is(err, ErrPRHeadMoved) {
		t.Errorf("moved head: %v", err)
	}
	if len(rc.writes) != n {
		t.Error("a merge was sent despite the moved head")
	}
}

func TestBitbucketConflictsAndRefusal(t *testing.T) {
	_, tg := fakeBitbucket(t, bbRoutes(map[string]func(http.ResponseWriter, *http.Request){
		"GET /2.0/repositories/ws/r/pullrequests/9/diffstat": reply(200, `{"values":[{"status":"modified"},{"status":"merge conflict"}]}`),
		"GET /2.0/repositories/ws/r/refs/branches/main":      reply(200, `{"merge_strategies":["squash"]}`),
		"POST /2.0/repositories/ws/r/pullrequests/9/merge":   reply(400, `{"type":"error","error":{"message":"You can't merge until you resolve all merge conflicts."}}`),
	}))
	b := &bitbucket{}
	st, _ := b.MergeStatus(context.Background(), tg, "tok")
	if st.State != mergeStateConflicts || strings.Join(st.Methods, ",") != "squash" {
		t.Errorf("status = %+v", st)
	}
	if _, err := b.Merge(context.Background(), tg, "tok", PRMergeRequest{Method: MergeMethodMerge, HeadSHA: bbFull}); !errors.Is(err, ErrPRNotMergeable) {
		t.Errorf("disallowed strategy: %v", err)
	}
	_, err := b.Merge(context.Background(), tg, "tok", PRMergeRequest{Method: MergeMethodSquash, HeadSHA: bbFull})
	if !errors.Is(err, ErrPRNotMergeable) || !strings.Contains(err.Error(), "resolve all merge conflicts") {
		t.Errorf("400: %v", err)
	}
}
