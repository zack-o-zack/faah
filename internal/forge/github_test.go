package forge

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"faah/internal/forge/forgetest"
)

func TestSubmitReviewPayload(t *testing.T) {
	orig := githubHTTPClient.Transport
	defer func() { githubHTTPClient.Transport = orig }()

	var capturedBody []byte
	var capturedPath string
	githubHTTPClient.Transport = forgetest.RoundTripperFunc(func(req *http.Request) (*http.Response, error) {
		capturedPath = req.URL.Path
		capturedBody, _ = io.ReadAll(req.Body)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader("{}")),
			Header:     make(http.Header),
		}, nil
	})

	ctx := context.Background()
	comments := []DraftComment{
		{ID: 1, Path: "main.go", Line: 10, Side: "RIGHT", Body: "looks good"},
		{ID: 2, Path: "old.go", Line: 5, Side: "LEFT", Body: "deleted line comment"},
	}
	err := submitReview(ctx, "px0-ai", "px0", 42, "dummy-token", "abc123sha", comments, "APPROVE", "Overall LGTM")
	if err != nil {
		t.Fatalf("submitReview failed: %v", err)
	}
	if capturedPath != "/repos/px0-ai/px0/pulls/42/reviews" {
		t.Errorf("unexpected path: %q", capturedPath)
	}
	var payload struct {
		CommitID string `json:"commit_id"`
		Body     string `json:"body"`
		Event    string `json:"event"`
		Comments []struct {
			Path string `json:"path"`
			Line int    `json:"line"`
			Side string `json:"side"`
			Body string `json:"body"`
		} `json:"comments"`
	}
	if err := json.Unmarshal(capturedBody, &payload); err != nil {
		t.Fatalf("failed to parse captured payload: %v", err)
	}
	if payload.CommitID != "abc123sha" {
		t.Errorf("payload.CommitID = %q, want abc123sha", payload.CommitID)
	}
	if payload.Event != "APPROVE" || payload.Body != "Overall LGTM" {
		t.Errorf("unexpected event or body: %+v", payload)
	}
	if len(payload.Comments) != 2 || payload.Comments[1].Side != "LEFT" {
		t.Errorf("unexpected comments in payload: %+v", payload.Comments)
	}
}

