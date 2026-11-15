package forge

import (
	"testing"

	"faah/internal/pr/prtest"
)

func TestDetectPRURL(t *testing.T) {
	cases := []struct {
		arg         string
		wantOK      bool
		owner, repo string
		num         int
	}{
		{arg: "https://github.com/px0-ai/px0/pull/42", wantOK: true, owner: "px0-ai", repo: "px0", num: 42},
		{arg: "http://github.com/px0-ai/px0/pull/7", wantOK: true, owner: "px0-ai", repo: "px0", num: 7},
		{arg: "github.com/px0-ai/px0/pull/1", wantOK: true, owner: "px0-ai", repo: "px0", num: 1},
		{arg: "https://github.com/px0-ai/px0.git/pull/99", wantOK: true, owner: "px0-ai", repo: "px0", num: 99},
		// Bare numbers must NOT be accepted as PR targets
		{arg: "42", wantOK: false},
		{arg: "123", wantOK: false},
		// File paths must NOT be accepted
		{arg: "src/main.go", wantOK: false},
		{arg: ".", wantOK: false},
		// Non-PR GitHub URLs must NOT be accepted
		{arg: "https://github.com/px0-ai/px0", wantOK: false},
		{arg: "https://github.com/px0-ai/px0/issues/42", wantOK: false},
		// Invalid / empty
		{arg: "not a url", wantOK: false},
		{arg: "", wantOK: false},
	}
	for _, c := range cases {
		p, target, ok := DetectPRURL(c.arg)
		if ok != c.wantOK {
			t.Errorf("DetectPRURL(%q) ok = %v, want %v", c.arg, ok, c.wantOK)
			continue
		}
		if !ok {
			continue
		}
		if p.Name() != "github" {
			t.Errorf("DetectPRURL(%q) provider = %q, want github", c.arg, p.Name())
		}
		if target.Owner != c.owner || target.Repo != c.repo || target.Number != c.num {
			t.Errorf("DetectPRURL(%q) = (%q, %q, %d), want (%q, %q, %d)", c.arg, target.Owner, target.Repo, target.Number, c.owner, c.repo, c.num)
		}
	}
}

func TestParsePRURLUnsupported(t *testing.T) {
	if _, _, ok := DetectPRURL("42"); ok {
		t.Error("expected false parsing bare number as PR URL")
	}
	if _, _, ok := DetectPRURL("https://example.com/foo/bar"); ok {
		t.Error("expected false for unsupported forge URL")
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
	if p := ForRemote("git@gitlab.com:a/b.git"); p == nil || p.Name() != "gitlab" {
		t.Errorf("forge.ForRemote(gitlab) = %v", p)
	}
	if p := ForRemote("https://github.com/a/b"); p == nil || p.Name() != "github" {
		t.Errorf("forge.ForRemote(github) = %v", p)
	}
	if p := ForRemote("https://example.com/a/b.git"); p != nil {
		t.Errorf("forge.ForRemote(unknown) = %v", p.Name())
	}
}

func TestRemoteMatchesRepo(t *testing.T) {
	cases := []struct {
		origin string
		want   bool
	}{
		{"git@github.com:px0-ai/px0.git\n", true},
		{"https://github.com/PX0-AI/px0", true},
		{"ssh://git@github.com/px0-ai/px0.git", true},
		{"https://github.com/px0-ai/px0-docs.git", false},
		{"https://github.com/other/px0.git", false},
	}
	for _, c := range cases {
		if got := remoteMatchesRepo(c.origin, "px0-ai", "px0"); got != c.want {
			t.Errorf("%q: got %v", c.origin, got)
		}
	}
}
func TestFindPRRemotePrefersOriginThenUpstream(t *testing.T) {
	fork := prtest.RepoWithRemotes(t, map[string]string{
		"origin":   "git@github.com:me/px0.git",
		"upstream": "https://github.com/px0-ai/px0.git",
	})
	if top, remote := FindRemote(fork, "px0-ai", "px0"); top != fork || remote != "upstream" {
		t.Fatalf("fork: %q %q", top, remote)
	}
	both := prtest.RepoWithRemotes(t, map[string]string{
		"origin":   "https://github.com/px0-ai/px0",
		"upstream": "https://github.com/px0-ai/px0.git",
	})
	if _, remote := FindRemote(both, "px0-ai", "px0"); remote != "origin" {
		t.Fatalf("both: %q", remote)
	}
	other := prtest.RepoWithRemotes(t, map[string]string{"origin": "https://github.com/px0-ai/px0-docs.git"})
	if top, _ := FindRemote(other, "px0-ai", "px0"); top != "" {
		t.Fatalf("other repo matched: %q", top)
	}
}
