package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"faah/internal/git/gittest"
)

func TestGitStagedPaths(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.Repo(t)
	staged := StagedPaths(root)
	for _, p := range []string{"add.go", "sub/ren2.go"} {
		if !staged[p] {
			t.Errorf("expected %q to be staged, got %v", p, staged)
		}
	}
	for _, p := range []string{"sub/mod.go", "del.go", "untr.go"} {
		if staged[p] {
			t.Errorf("expected %q to not be staged, got %v", p, staged)
		}
	}
}

func TestGitStatusPartialAfterStaging(t *testing.T) {
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
	write := func(body string) {
		if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("one\n")
	run("init")
	run("config", "user.email", "t@example.com")
	run("config", "user.name", "T")
	run("config", "commit.gpgsign", "false")
	run("add", "a.txt")
	run("commit", "-qm", "init")

	write("two\n")
	run("add", "a.txt")
	_, staged, partial, _ := StatusAndStagedAgainst(root, "", "")
	if !staged["a.txt"] || partial["a.txt"] {
		t.Fatalf("freshly staged: staged=%v partial=%v, want true/false", staged["a.txt"], partial["a.txt"])
	}

	write("three\n")
	_, staged, partial, _ = StatusAndStagedAgainst(root, "", "")
	if !staged["a.txt"] || !partial["a.txt"] {
		t.Fatalf("modified after staging: staged=%v partial=%v, want true/true", staged["a.txt"], partial["a.txt"])
	}

	run("add", "a.txt")
	_, _, partial, _ = StatusAndStagedAgainst(root, "", "")
	if partial["a.txt"] {
		t.Fatalf("restaged: partial still set")
	}
}
func BenchmarkGitStatus(b *testing.B) {
	if !gittest.Installed() {
		b.Skip("git not installed")
	}
	root := gittest.Repo(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Status(root)
	}
}
