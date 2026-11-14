package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/forge"
	"faah/internal/forge/forgetest"
	"faah/internal/git"
	"faah/internal/git/gittest"
	"faah/internal/settings"
)

func TestPRSessionCloseRefCleanup(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping in short mode")
	}
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	run := func(args ...string) { gittest.Run(t, root, args...) }
	run("init")
	run("config", "user.name", "test")
	run("config", "user.email", "test@test.local")
	run("commit", "--allow-empty", "-m", "initial")

	run("update-ref", "refs/faah/pr/99", "HEAD")
	run("update-ref", "refs/faah/base/99", "HEAD")

	tmpWT := t.TempDir()
	p := &prSession{
		srcRepo:  root,
		worktree: tmpWT,
		meta:     forge.PRMeta{Number: 99},
	}
	p.Close()

	checkRef := gittest.Command(t, root, "rev-parse", "--verify", "refs/faah/pr/99")
	if err := checkRef.Run(); err == nil {
		t.Errorf("refs/faah/pr/99 was not deleted on Close")
	}
	checkBase := gittest.Command(t, root, "rev-parse", "--verify", "refs/faah/base/99")
	if err := checkBase.Run(); err == nil {
		t.Errorf("refs/faah/base/99 was not deleted on Close")
	}
}

// TestPRSessionPullFastForwardAndDiverge exercises prSession.Pull against a
// fake "upstream" (a bare repo standing in for GitHub) with a srcRepo/
// worktree pair set up exactly like checkoutPR's worktree case. A clean
// fast-forward onto a new PR commit must succeed and update meta.HeadSHA; a
// local commit in the worktree that then diverges from a further PR push
// must be refused with errPRDiverged, leaving the worktree untouched.
func TestPRSessionPullFastForwardAndDiverge(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	base := t.TempDir()
	if r, err := filepath.EvalSymlinks(base); err == nil {
		base = r
	}
	upstream := filepath.Join(base, "upstream.git")
	srcRepo := filepath.Join(base, "src")

	if err := os.MkdirAll(upstream, 0o755); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, upstream, "init", "--bare", "-b", "main")

	gittest.Run(t, base, "clone", upstream, "src")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, srcRepo, "config", cfg[0], cfg[1])
	}
	if err := os.WriteFile(filepath.Join(srcRepo, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, srcRepo, "add", "base.txt")
	gittest.Run(t, srcRepo, "commit", "-qm", "base commit")
	gittest.Run(t, srcRepo, "push", "origin", "main")

	// A "PR branch" pushed to upstream as refs/pull/99/head, the way GitHub does.
	gittest.Run(t, srcRepo, "checkout", "-qb", "feature")
	if err := os.WriteFile(filepath.Join(srcRepo, "feature.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, srcRepo, "add", "feature.txt")
	gittest.Run(t, srcRepo, "commit", "-qm", "pr commit 1")
	gittest.Run(t, srcRepo, "push", "origin", "feature:refs/pull/99/head")
	gittest.Run(t, srcRepo, "checkout", "-q", "main")

	// Check out the PR into a worktree, same as checkoutPR does.
	gittest.Run(t, srcRepo, "fetch", "--no-tags", "origin", "refs/pull/99/head:refs/faah/pr/99")
	worktree := filepath.Join(base, "wt")
	gittest.Run(t, srcRepo, "worktree", "add", "--detach", worktree, "refs/faah/pr/99")

	p := &prSession{
		worktree: worktree,
		srcRepo:  srcRepo,
		target:   forge.PRTarget{Owner: "o", Repo: "r"},
		meta:     forge.PRMeta{Number: 99, BaseRef: "main", HeadRef: "feature"},
	}

	// Someone pushes a second commit to the PR head -- Pull should fast-forward cleanly.
	gittest.Run(t, srcRepo, "checkout", "-q", "feature")
	if err := os.WriteFile(filepath.Join(srcRepo, "feature.txt"), []byte("two\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, srcRepo, "commit", "-aqm", "pr commit 2")
	gittest.Run(t, srcRepo, "push", "origin", "feature:refs/pull/99/head")
	gittest.Run(t, srcRepo, "checkout", "-q", "main")

	info, err := p.Pull()
	if err != nil {
		t.Fatalf("expected a clean fast-forward Pull, got %v", err)
	}
	if info == "" {
		t.Error("expected a non-empty info message")
	}
	if got, err := os.ReadFile(filepath.Join(worktree, "feature.txt")); err != nil || string(got) != "two\n" {
		t.Fatalf("expected worktree to fast-forward to %q, got %q, err=%v", "two\n", got, err)
	}
	if p.meta.HeadSHA == "" {
		t.Error("expected Pull to record the new HeadSHA")
	}

	// A local commit in the worktree (as if the reviewer committed a fix)
	// that then diverges from a further PR push must be refused, not merged.
	if err := os.WriteFile(filepath.Join(worktree, "feature.txt"), []byte("local edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, worktree, "commit", "-aqm", "reviewer's local commit")

	gittest.Run(t, srcRepo, "checkout", "-q", "feature")
	if err := os.WriteFile(filepath.Join(srcRepo, "feature.txt"), []byte("three\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, srcRepo, "commit", "-aqm", "pr commit 3")
	gittest.Run(t, srcRepo, "push", "origin", "feature:refs/pull/99/head")
	gittest.Run(t, srcRepo, "checkout", "-q", "main")

	if _, err := p.Pull(); !errors.Is(err, errPRDiverged) {
		t.Fatalf("expected errPRDiverged, got %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(worktree, "feature.txt")); err != nil || string(got) != "local edit\n" {
		t.Fatalf("expected worktree untouched by the refused pull, got %q, err=%v", got, err)
	}
}

// TestPRSessionPush confirms Push sends the worktree's HEAD to the PR's
// actual head branch (meta.HeadRepoCloneURL/HeadRef), not wherever the
// worktree happens to be checked out from.
func TestPRSessionPush(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	base := t.TempDir()
	if r, err := filepath.EvalSymlinks(base); err == nil {
		base = r
	}
	upstream := filepath.Join(base, "upstream.git")
	if err := os.MkdirAll(upstream, 0o755); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, upstream, "init", "--bare", "-b", "main")

	worktree := filepath.Join(base, "wt")
	if err := os.MkdirAll(worktree, 0o755); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, worktree, "init", "-q", "-b", "feature")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, worktree, "config", cfg[0], cfg[1])
	}
	if err := os.WriteFile(filepath.Join(worktree, "f.txt"), []byte("pushed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, worktree, "add", "f.txt")
	gittest.Run(t, worktree, "commit", "-qm", "reviewer commit")

	p := &prSession{
		worktree: worktree,
		target:   forge.PRTarget{Owner: "o", Repo: "r"},
		meta:     forge.PRMeta{Number: 1, HeadRef: "feature", HeadRepoCloneURL: upstream},
	}
	if err := p.Push(false); err != nil {
		t.Fatalf("Push failed: %v", err)
	}

	out := gittest.Run(t, upstream, "log", "--oneline", "-1", "refs/heads/feature")
	if !strings.Contains(out, "reviewer commit") {
		t.Fatalf("expected upstream's refs/heads/feature to carry the pushed commit, got %q", out)
	}
	pushed := strings.TrimSpace(gittest.Run(t, worktree, "rev-parse", "HEAD"))
	if p.meta.HeadSHA != pushed {
		t.Fatalf("Push should move the PR head (meta.HeadSHA) to %s, got %q", pushed, p.meta.HeadSHA)
	}
	if p.remoteHead() != pushed {
		t.Fatalf("remoteHead = %q, want %s", p.remoteHead(), pushed)
	}
}

// TestPRAheadCountsFromPRHead covers the detached-HEAD case: a PR checkout has
// no upstream, so commits made in the IDE must still count as unpushed
// (measured from the PR head), and stop counting once that head moves.
func TestPRAheadCountsFromPRHead(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	gittest.Run(t, root, "init", "-q", "-b", "main")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, root, "config", cfg[0], cfg[1])
	}
	os.WriteFile(filepath.Join(root, "a.txt"), []byte("1\n"), 0o644)
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-qm", "pr commit")
	head := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	gittest.Run(t, root, "checkout", "-q", "--detach")

	if n := git.CountSince(root, head); n != 0 {
		t.Fatalf("fresh checkout: ahead = %d, want 0", n)
	}
	os.WriteFile(filepath.Join(root, "a.txt"), []byte("2\n"), 0o644)
	gittest.Run(t, root, "commit", "-qam", "my change")
	if n := git.CountSince(root, head); n != 1 {
		t.Fatalf("after IDE commit: ahead = %d, want 1", n)
	}
	cs := git.CommitsSince(root, head, 0)
	if len(cs) != 1 || cs[0].Subject != "my change" {
		t.Fatalf("unpushed = %+v", cs)
	}
	head = strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	if n := git.CountSince(root, head); n != 0 {
		t.Fatalf("after push moved the head: ahead = %d, want 0", n)
	}
}

func TestCheckoutPRMergedAlwaysProceeds(t *testing.T) {
	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()

	localRepo := t.TempDir()
	gittest.Run(t, localRepo, "init")
	gittest.Run(t, localRepo, "config", "user.name", "Tester")
	gittest.Run(t, localRepo, "config", "user.email", "test@example.com")
	gittest.Run(t, localRepo, "checkout", "-b", "feature-x")
	os.WriteFile(filepath.Join(localRepo, "f.txt"), []byte("hi"), 0644)
	gittest.Run(t, localRepo, "add", "f.txt")
	gittest.Run(t, localRepo, "commit", "-m", "init")

	http.DefaultTransport = forgetest.RoundTripperFunc(func(req *http.Request) (*http.Response, error) {
		body := fmt.Sprintf(`{
			"number": 77,
			"title": "Already merged PR",
			"state": "closed",
			"merged": true,
			"merged_at": "2026-09-21T08:00:00Z",
			"user": {"login": "bob"},
			"base": {"ref": "main"},
			"head": {
				"ref": "feature-x",
				"sha": "1234567890ab",
				"repo": {"clone_url": %q, "full_name": "px0-ai/px0"}
			}
		}`, localRepo)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	})

	target := forge.PRTarget{Provider: "github", Owner: "px0-ai", Repo: "px0", Number: 77}
	_, err := checkoutPR(context.Background(), &forge.GitHub{}, target, t.TempDir(), nil)
	// Must not be ErrPRMergedCancelled; merged PRs are always opened without blocking.
	if errors.Is(err, ErrPRMergedCancelled) {
		t.Errorf("err = %v, did not want ErrPRMergedCancelled", err)
	}
}

// TestGitFilesBetween is the PR's own file set: what changed between the
// merge-base and the PR head, never what the reviewer committed afterwards.
func TestGitFilesBetween(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	gittest.Run(t, root, "init", "-q", "-b", "main")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, root, "config", cfg[0], cfg[1])
	}
	write := func(name string) { os.WriteFile(filepath.Join(root, name), []byte(name+"\n"), 0o644) }
	write("base.txt")
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-qm", "base")
	base := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	write("pr.txt")
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-qm", "pr")
	head := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	write("mine.txt")
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-qm", "mine")

	got := git.FilesBetween(root, base, head)
	if len(got) != 1 || got["pr.txt"] != "A" {
		t.Fatalf("PR files = %v, want map[pr.txt:A]", got)
	}
}

func TestHTTPSRemoteURL(t *testing.T) {
	for in, want := range map[string]string{
		"git@github.com:o/r.git":          "https://github.com/o/r.git",
		"ssh://git@github.com/o/r.git":    "https://github.com/o/r.git",
		"ssh://git@github.com:22/o/r.git": "https://github.com/o/r.git",
		"https://github.com/o/r.git":      "https://github.com/o/r.git",
		"/tmp/some/local/upstream.git":    "/tmp/some/local/upstream.git",
	} {
		if got := httpsRemoteURL(in); got != want {
			t.Errorf("httpsRemoteURL(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestPRSessionPullFollowsForcePush: a PR branch rewritten upstream is not a
// fast-forward, but with nothing of the reviewer's in the checkout Pull follows
// it instead of leaving stale content behind; with local commits it still refuses.
func TestPRSessionPullFollowsForcePush(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	base := t.TempDir()
	if r, err := filepath.EvalSymlinks(base); err == nil {
		base = r
	}
	upstream := filepath.Join(base, "upstream.git")
	os.MkdirAll(upstream, 0o755)
	gittest.Run(t, upstream, "init", "--bare", "-b", "feature")

	work := filepath.Join(base, "work")
	os.MkdirAll(work, 0o755)
	gittest.Run(t, work, "init", "-q", "-b", "feature")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, work, "config", cfg[0], cfg[1])
	}
	os.WriteFile(filepath.Join(work, "f.txt"), []byte("one\n"), 0o644)
	gittest.Run(t, work, "add", ".")
	gittest.Run(t, work, "commit", "-qm", "one")
	gittest.Run(t, work, "push", "-q", upstream, "feature")

	wt := filepath.Join(base, "wt")
	gittest.Run(t, base, "clone", "-q", upstream, "wt")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, wt, "config", cfg[0], cfg[1])
	}
	head := strings.TrimSpace(gittest.Run(t, wt, "rev-parse", "HEAD"))
	p := &prSession{
		worktree: wt,
		target:   forge.PRTarget{Owner: "o", Repo: "r"},
		meta:     forge.PRMeta{Number: 1, BaseRef: "main", HeadRef: "feature", HeadRepoCloneURL: upstream, HeadSHA: head},
	}

	// Rewrite the PR branch: amend and force-push.
	os.WriteFile(filepath.Join(work, "f.txt"), []byte("rewritten\n"), 0o644)
	gittest.Run(t, work, "commit", "-aqm", "one (amended)", "--amend")
	gittest.Run(t, work, "push", "-qf", upstream, "feature")

	if _, err := p.Pull(); err != nil {
		t.Fatalf("Pull should follow a force-push when nothing local is at stake: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(wt, "f.txt")); string(got) != "rewritten\n" {
		t.Fatalf("worktree still has stale content: %q", got)
	}
	if p.meta.HeadSHA == head {
		t.Fatal("HeadSHA should have moved to the rewritten head")
	}

	// With a local commit in the way, the same situation is refused.
	os.WriteFile(filepath.Join(wt, "f.txt"), []byte("mine\n"), 0o644)
	gittest.Run(t, wt, "commit", "-aqm", "mine")
	os.WriteFile(filepath.Join(work, "f.txt"), []byte("rewritten again\n"), 0o644)
	gittest.Run(t, work, "commit", "-aqm", "again", "--amend")
	gittest.Run(t, work, "push", "-qf", upstream, "feature")
	if _, err := p.Pull(); !errors.Is(err, errPRDiverged) {
		t.Fatalf("expected errPRDiverged with a local commit, got %v", err)
	}
}

// connectProvider is a GitLab provider whose API answers are canned: one
// token is accepted and has push access, everything else is rejected.
type connectProvider struct {
	forge.Provider
	good string
}

func (c *connectProvider) FetchPR(ctx context.Context, t forge.PRTarget, token string) (forge.PRMeta, error) {
	if token != c.good {
		return forge.PRMeta{}, errors.New("gitlab: 401 Unauthorized (token " + token + ")")
	}
	return forge.PRMeta{Number: t.Number}, nil
}

func (c *connectProvider) CheckPushAccess(ctx context.Context, t forge.PRTarget, token string) bool {
	return token == c.good
}

func connectServer(t *testing.T, host string) *Server {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("GITLAB_HOST", "")
	t.Setenv("GITLAB_TOKEN", "")
	t.Setenv("PATH", t.TempDir()) // no glab
	s, _ := newTestServer(t)
	s.pr = &prSession{
		provider: &connectProvider{Provider: forge.ForRemote("https://gitlab.com"), good: "good-token"},
		target:   forge.PRTarget{Provider: "gitlab", Host: host, Owner: "g", Repo: "r", Number: 4},
		meta:     forge.PRMeta{Number: 4},
	}
	return s
}

func TestForgeConnectAppliesAndSaves(t *testing.T) {
	s := connectServer(t, "gitlab.example.com")
	w := postJSON(t, s, "/api/forge/connect", `{"token":"good-token"}`)
	if w.Code != 200 {
		t.Fatalf("connect: %d %s", w.Code, w.Body)
	}
	var res map[string]any
	json.Unmarshal(w.Body.Bytes(), &res)
	if res["saved"] != true || res["validated"] != true || res["writeAccess"] != true {
		t.Errorf("result = %v", res)
	}
	// Live: the running review uses it now, with no restart.
	if s.pr.token != "good-token" || !s.pr.writeAccess {
		t.Errorf("session token=%q writeAccess=%v", s.pr.token, s.pr.writeAccess)
	}
	// Saved, along with the host it belongs to, so the next session finds it.
	cfg := settings.Read()
	if cfg.GitLabToken == nil || *cfg.GitLabToken != "good-token" || cfg.GitLabHost == nil || *cfg.GitLabHost != "gitlab.example.com" {
		t.Errorf("settings = token %v host %v", cfg.GitLabToken, cfg.GitLabHost)
	}
	if tok, src := forge.ForRemote("https://gitlab.com").ResolveToken(cfg, forge.PRTarget{Host: "gitlab.example.com"}); tok != "good-token" || src != "settings" {
		t.Errorf("resolve after connect = %q/%q", tok, src)
	}
	meta := s.forgeMeta()
	if meta["hasToken"] != true || meta["source"] != "settings" {
		t.Errorf("forgeMeta = %v", meta)
	}
}

func TestForgeConnectRejectsBadToken(t *testing.T) {
	s := connectServer(t, "gitlab.com")
	w := postJSON(t, s, "/api/forge/connect", `{"token":"bad-token"}`)
	if w.Code != 400 {
		t.Fatalf("bad token accepted: %d %s", w.Code, w.Body)
	}
	if body := w.Body.String(); strings.Contains(body, "bad-token") {
		t.Errorf("error echoes the token: %s", body)
	}
	if cfg := settings.Read(); cfg.GitLabToken != nil || cfg.GitLabHost != nil {
		t.Errorf("rejected token was kept: %v %v", cfg.GitLabToken, cfg.GitLabHost)
	}
	if s.pr.token != "" {
		t.Errorf("session took a rejected token")
	}
	if w := postJSON(t, s, "/api/forge/connect", `{"token":"  "}`); w.Code != 400 {
		t.Errorf("empty token: %d", w.Code)
	}
}

// A token already saved for one GitLab host is not replaced by connecting to
// another: the new one serves this session only.
func TestForgeConnectKeepsOtherHostsToken(t *testing.T) {
	s := connectServer(t, "gitlab.other.org")
	if err := settings.UpdateMap(map[string]any{"gitlab.token": "corp-token", "gitlab.host": "gitlab.corp.io"}); err != nil {
		t.Fatal(err)
	}
	w := postJSON(t, s, "/api/forge/connect", `{"token":"good-token"}`)
	var res map[string]any
	json.Unmarshal(w.Body.Bytes(), &res)
	if w.Code != 200 || res["saved"] != false {
		t.Fatalf("connect: %d %v", w.Code, res)
	}
	cfg := settings.Read()
	if *cfg.GitLabToken != "corp-token" || *cfg.GitLabHost != "gitlab.corp.io" {
		t.Errorf("other host's token replaced: %v %v", *cfg.GitLabToken, *cfg.GitLabHost)
	}
	if s.pr.token != "good-token" || s.forgeMeta()["source"] != "session" {
		t.Errorf("session token = %q, source %v", s.pr.token, s.forgeMeta()["source"])
	}
}

func TestPRMergeDefaults(t *testing.T) {
	meta := forge.PRMeta{Number: 12, Title: "Add widgets", HeadRef: "widgets"}
	d := prMergeDefaults(meta, []git.UnpushedCommit{{Subject: "second"}, {Subject: "first"}})
	if d[forge.MergeMethodSquash].Title != "Add widgets (#12)" || d[forge.MergeMethodSquash].Message != "* first\n* second" {
		t.Fatalf("squash default = %+v", d[forge.MergeMethodSquash])
	}
	if d[forge.MergeMethodMerge].Title != "Merge pull request #12 from widgets" || d[forge.MergeMethodMerge].Message != "Add widgets" {
		t.Fatalf("merge default = %+v", d[forge.MergeMethodMerge])
	}
}

func TestMergeMessagePrompt(t *testing.T) {
	meta := forge.PRMeta{Number: 3, Title: "Fix race", BaseRef: "main", HeadRef: "fix"}
	p := mergeMessagePrompt(forge.MergeMethodSquash, meta, []git.UnpushedCommit{{Subject: "fixup"}, {Subject: "fix the race"}}, "a.go | 2 +-", "diff --git", "Fix race (#3)", []string{"Follow Conventional Commits", "Mention ticket PX-9"})
	for _, want := range []string{"squash-merging pull request #3", "Follow Conventional Commits", "Mention ticket PX-9", "rewriting", "Fix race (#3)", "- fix the race\n- fixup", "Output ONLY"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q:\n%s", want, p)
		}
	}
}

func TestGitSyncPromptPR(t *testing.T) {
	st := git.SyncState{PR: 9, Branch: "feat", Upstream: "main", Ahead: 2, Behind: 5, OntoRef: "refs/faah/base/9"}
	p := gitSyncPrompt("rebase", st)
	for _, want := range []string{"Pull request #9", "git rebase refs/faah/base/9", "do not run git fetch", "do not push"} {
		if !strings.Contains(p, want) {
			t.Errorf("rebase prompt missing %q:\n%s", want, p)
		}
	}
	if strings.Contains(p, "git fetch refs") {
		t.Errorf("prompt asks the harness to fetch:\n%s", p)
	}
	if p := gitSyncPrompt("merge", st); !strings.Contains(p, `Merge branch 'main' into feat`) || !strings.Contains(p, "refs/faah/base/9") {
		t.Errorf("merge prompt:\n%s", p)
	}
}

// TestPRForcePushAfterRebase covers the PR rebase flow's last step: the
// rebased checkout is detected as rewritten, a plain push is refused, and a
// force-push with lease replaces the PR branch -- unless someone else pushed
// to it meanwhile, in which case the lease refuses and their commit survives.
func TestPRForcePushAfterRebase(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	base := t.TempDir()
	if r, err := filepath.EvalSymlinks(base); err == nil {
		base = r
	}
	cfg := func(dir string) {
		for _, c := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
			gittest.Run(t, dir, "config", c[0], c[1])
		}
	}
	upstream := filepath.Join(base, "upstream.git")
	os.MkdirAll(upstream, 0o755)
	gittest.Run(t, upstream, "init", "-q", "--bare", "-b", "main")

	work := filepath.Join(base, "work")
	os.MkdirAll(work, 0o755)
	gittest.Run(t, work, "init", "-q", "-b", "main")
	cfg(work)
	os.WriteFile(filepath.Join(work, "a.txt"), []byte("a\n"), 0o644)
	gittest.Run(t, work, "add", ".")
	gittest.Run(t, work, "commit", "-qm", "base")
	gittest.Run(t, work, "push", "-q", upstream, "main")
	gittest.Run(t, work, "checkout", "-qb", "feature")
	os.WriteFile(filepath.Join(work, "f.txt"), []byte("f\n"), 0o644)
	gittest.Run(t, work, "add", ".")
	gittest.Run(t, work, "commit", "-qm", "feature")
	gittest.Run(t, work, "push", "-q", upstream, "feature")
	head := strings.TrimSpace(gittest.Run(t, work, "rev-parse", "HEAD"))
	gittest.Run(t, work, "checkout", "-q", "main")
	os.WriteFile(filepath.Join(work, "b.txt"), []byte("b\n"), 0o644)
	gittest.Run(t, work, "add", ".")
	gittest.Run(t, work, "commit", "-qm", "main moves on")
	gittest.Run(t, work, "push", "-q", upstream, "main")

	wt := filepath.Join(base, "wt")
	gittest.Run(t, base, "clone", "-q", "-b", "feature", upstream, "wt")
	cfg(wt)
	gittest.Run(t, wt, "fetch", "-q", upstream, "+refs/heads/main:"+prBaseRef(1))
	p := &prSession{
		worktree: wt,
		target:   forge.PRTarget{Owner: "o", Repo: "r"},
		meta:     forge.PRMeta{Number: 1, BaseRef: "main", HeadRef: "feature", HeadRepoCloneURL: upstream, HeadSHA: head},
	}
	if p.Rewritten() {
		t.Fatal("fresh checkout reported as rewritten")
	}
	if a, b := git.AheadBehindRef(wt, prBaseRef(1)); a != 1 || b != 1 {
		t.Fatalf("ahead/behind base = %d/%d, want 1/1", a, b)
	}

	gittest.Run(t, wt, "rebase", "-q", prBaseRef(1))
	if !p.Rewritten() {
		t.Fatal("rebased checkout not reported as rewritten")
	}
	if err := p.Push(false); err == nil {
		t.Fatal("a plain push of a rebased branch should be refused")
	}

	// Someone else pushes to the PR branch: the lease must refuse.
	other := filepath.Join(base, "other")
	gittest.Run(t, base, "clone", "-q", "-b", "feature", upstream, "other")
	cfg(other)
	os.WriteFile(filepath.Join(other, "o.txt"), []byte("o\n"), 0o644)
	gittest.Run(t, other, "add", ".")
	gittest.Run(t, other, "commit", "-qm", "theirs")
	gittest.Run(t, other, "push", "-q", "origin", "feature")
	theirs := strings.TrimSpace(gittest.Run(t, other, "rev-parse", "HEAD"))
	if err := p.Push(true); err == nil {
		t.Fatal("force-push should be refused by the lease after someone else pushed")
	}
	if got := strings.TrimSpace(gittest.Run(t, upstream, "rev-parse", "refs/heads/feature")); got != theirs {
		t.Fatalf("their commit was overwritten: feature = %s, want %s", got, theirs)
	}

	// Lease on what is actually there (as a pull would): the force-push lands.
	gittest.Run(t, upstream, "update-ref", "refs/heads/feature", head)
	if err := p.Push(true); err != nil {
		t.Fatalf("force-push with a valid lease: %v", err)
	}
	rebased := strings.TrimSpace(gittest.Run(t, wt, "rev-parse", "HEAD"))
	if got := strings.TrimSpace(gittest.Run(t, upstream, "rev-parse", "refs/heads/feature")); got != rebased {
		t.Fatalf("feature = %s, want the rebased head %s", got, rebased)
	}
	if p.Rewritten() || p.meta.HeadSHA != rebased {
		t.Fatalf("after push: rewritten=%v head=%s", p.Rewritten(), p.meta.HeadSHA)
	}
	mainTip := strings.TrimSpace(gittest.Run(t, wt, "rev-parse", prBaseRef(1)))
	if p.diffBase != mainTip {
		t.Fatalf("diffBase = %q, want the new merge-base %s", p.diffBase, mainTip)
	}
}

// Every URL shape routes to exactly its own provider.
func TestForgeURLRouting(t *testing.T) {
	cases := map[string]string{
		"https://github.com/o/r/pull/1":                          "github",
		"https://gitlab.com/g/sub/r/-/merge_requests/2":          "gitlab",
		"https://codeberg.org/o/r/pulls/3":                       "gitea",
		"https://git.example.com/o/r/pulls/4/files":              "gitea",
		"https://bitbucket.org/ws/r/pull-requests/5":             "bitbucket",
		"https://bitbucket.org/ws/r/pull-requests/5/diff":        "bitbucket",
		"https://gitea.example.com/o/r/pulls/6":                  "gitea",
		"https://gitlab.example.com/a/b/c/d/-/merge_requests/77": "gitlab",
	}
	for u, want := range cases {
		p, tg, ok := forge.DetectPRURL(u)
		if !ok || p.Name() != want || tg.Provider != want {
			t.Errorf("%s: routed to %v (ok=%v), want %s", u, p, ok, want)
		}
	}
	for _, bad := range []string{"https://github.com/o/r/pulls/1", "https://bitbucket.org/ws/r", "https://example.com/o/r/pull/1"} {
		if p, _, ok := forge.DetectPRURL(bad); ok {
			t.Errorf("%s: unexpectedly routed to %s", bad, p.Name())
		}
	}
	remotes := map[string]string{
		"git@bitbucket.org:ws/r.git":     "bitbucket",
		"https://codeberg.org/o/r.git":   "gitea",
		"git@gitea.corp.example:o/r.git": "gitea",
		"ssh://git@gitlab.corp.io/o/r":   "gitlab",
		"https://github.com/o/r":         "github",
	}
	for r, want := range remotes {
		if p := forge.ForRemote(r); p == nil || p.Name() != want {
			t.Errorf("forge.ForRemote(%s) = %v, want %s", r, p, want)
		}
	}
}

func TestRemoteMatchesNestedGroups(t *testing.T) {
	cases := []struct {
		remote string
		want   bool
	}{
		{"git@gitlab.com:group/sub/app.git", true},
		{"https://gitlab.com/group/sub/app", true},
		{"ssh://git@gitlab.com:2222/group/sub/app.git", true},
		{"https://gitlab.com/sub/app.git", false},
		{"https://gitlab.com/other/group/sub/app.git", false},
		{"/srv/mirrors/group/sub/app.git", true}, // a local path matches by suffix
	}
	for _, c := range cases {
		if got := remoteMatchesRepo(c.remote, "group/sub", "app"); got != c.want {
			t.Errorf("%q: got %v, want %v", c.remote, got, c.want)
		}
	}
	if p := forge.ForRemote("git@gitlab.com:a/b.git"); p == nil || p.Name() != "gitlab" {
		t.Errorf("forge.ForRemote(gitlab) = %v", p)
	}
	if p := forge.ForRemote("https://github.com/a/b"); p == nil || p.Name() != "github" {
		t.Errorf("forge.ForRemote(github) = %v", p)
	}
	if p := forge.ForRemote("https://example.com/a/b.git"); p != nil {
		t.Errorf("forge.ForRemote(unknown) = %v", p.Name())
	}
}
