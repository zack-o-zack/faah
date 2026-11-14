package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIndexTouchPath(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "existing.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ix := NewIndex(root)
	ix.Build()

	newRel := "sub/added.go"
	newAbs := filepath.Join(root, filepath.FromSlash(newRel))
	if err := os.MkdirAll(filepath.Dir(newAbs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newAbs, []byte("package sub\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ix.TouchPath(newRel)

	files := ix.Files()
	found := false
	for _, f := range files {
		if f.Path == newRel {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected %q in ix.Files() after TouchPath, got %+v", newRel, files)
	}
	subKids, ok := ix.Children("sub")
	if !ok || len(subKids) != 1 || subKids[0].Path != newRel {
		t.Fatalf("expected sub/added.go in ix.Children(\"sub\"), got %+v", subKids)
	}

	// Remove the file and verify TouchPath evicts it.
	if err := os.Remove(newAbs); err != nil {
		t.Fatal(err)
	}
	ix.TouchPath(newRel)
	for _, f := range ix.Files() {
		if f.Path == newRel {
			t.Fatalf("expected %q to be removed from ix.Files() after deletion + TouchPath", newRel)
		}
	}
}
