package review

import (
	"faah/internal/git"
	"faah/internal/git/gittest"
	"strings"
	"testing"
)

func TestWalkthroughWhitespace(t *testing.T) {
	root := gittest.Repo(t)
	gittest.Run(t, root, "reset", "--hard", "HEAD")
	gittest.Run(t, root, "clean", "-fd")
	writeWalkFile(t, root, "mixed.go", "start\n\nold\nend\n")
	writeWalkFile(t, root, "indent.go", "value\n")
	writeWalkFile(t, root, "old.go", strings.Repeat("unchanged line\n", 20)+"value\n")
	gittest.Run(t, root, "add", "-A")
	gittest.Run(t, root, "commit", "-qm", "base")
	writeWalkFile(t, root, "mixed.go", "start\nnew\nend\n")
	writeWalkFile(t, root, "indent.go", "    value\n")
	gittest.Run(t, root, "mv", "old.go", "new.go")
	writeWalkFile(t, root, "new.go", strings.Repeat("unchanged line\n", 20)+"    value\n")
	gittest.Run(t, root, "add", "new.go")
	gittest.Run(t, root, "add", "-A")
	gittest.Run(t, root, "commit", "-qm", "PR whitespace changes")
	statuses := map[string]string{"mixed.go": "M", "indent.go": "M", "old.go": "D", "new.go": "A"}
	exact := BuildWalkthrough(WalkthroughOptions{Root: root, DiffBase: "HEAD~1", DiffHead: "HEAD", Statuses: statuses, IgnoreWhitespace: false})
	if exact.HiddenWhitespaceFiles != 0 || exact.TotalFiles != 3 {
		t.Fatalf("exact: %+v", exact)
	}
	for _, f := range exact.Files {
		paths := []string{f.Path}
		if f.OldPath != "" {
			paths = append(paths, f.OldPath)
		}
		if f.Diff != git.DiffPaths(root, "HEAD~1", "HEAD", paths...) {
			t.Fatalf("default changed %s", f.Path)
		}
	}
	filtered := BuildWalkthrough(WalkthroughOptions{Root: root, DiffBase: "HEAD~1", DiffHead: "HEAD", Statuses: statuses, IgnoreWhitespace: true})
	if filtered.HiddenWhitespaceFiles != 1 || filtered.TotalFiles != 2 {
		t.Fatalf("filtered: %+v", filtered)
	}
	for _, f := range filtered.Files {
		if f.Path == "new.go" {
			if f.Status != "R" || f.Diff != "" || len(f.Hunks) != 0 {
				t.Fatalf("move: %+v", f)
			}
			continue
		}
		if f.Path != "mixed.go" {
			t.Fatalf("unexpected file: %+v", f)
		}
		found := false
		for _, h := range f.Hunks {
			for _, row := range h.Rows {
				if row.Type == "del" && strings.TrimSpace(row.Text) == "" {
					t.Fatal("blank deletion retained")
				}
				if row.Type == "add" && row.Text == "new" {
					found = true
					if row.NewLine != 2 {
						t.Fatalf("line: %d", row.NewLine)
					}
				}
			}
		}
		if !found {
			t.Fatal("real edit lost")
		}
	}
}
