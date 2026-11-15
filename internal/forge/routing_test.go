package forge_test

import (
	"testing"

	"faah/internal/forge"
)

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
