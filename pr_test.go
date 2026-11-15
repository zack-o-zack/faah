package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/forge"
	"faah/internal/git"
	"faah/internal/git/gittest"
	"faah/internal/httpx/httpxtest"
	prpkg "faah/internal/pr"
	"faah/internal/settings"
)

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
	s.pr = prpkg.New(&connectProvider{Provider: forge.ForRemote("https://gitlab.com"), good: "good-token"}, forge.PRTarget{Provider: "gitlab", Host: host, Owner: "g", Repo: "r", Number: 4}, forge.PRMeta{Number: 4}, "", "")
	return s
}

func TestForgeConnectAppliesAndSaves(t *testing.T) {
	s := connectServer(t, "gitlab.example.com")
	w := httpxtest.PostJSON(t, s, "/api/forge/connect", `{"token":"good-token"}`)
	if w.Code != 200 {
		t.Fatalf("connect: %d %s", w.Code, w.Body)
	}
	var res map[string]any
	json.Unmarshal(w.Body.Bytes(), &res)
	if res["saved"] != true || res["validated"] != true || res["writeAccess"] != true {
		t.Errorf("result = %v", res)
	}
	// Live: the running review uses it now, with no restart.
	_, _, token := s.pr.Credentials()
	if token != "good-token" || !s.pr.Snapshot().WriteAccess {
		t.Errorf("session token=%q writeAccess=%v", token, s.pr.Snapshot().WriteAccess)
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
	w := httpxtest.PostJSON(t, s, "/api/forge/connect", `{"token":"bad-token"}`)
	if w.Code != 400 {
		t.Fatalf("bad token accepted: %d %s", w.Code, w.Body)
	}
	if body := w.Body.String(); strings.Contains(body, "bad-token") {
		t.Errorf("error echoes the token: %s", body)
	}
	if cfg := settings.Read(); cfg.GitLabToken != nil || cfg.GitLabHost != nil {
		t.Errorf("rejected token was kept: %v %v", cfg.GitLabToken, cfg.GitLabHost)
	}
	_, _, token := s.pr.Credentials()
	if token != "" {
		t.Errorf("session took a rejected token")
	}
	if w := httpxtest.PostJSON(t, s, "/api/forge/connect", `{"token":"  "}`); w.Code != 400 {
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
	w := httpxtest.PostJSON(t, s, "/api/forge/connect", `{"token":"good-token"}`)
	var res map[string]any
	json.Unmarshal(w.Body.Bytes(), &res)
	if w.Code != 200 || res["saved"] != false {
		t.Fatalf("connect: %d %v", w.Code, res)
	}
	cfg := settings.Read()
	if *cfg.GitLabToken != "corp-token" || *cfg.GitLabHost != "gitlab.corp.io" {
		t.Errorf("other host's token replaced: %v %v", *cfg.GitLabToken, *cfg.GitLabHost)
	}
	_, _, token := s.pr.Credentials()
	if token != "good-token" || s.forgeMeta()["source"] != "session" {
		t.Errorf("session token = %q, source %v", token, s.forgeMeta()["source"])
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
