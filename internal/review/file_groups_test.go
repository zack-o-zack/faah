package review

import (
	"encoding/json"
	"faah/internal/git"
	"faah/internal/git/gittest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeWalkFile(t *testing.T, root, path, body string) {
	t.Helper()
	p := filepath.Join(root, path)
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestWalkthroughGroups(t *testing.T) {
	root := gittest.Repo(t)
	gittest.Run(t, root, "reset", "--hard", "HEAD")
	gittest.Run(t, root, "clean", "-fd")
	cases := map[string][]string{
		"core":      {"src/z.go", "src/a.ts", "lib/main.rs", "app.swift"},
		"tests":     {"src/a_test.go", "src/b.spec.ts", "test_a.py", "testdata/sample.md", "tests/config.yaml"},
		"config":    {"package.json", "go.mod", ".env.local", ".github/workflows/ci.yml", "Dockerfile.dev"},
		"docs":      {"README", "docs/config.yaml", "guide.mdx", "LICENSE-MIT", "notes.txt"},
		"generated": {"package-lock.json", "vendor/foo_test.go", "dist/a.js", "a.pb.go", "a.snap"},
	}
	statuses := map[string]string{}
	wants := map[string]string{}
	for group, paths := range cases {
		for _, path := range paths {
			writeWalkFile(t, root, path, "new\n")
			statuses[path] = "A"
			wants[path] = group
		}
	}
	gittest.Run(t, root, "add", "-A")
	response := BuildWalkthrough(WalkthroughOptions{Root: root, DiffBase: "HEAD", DiffHead: "", IsPR: false, Statuses: statuses, IgnoreWhitespace: false})
	data, _ := json.Marshal(response)
	var decoded struct {
		Files []struct{ Path, Group string }
	}
	json.Unmarshal(data, &decoded)
	if len(decoded.Files) != len(wants) {
		t.Fatalf("files: %s", data)
	}
	ranks := map[string]int{"core": 0, "tests": 1, "config": 2, "docs": 3, "generated": 4}
	for i, f := range decoded.Files {
		if f.Group != wants[f.Path] {
			t.Errorf("%s group = %q, want %q", f.Path, f.Group, wants[f.Path])
		}
		if i > 0 {
			prev := decoded.Files[i-1]
			if ranks[prev.Group] > ranks[f.Group] || prev.Group == f.Group && prev.Path > f.Path {
				t.Errorf("order: %s before %s", prev.Path, f.Path)
			}
		}
	}
}

func TestWalkthroughMoves(t *testing.T) {
	for _, mode := range []string{"pr", "pr-relative", "fallback", "staged"} {
		for _, edit := range []bool{false, true} {
			t.Run(mode+map[bool]string{false: "/pure", true: "/edited"}[edit], func(t *testing.T) {
				root := gittest.Repo(t)
				gittest.Run(t, root, "reset", "--hard", "HEAD")
				gittest.Run(t, root, "clean", "-fd")
				writeWalkFile(t, root, "old.go", strings.Repeat("unchanged line\n", 20)+"before\n")
				gittest.Run(t, root, "add", "-A")
				gittest.Run(t, root, "commit", "-qm", "base")
				base := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
				gittest.Run(t, root, "mv", "old.go", "new.go")
				if edit {
					writeWalkFile(t, root, "new.go", strings.Repeat("unchanged line\n", 20)+"after\n")
					gittest.Run(t, root, "add", "-A")
				}
				statuses := git.Status(root)
				if mode != "staged" {
					gittest.Run(t, root, "commit", "-qm", "move")
					statuses = nil
				}
				if strings.HasPrefix(mode, "pr") {
					statuses = git.FilesBetween(root, base, "HEAD")
				}
				diffBase := "HEAD"
				if strings.HasPrefix(mode, "pr") {
					diffBase = base
				}
				if mode == "pr-relative" {
					diffBase = "HEAD~1"
				}
				response := BuildWalkthrough(WalkthroughOptions{Root: root, DiffBase: diffBase, DiffHead: "HEAD", IsPR: strings.HasPrefix(mode, "pr"), Statuses: statuses, IgnoreWhitespace: false})
				data, _ := json.Marshal(response)
				var decoded struct {
					Files []struct{ Path, OldPath, Status string }
				}
				json.Unmarshal(data, &decoded)
				if len(decoded.Files) != 1 || decoded.Files[0].Path != "new.go" || decoded.Files[0].OldPath != "old.go" || decoded.Files[0].Status != "R" {
					t.Fatalf("move row: %s", data)
				}
				n := 0
				if edit {
					n = 1
				}
				f := response.Files[0]
				if f.Additions != n || f.Deletions != n || response.TotalAdditions != n || response.TotalDeletions != n {
					t.Fatalf("counts: %s", data)
				}
				if !edit && (len(f.Hunks) != 0 || f.Diff != "") {
					t.Fatalf("pure move hunks: %s", data)
				}
			})
		}
	}
}

func TestWalkthroughBinaryMoves(t *testing.T) {
	for _, mode := range []string{"pr", "fallback"} {
		t.Run(mode, func(t *testing.T) {
			root := gittest.Repo(t)
			gittest.Run(t, root, "reset", "--hard", "HEAD")
			gittest.Run(t, root, "clean", "-fd")
			body := strings.Repeat("binary\x00payload\n", 128)
			writeWalkFile(t, root, "old.bin", body)
			gittest.Run(t, root, "add", "-A")
			gittest.Run(t, root, "commit", "-qm", "base")
			gittest.Run(t, root, "mv", "old.bin", "new.bin")
			writeWalkFile(t, root, "new.bin", body+"changed\x00bytes\n")
			gittest.Run(t, root, "add", "-A")
			gittest.Run(t, root, "commit", "-qm", "move and edit binary")
			var statuses map[string]string
			base := "HEAD"
			if mode == "pr" {
				base = "HEAD~1"
				statuses = git.FilesBetween(root, base, "HEAD")
			}
			response := BuildWalkthrough(WalkthroughOptions{Root: root, DiffBase: base, DiffHead: "HEAD", IsPR: mode == "pr", Statuses: statuses, IgnoreWhitespace: false})
			if len(response.Files) != 1 {
				t.Fatalf("want one renamed binary, got %+v", response.Files)
			}
			f := response.Files[0]
			if f.Path != "new.bin" || f.OldPath != "old.bin" || f.Status != "R" {
				t.Fatalf("rename metadata: %+v", f)
			}
			if f.Diff == "" || !strings.Contains(f.Diff, "Binary files") || len(f.Hunks) != 0 {
				t.Fatalf("want binary diff without text hunks, got %+v", f)
			}
			if f.Additions != 0 || f.Deletions != 0 || response.TotalAdditions != 0 || response.TotalDeletions != 0 {
				t.Fatalf("binary line counts: %+v", response)
			}
		})
	}
}
