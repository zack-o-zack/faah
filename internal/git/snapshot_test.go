package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/git/gittest"
)

func TestGitSnapshotAndRestore(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	fileA := filepath.Join(root, "a.go")
	if err := os.WriteFile(fileA, []byte("package a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("init")
	run("config", "user.email", "t@example.com")
	run("config", "user.name", "T")
	run("config", "commit.gpgsign", "false")
	run("add", "a.go")
	run("commit", "-qm", "init")

	// Make a dirty unstaged edit before snapshot
	if err := os.WriteFile(fileA, []byte("package a\n// pre-turn edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	beforeSHA := SnapshotWorktree(root)
	if beforeSHA == "" {
		t.Fatal("gitSnapshotWorktree returned empty SHA")
	}

	// Simulate an agent turn modifying a.go and creating b.go
	fileB := filepath.Join(root, "b.go")
	if err := os.WriteFile(fileA, []byte("package a\n// agent turn edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fileB, []byte("package a\n// new file\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	afterSHA := SnapshotWorktree(root)
	if afterSHA == "" || afterSHA == beforeSHA {
		t.Fatalf("afterSHA = %q, beforeSHA = %q", afterSHA, beforeSHA)
	}

	diffText := DiffBetween(root, "a.go", beforeSHA, afterSHA)
	if !strings.Contains(diffText, "+// agent turn edit") {
		t.Fatalf("unexpected diff between snapshots: diff=%q", diffText)
	}

	// Restore both files to beforeSHA
	if err := RestoreSnapshotPaths(root, beforeSHA, []string{"a.go", "b.go"}); err != nil {
		t.Fatalf("gitRestoreSnapshotPaths: %v", err)
	}
	gotA, err := os.ReadFile(fileA)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotA) != "package a\n// pre-turn edit\n" {
		t.Fatalf("a.go after restore = %q, want pre-turn state", string(gotA))
	}
	if _, err := os.Stat(fileB); !os.IsNotExist(err) {
		t.Fatalf("expected b.go to be removed on restore, got err=%v", err)
	}
}
