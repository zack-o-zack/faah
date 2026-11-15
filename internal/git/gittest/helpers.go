package gittest

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func Installed() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

// Repo builds a real repository under a fresh temp dir: keep/mod/del/ren are
// committed, then the tree is dirtied (modify, stage-new, untrack, delete,
// rename) so every status code is exercised. Returns the served root.
func Repo(tb testing.TB) string {
	tb.Helper()
	if testing.Short() {
		tb.Skip("skipping git integration test in short mode")
	}
	root := tb.TempDir()
	// macOS TempDir lives under /var -> /private/var; git reports the real path.
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	write := func(rel, body string) {
		p := filepath.Join(root, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			tb.Fatal(err)
		}
	}
	run := func(args ...string) { Run(tb, root, args...) }
	write("keep.go", "keep\n")
	write("sub/mod.go", "line one\n")
	write("del.go", "del\n")
	write("sub/ren.go", "old\n")
	run("init")
	run("config", "user.email", "t@example.com")
	run("config", "user.name", "T")
	run("config", "commit.gpgsign", "false")
	run("add", "-A")
	run("commit", "-qm", "init")
	// Dirty it: modify, stage a new file, leave one untracked, delete, rename.
	write("sub/mod.go", "line two\n")
	write("add.go", "added\n")
	run("add", "add.go")
	write("untr.go", "untracked\n")
	os.Remove(filepath.Join(root, "del.go"))
	run("mv", "sub/ren.go", "sub/ren2.go")
	return root
}

// Command prepares a fixture git command with an explicit directory and no
// inherited repository or configuration overrides. Callers can inspect expected
// failures themselves; Run is the usual choice for successful commands.
func Command(tb testing.TB, dir string, args ...string) *exec.Cmd {
	tb.Helper()
	if dir == "" {
		tb.Fatal("empty git fixture directory")
	}
	if testing.Short() {
		tb.Skip("skipping git integration test in short mode")
	}
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR":
			continue
		}
		if strings.HasPrefix(key, "GIT_CONFIG") {
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+filepath.Join(tb.TempDir(), "config"))
	return cmd
}

// Run runs a git command in dir with a hermetic config, failing the test on error.
func Run(tb testing.TB, dir string, args ...string) string {
	tb.Helper()
	out, err := Command(tb, dir, args...).CombinedOutput()
	if err != nil {
		tb.Fatalf("git %v (in %s): %v\n%s", args, dir, err, out)
	}
	return string(out)
}

// UnpushedRepo builds a clone with an upstream and two unpushed commits on top
// of it: the first modifies one file, deletes another and adds a third; the
// second appends a line. Returns the clone's root.
func UnpushedRepo(tb testing.TB) string {
	tb.Helper()
	base := tb.TempDir()
	if r, err := filepath.EvalSymlinks(base); err == nil {
		base = r
	}
	remote := filepath.Join(base, "remote.git")
	clone := filepath.Join(base, "work")
	if err := os.MkdirAll(remote, 0o755); err != nil {
		tb.Fatal(err)
	}
	Run(tb, remote, "init", "--bare", "-b", "main")
	Run(tb, base, "clone", remote, "work")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		Run(tb, clone, "config", cfg[0], cfg[1])
	}
	write := func(rel, body string) {
		tb.Helper()
		p := filepath.Join(clone, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			tb.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			tb.Fatal(err)
		}
	}

	write("a.txt", "one\ntwo\nthree\n")
	write("gone.txt", "bye\n")
	Run(tb, clone, "add", "-A")
	Run(tb, clone, "commit", "-qm", "pushed commit")
	Run(tb, clone, "push", "-q", "-u", "origin", "main")

	write("a.txt", "one\nTWO\nthree\n")
	write("added.txt", "new\n")
	Run(tb, clone, "rm", "-q", "gone.txt")
	Run(tb, clone, "add", "-A")
	Run(tb, clone, "commit", "-qm", "local one\n\nBody of the first local commit.")

	write("a.txt", "one\nTWO\nthree\nfour\n")
	Run(tb, clone, "add", "-A")
	Run(tb, clone, "commit", "-qm", "local two")
	return clone
}
