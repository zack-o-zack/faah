package git

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/git/gittest"
)

func TestGitStageUnstageCommit(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.Repo(t)

	// gittest.Repo leaves add.go staged, and sub/ren.go -> sub/ren2.go staged as a
	// rename (both the old and new path are index entries). Unstage all three
	// so this test controls what's staged from here.
	for _, p := range []string{"add.go", "sub/ren.go", "sub/ren2.go"} {
		if err := Unstage(root, p); err != nil {
			t.Fatalf("gitUnstage %s: %v", p, err)
		}
	}
	if staged := StagedPaths(root); len(staged) != 0 {
		t.Fatalf("expected nothing staged after unstaging, got %v", staged)
	}

	if err := Commit(root, "should fail"); err == nil {
		t.Fatal("expected gitCommit to fail with nothing staged")
	}

	if err := Stage(root, "add.go"); err != nil {
		t.Fatalf("gitStage add.go: %v", err)
	}
	if staged := StagedPaths(root); !staged["add.go"] {
		t.Fatalf("expected add.go staged after gitStage, got %v", staged)
	}

	if err := Commit(root, "commit add.go"); err != nil {
		t.Fatalf("gitCommit: %v", err)
	}
	if staged := StagedPaths(root); staged["add.go"] {
		t.Fatalf("expected add.go no longer staged after commit, got %v", staged)
	}
	if !HasUncommittedChanges(root) {
		t.Fatal("expected the repo's other dirty files to still show uncommitted changes")
	}
}

func TestGitStagedDiffTruncation(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	dir := t.TempDir()
	gittest.Run(t, dir, "init", "-b", "main")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, dir, "config", cfg[0], cfg[1])
	}
	os.WriteFile(filepath.Join(dir, "init.txt"), []byte("init\n"), 0o644)
	gittest.Run(t, dir, "add", "init.txt")
	gittest.Run(t, dir, "commit", "-m", "init")

	// Write a 50 KB file (> 32 KB limit)
	var large bytes.Buffer
	for i := 0; i < 2000; i++ {
		fmt.Fprintf(&large, "line %04d: lots of content to make the diff exceed the 32KB cap\n", i)
	}
	os.WriteFile(filepath.Join(dir, "large.txt"), large.Bytes(), 0o644)
	gittest.Run(t, dir, "add", "large.txt")

	diff := StagedDiff(dir)
	if !strings.Contains(diff, "[Diff truncated: showing first 32KB") {
		t.Fatalf("expected diff to be truncated with notice, got %d bytes without notice", len(diff))
	}
	// The diff output should be around 32KB + truncation message
	if len(diff) > 34*1024 {
		t.Fatalf("diff size %d exceeded expected bound", len(diff))
	}
}

func TestGitApplyHunk(t *testing.T) {
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
	file := filepath.Join(root, "a.txt")
	if err := os.WriteFile(file, []byte("one\ntwo\nthree\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("init")
	run("config", "user.email", "t@example.com")
	run("config", "user.name", "T")
	run("config", "commit.gpgsign", "false")
	run("add", "a.txt")
	run("commit", "-qm", "init")

	if err := os.WriteFile(file, []byte("one\nTWO\nthree\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	hunk := "@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n"
	if err := ApplyHunk(root, "a.txt", hunk, "stage"); err != nil {
		t.Fatalf("stage hunk: %v", err)
	}
	_, staged, _, _ := StatusAndStagedAgainst(root, "", "")
	if !staged["a.txt"] {
		t.Fatalf("expected a.txt to be staged after gitApplyHunk(stage)")
	}
	if err := ApplyHunk(root, "a.txt", hunk, "unstage"); err != nil {
		t.Fatalf("unstage hunk: %v", err)
	}
	_, staged, _, _ = StatusAndStagedAgainst(root, "", "")
	if staged["a.txt"] {
		t.Fatalf("expected a.txt to be unstaged after gitApplyHunk(unstage)")
	}
	if err := ApplyHunk(root, "a.txt", hunk, "discard"); err != nil {
		t.Fatalf("discard hunk: %v", err)
	}
	got, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "one\ntwo\nthree\n" {
		t.Fatalf("got %q after discard, want original content", string(got))
	}
}

func TestGitStagedFilesStatAndDiff(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	dir := t.TempDir()
	// macOS TempDir lives under /var -> /private/var; git reports the real path.
	if r, err := filepath.EvalSymlinks(dir); err == nil {
		dir = r
	}
	gittest.Run(t, dir, "init", "-b", "main")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, dir, "config", cfg[0], cfg[1])
	}
	// Initial commit
	os.WriteFile(filepath.Join(dir, "init.txt"), []byte("init\n"), 0o644)
	gittest.Run(t, dir, "add", "init.txt")
	gittest.Run(t, dir, "commit", "-m", "init")

	// Stage a code file and a lockfile
	os.WriteFile(filepath.Join(dir, "app.go"), []byte("package main\n\nfunc main() {}\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "package-lock.json"), []byte("{\n  \"name\": \"dummy-lockfile\",\n  \"version\": \"1.0.0\"\n}\n"), 0o644)
	gittest.Run(t, dir, "add", "app.go", "package-lock.json")

	files := StagedFiles(dir)
	if len(files) != 2 {
		t.Fatalf("expected 2 staged files, got %d: %v", len(files), files)
	}
	hasApp := false
	hasLock := false
	for _, f := range files {
		if f == "app.go" {
			hasApp = true
		}
		if f == "package-lock.json" {
			hasLock = true
		}
	}
	if !hasApp || !hasLock {
		t.Fatalf("staged files missing expected entries: %v", files)
	}

	stat := StagedStat(dir)
	if !strings.Contains(stat, "app.go") || !strings.Contains(stat, "package-lock.json") {
		t.Fatalf("diffstat missing expected files:\n%s", stat)
	}

	// Staged diff should exclude package-lock.json because app.go has changes
	diff := StagedDiff(dir)
	if !strings.Contains(diff, "app.go") {
		t.Fatalf("diff expected to contain app.go diff:\n%s", diff)
	}
	if strings.Contains(diff, "package-lock.json") {
		t.Fatalf("diff expected to exclude package-lock.json when other changes exist:\n%s", diff)
	}

	// Commit app.go, leaving only package-lock.json staged: should fall back to showing package-lock.json
	gittest.Run(t, dir, "commit", "-m", "commit app.go", "app.go")
	diffOnlyLock := StagedDiff(dir)
	if !strings.Contains(diffOnlyLock, "package-lock.json") {
		t.Fatalf("diff expected to fallback to package-lock.json when only lockfiles staged:\n%s", diffOnlyLock)
	}
}
