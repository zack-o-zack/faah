package prtest

import (
	"path/filepath"
	"testing"

	"faah/internal/git/gittest"
)

// RepoWithRemotes makes an empty git repository with the given remotes.
func RepoWithRemotes(t *testing.T, remotes map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	gittest.Run(t, dir, "init", "-q")
	for name, u := range remotes {
		gittest.Run(t, dir, "remote", "add", name, u)
	}
	resolved, _ := filepath.EvalSymlinks(dir)
	return resolved
}
