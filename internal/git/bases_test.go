package git

import (
	"faah/internal/git/gittest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestReviewBases(t *testing.T) {
	root := gittest.UnpushedRepo(t)
	gittest.Run(t, root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	gittest.Run(t, root, "branch", "aaa")
	gittest.Run(t, root, "branch", "zzz")
	// Trace only the lister, not fixture setup. Git emits one start line per process.
	trace := filepath.Join(t.TempDir(), "trace")
	t.Setenv("GIT_TRACE", trace)
	got := ListReviewBases(root)
	data, _ := os.ReadFile(trace)
	if strings.Count(string(data), "built-in: git") != 1 {
		t.Fatalf("expected one subprocess: %s", data)
	}
	if got.Current != "main" || got.Upstream != "origin/main" || got.DefaultRemote != "origin/main" {
		t.Fatalf("metadata: %+v", got)
	}
	want := []ReviewBranch{{"aaa", false}, {"main", false}, {"zzz", false}, {"origin/main", true}}
	if !reflect.DeepEqual(got.Branches, want) {
		t.Fatalf("branches: %+v", got.Branches)
	}
	gittest.Run(t, root, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD")
	if got := ListReviewBases(root); got.DefaultRemote != "origin/main" {
		t.Fatalf("fallback: %+v", got)
	}
	gittest.Run(t, root, "checkout", "--detach")
	if got := ListReviewBases(root); got.Current != "" || got.Upstream != "" {
		t.Fatalf("detached: %+v", got)
	}
	root = gittest.Repo(t)
	if got := ListReviewBases(root); got.DefaultRemote != "" || got.Upstream != "" {
		t.Fatalf("no remote: %+v", got)
	}
	if got := ListReviewBases(t.TempDir()); len(got.Branches) != 0 || got.Current != "" {
		t.Fatalf("outside git: %+v", got)
	}
}
