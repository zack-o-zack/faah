package review

import (
	"faah/internal/git/gittest"
	"testing"
)

func TestCollectWalkthroughTargets(t *testing.T) {
	root := gittest.Repo(t)
	t.Run("working tree", func(t *testing.T) {
		got := collectWalkthroughTargets(WalkthroughOptions{Root: root, DiffBase: "HEAD", Statuses: map[string]string{"untr.go": "U"}})
		if got.baseRef != "HEAD" || got.headRef != "working-tree" || got.fallback || len(got.files) != 1 || got.files[0].path != "untr.go" || len(got.exactPaths) != 0 {
			t.Fatalf("working tree targets: %+v", got)
		}
	})
	t.Run("pull request", func(t *testing.T) {
		got := collectWalkthroughTargets(WalkthroughOptions{Root: root, DiffBase: "base", DiffHead: "tip", IsPR: true, Statuses: map[string]string{"keep.go": "M"}})
		if got.baseRef != "base" || got.headRef != "tip" || got.fallback || len(got.files) != 1 || got.files[0].status != "M" {
			t.Fatalf("PR targets: %+v", got)
		}
	})
	t.Run("branch base", func(t *testing.T) {
		got := collectWalkthroughTargets(WalkthroughOptions{Root: root, DiffBase: "HEAD", ComparisonBase: "main"})
		if got.baseRef != "HEAD" || got.headRef != "working-tree" || got.fallback || len(got.files) == 0 || len(got.exactPaths) != len(got.files) {
			t.Fatalf("branch targets: %+v", got)
		}
	})
	t.Run("clean tree fallback", func(t *testing.T) {
		got := collectWalkthroughTargets(WalkthroughOptions{Root: root, DiffBase: "HEAD", IgnoreWhitespace: true})
		if got.baseRef != "HEAD~1" || len(got.headRef) != 7 || !got.fallback || len(got.files) == 0 || len(got.exactPaths) != len(got.files) {
			t.Fatalf("fallback targets: %+v", got)
		}
	})
}
