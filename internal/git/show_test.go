package git_test

import (
	"strings"
	"testing"

	"faah/internal/git"
	"faah/internal/git/gittest"
)

func TestShowFile(t *testing.T) {
	root := gittest.Repo(t)
	sha := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	got, err := git.ShowFile(root, sha, "sub/mod.go", 100)
	if err != nil || string(got) != "line one\n" {
		t.Fatalf("%q: %v", got, err)
	}
	for _, tc := range []struct {
		sha, path string
		max       int64
	}{
		{"HEAD", "keep.go", 100}, {sha, "../keep.go", 100}, {sha, "sub/../keep.go", 100},
		{sha, "/keep.go", 100}, {sha, "./keep.go", 100}, {sha, "sub\\mod.go", 100},
		{sha, "missing.go", 100}, {sha, "keep.go", 1}, {sha, "sub", 10000},
	} {
		if _, err := git.ShowFile(root, tc.sha, tc.path, tc.max); err == nil {
			t.Errorf("accepted %+v", tc)
		}
	}
}