func TestFetchPRMetaMerged(t *testing.T) {
	orig := githubHTTPClient.Transport
	defer func() { githubHTTPClient.Transport = orig }()

	githubHTTPClient.Transport = forgetest.RoundTripperFunc(func(req *http.Request) (*http.Response, error) {
		body := `{
			"number": 55,
			"title": "Fix login race condition",
			"state": "closed",
			"merged": true,
			"merged_at": "2026-09-20T10:00:00Z",
			"user": {"login": "alice"},
			"base": {"ref": "main"},
			"head": {
				"ref": "fix-race",
				"sha": "fedcba987654",
				"repo": {"clone_url": "https://github.com/alice/px0.git", "full_name": "alice/px0"}
			}
		}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	})

	meta, err := fetchPRMeta(context.Background(), "px0-ai", "px0", 55, "")
	if err != nil {
		t.Fatalf("fetchPRMeta failed: %v", err)
	}
	if !meta.Merged {
		t.Errorf("meta.Merged = false, want true")
	}
	if meta.State != "closed" {
		t.Errorf("meta.State = %q, want closed", meta.State)
	}
	if meta.MergedAt != "2026-09-20T10:00:00Z" {
		t.Errorf("meta.MergedAt = %q, want timestamp", meta.MergedAt)
	}
}

func TestGitHubProviderInterface(t *testing.T) {
	var gp Provider = &GitHub{}
	if gp.Name() != "github" {
		t.Errorf("gp.Name() = %q, want github", gp.Name())
	}
	if !gp.MatchURL("https://github.com/foo/bar/pull/12") {
		t.Error("MatchURL should be true for valid github PR URL")
	}
	if gp.MatchURL("https://gitlab.com/foo/bar/-/merge_requests/12") {
		t.Error("MatchURL should be false for gitlab URL")
	}
	tgt, err := gp.ParseURL("https://github.com/foo/bar.git/pull/99")
	if err != nil {
		t.Fatalf("ParseURL failed: %v", err)
	}
	if tgt.Owner != "foo" || tgt.Repo != "bar" || tgt.Number != 99 || tgt.Provider != "github" {
		t.Errorf("unexpected target: %+v", tgt)
	}
}

func TestGitHubMergeState(t *testing.T) {
	f, tr := false, true
	cases := []struct {
		merged    bool
		state     string
		draft     bool
		mergeable *bool
		ms        string
		want      string
	}{
		{merged: true, state: "closed", want: mergeStateMerged},
		{state: "closed", want: mergeStateClosed},
		{state: "open", draft: true, ms: "draft", want: mergeStateDraft},
		{state: "open", mergeable: &f, ms: "dirty", want: mergeStateConflicts},
		{state: "open", mergeable: &f, want: mergeStateConflicts},
		{state: "open", mergeable: &tr, ms: "behind", want: mergeStateBehind},
		{state: "open", mergeable: &tr, ms: "blocked", want: mergeStateBlocked},
		{state: "open", mergeable: &tr, ms: "unstable", want: mergeStateUnstable},
		{state: "open", mergeable: &tr, ms: "clean", want: mergeStateClean},
		{state: "open", mergeable: &tr, ms: "has_hooks", want: mergeStateClean},
		{state: "open", ms: "unknown", want: mergeStateUnknown},
		{state: "open", want: mergeStateUnknown},
	}
	for _, c := range cases {
		if got, _ := githubMergeState(c.merged, c.state, c.draft, c.mergeable, c.ms, "main"); got != c.want {
			t.Errorf("githubMergeState(%+v) = %q, want %q", c, got, c.want)
		}
	}
}

func TestFetchMergeStatusMethods(t *testing.T) {
	orig := githubHTTPClient.Transport
	defer func() { githubHTTPClient.Transport = orig }()
	githubHTTPClient.Transport = forgetest.RoundTripperFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"state":"open","mergeable":true,"mergeable_state":"clean","base":{"ref":"main"},"head":{"sha":"abc123"}}`
		if req.URL.Path == "/repos/o/r" {
			body = `{"allow_merge_commit":true,"allow_squash_merge":true,"allow_rebase_merge":false,"permissions":{"push":true}}`
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})
	st, err := fetchMergeStatus(context.Background(), "o", "r", 7, "tok")
	if err != nil {
		t.Fatal(err)
	}
	if st.State != mergeStateClean || !st.CanMerge || st.HeadSHA != "abc123" {
		t.Fatalf("status = %+v", st)
	}
	if strings.Join(st.Methods, ",") != "merge,squash" {
		t.Fatalf("methods = %v, want merge,squash (rebase disallowed on the repo)", st.Methods)
	}
}

func TestMergePRRequestAndErrors(t *testing.T) {
	orig := githubHTTPClient.Transport
	defer func() { githubHTTPClient.Transport = orig }()
	var got map[string]string
	status := http.StatusOK
	githubHTTPClient.Transport = forgetest.RoundTripperFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPut || req.URL.Path != "/repos/o/r/pulls/7/merge" {
			t.Errorf("unexpected request %s %s", req.Method, req.URL.Path)
		}
		got = nil
		json.NewDecoder(req.Body).Decode(&got)
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(`{"sha":"m1","merged":true,"message":"Head branch was modified"}`)), Header: make(http.Header)}, nil
	})

	res, err := mergePR(context.Background(), "o", "r", 7, "tok", PRMergeRequest{Method: MergeMethodSquash, Title: "Add x (#7)", Message: "body", HeadSHA: "abc"})
	if err != nil || res.SHA != "m1" {
		t.Fatalf("merge = %+v, %v", res, err)
	}
	if got["merge_method"] != "squash" || got["sha"] != "abc" || got["commit_title"] != "Add x (#7)" || got["commit_message"] != "body" {
		t.Fatalf("payload = %v", got)
	}

	// A rebase writes no commit of its own: no title or message is sent.
	if _, err := mergePR(context.Background(), "o", "r", 7, "tok", PRMergeRequest{Method: MergeMethodRebase, Title: "ignored", HeadSHA: "abc"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["commit_title"]; ok {
		t.Fatalf("rebase payload carries a title: %v", got)
	}

	status = http.StatusConflict
	if _, err := mergePR(context.Background(), "o", "r", 7, "tok", PRMergeRequest{Method: MergeMethodMerge, HeadSHA: "abc"}); !errors.Is(err, ErrPRHeadMoved) {
		t.Fatalf("409: err = %v, want ErrPRHeadMoved", err)
	}
	status = http.StatusMethodNotAllowed
	if _, err := mergePR(context.Background(), "o", "r", 7, "tok", PRMergeRequest{Method: MergeMethodMerge}); !errors.Is(err, ErrPRNotMergeable) {
		t.Fatalf("405: err = %v, want ErrPRNotMergeable", err)
	}
}
