package gittest

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFixturesIsolateGitEnvironment(t *testing.T) {
	for _, fixture := range []struct {
		name  string
		build func(*testing.T) string
	}{
		{"Run", func(t *testing.T) string {
			dir := t.TempDir()
			Run(t, dir, "init")
			Run(t, dir, "config", "user.name", "fixture")
			return dir
		}},
		{"Repo", func(t *testing.T) string { return Repo(t) }},
		{"UnpushedRepo", func(t *testing.T) string { return UnpushedRepo(t) }},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			outer := t.TempDir()
			Run(t, outer, "init")
			config := filepath.Join(outer, ".git", "config")
			before, err := os.ReadFile(config)
			if err != nil {
				t.Fatal(err)
			}
			global := filepath.Join(t.TempDir(), "global")
			if err := os.WriteFile(global, []byte("[user]\n name = enclosing\n"), 0600); err != nil {
				t.Fatal(err)
			}
			for key, value := range map[string]string{
				"GIT_DIR": filepath.Join(outer, ".git"), "GIT_WORK_TREE": outer,
				"GIT_INDEX_FILE": filepath.Join(outer, ".git", "index"), "GIT_COMMON_DIR": filepath.Join(outer, ".git"),
				"GIT_CONFIG": config, "GIT_CONFIG_GLOBAL": global, "GIT_CONFIG_SYSTEM": global,
				"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "user.name", "GIT_CONFIG_VALUE_0": "injected",
				"GIT_CONFIG_PARAMETERS": "'user.name=injected'",
			} {
				t.Setenv(key, value)
			}
			inner := fixture.build(t)
			after, err := os.ReadFile(config)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Errorf("fixture changed enclosing repository config:\nbefore: %s\nafter: %s", before, after)
			}
			if _, err := os.Stat(filepath.Join(inner, ".git", "config")); err != nil {
				t.Errorf("fixture repository missing its own config: %v", err)
			}
			got := strings.TrimSpace(Run(t, inner, "config", "user.name"))
			want := "T"
			if fixture.name == "Run" {
				want = "fixture"
			}
			if got != want {
				t.Errorf("fixture user.name = %q, want %q", got, want)
			}
			gotGlobal, err := os.ReadFile(global)
			if err != nil {
				t.Fatal(err)
			}
			if string(gotGlobal) != "[user]\n name = enclosing\n" {
				t.Errorf("fixture changed global config: %s", gotGlobal)
			}
		})
	}
}

func TestRunRejectsEmptyDirectory(t *testing.T) {
	if os.Getenv("FAAH_EMPTY_GIT_DIR_TEST") == "1" {
		Run(t, "", "--version")
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestRunRejectsEmptyDirectory$")
	cmd.Env = append(os.Environ(), "FAAH_EMPTY_GIT_DIR_TEST=1")
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "empty git fixture directory") {
		t.Fatalf("Run must fail before launching git for an empty directory: err=%v\n%s", err, out)
	}
}

func TestRunBareInitDoesNotChangeEnclosingConfig(t *testing.T) {
	outer := t.TempDir()
	Run(t, outer, "init")
	config := filepath.Join(outer, ".git", "config")
	before, err := os.ReadFile(config)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_DIR", filepath.Join(outer, ".git"))
	inner := t.TempDir()
	Run(t, inner, "init", "--bare")
	after, err := os.ReadFile(config)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatalf("bare fixture reinitialized enclosing repository:\nbefore: %s\nafter: %s", before, after)
	}
	if _, err := os.Stat(filepath.Join(inner, "config")); err != nil {
		t.Fatal(err)
	}
}
