package git

import (
	"strings"
	"testing"

	"faah/internal/git/gittest"
)

func TestGithubAuthorURL(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	dir := t.TempDir()
	gittest.Run(t, dir, "init", "-b", "main")

	// No remote at all: no link, never a broken one.
	if got := githubAuthorURL(dir, "a@b.com", "A"); got != "" {
		t.Fatalf("expected no author URL without a remote, got %q", got)
	}

	gittest.Run(t, dir, "remote", "add", "origin", "git@github.com:alice/my-repo.git")
	// A noreply address is a login outright.
	if got := githubAuthorURL(dir, "12345+octocat@users.noreply.github.com", "Octo"); got != "https://github.com/octocat" {
		t.Fatalf("expected a profile link for a noreply address, got %q", got)
	}
	if got := githubAuthorURL(dir, "octocat@users.noreply.github.com", "Octo"); got != "https://github.com/octocat" {
		t.Fatalf("expected a profile link for a legacy noreply address, got %q", got)
	}
	// Anything else can only be "this repo's commits by this address".
	got := githubAuthorURL(dir, "alice@example.com", "Alice")
	if !strings.Contains(got, "github.com/alice/my-repo/commits?author=alice%40example.com") {
		t.Fatalf("expected an author-scoped commits link, got %q", got)
	}

	// A non-GitHub remote gets nothing rather than a GitHub URL for a GitLab repo.
	gittest.Run(t, dir, "remote", "set-url", "origin", "git@gitlab.com:alice/my-repo.git")
	if got := githubAuthorURL(dir, "alice@example.com", "Alice"); got != "" {
		t.Fatalf("expected no author URL for a non-GitHub remote, got %q", got)
	}
}
func TestRemoteHostPath(t *testing.T) {
	cases := []struct {
		raw, host, path string
		ok              bool
	}{
		{"git@github.com:alice/repo.git", "github.com", "alice/repo", true},
		{"ssh://git@gitlab.com/alice/repo.git", "gitlab.com", "alice/repo", true},
		{"https://token@github.com/alice/repo.git", "github.com", "alice/repo", true},
		{"http://git.example.com/alice/repo", "git.example.com", "alice/repo", true},
		{"/srv/git/repo.git", "", "", false},
		{"", "", "", false},
	}
	for _, c := range cases {
		host, path, ok := remoteHostPath(c.raw)
		if ok != c.ok || host != c.host || path != c.path {
			t.Fatalf("remoteHostPath(%q) = (%q, %q, %v), want (%q, %q, %v)",
				c.raw, host, path, ok, c.host, c.path, c.ok)
		}
	}
}
