package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCompactChildrenJoinsSingleFolderChains(t *testing.T) {
	root := t.TempDir()
	for _, f := range []string{"one/two/three/abcd.ts", "docs/a.md", "docs/guide/b.md", "top.txt"} {
		p := filepath.Join(root, filepath.FromSlash(f))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	ix := NewIndex(root)
	ix.Build()

	kids, ok := ix.CompactChildren("", treeViewFilter("all"))
	if !ok {
		t.Fatal("root not indexed")
	}
	got := map[string]string{}
	for _, k := range kids {
		got[k.Name] = k.Path
	}
	if got["one/two/three"] != "one/two/three" {
		t.Errorf("one/two/three not compacted: %v", got)
	}
	if got["docs"] != "docs" {
		t.Errorf("docs holds a file and a folder, so it stays one level: %v", got)
	}
	if got["top.txt"] != "top.txt" {
		t.Errorf("files pass through: %v", got)
	}
	if treeViewFilter("") != nil {
		t.Error("no view means no compacting")
	}
}
