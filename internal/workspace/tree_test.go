package workspace

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestChildrenReturnsCopy(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello"), 0o644)
	ix := NewIndex(dir)
	ix.Build()

	kids1, ok := ix.Children("")
	if !ok || len(kids1) == 0 {
		t.Fatalf("expected children at root")
	}

	// Mutating the returned slice must not mutate ix.children
	kids1[0].Dirty = true
	kids1[0].Status = "M"

	kids2, _ := ix.Children("")
	if kids2[0].Dirty != false || kids2[0].Status != "" {
		t.Errorf("ix.Children did not return an isolated copy of node slice")
	}
}

func BenchmarkSortNodes(b *testing.B) {
	base := make([]Node, 64)
	for i := range base {
		base[i] = Node{
			Name: fmt.Sprintf("File_%02d_Component.go", 64-i),
			Path: fmt.Sprintf("pkg/File_%02d_Component.go", 64-i),
			Dir:  i%5 == 0,
		}
	}
	work := make([]Node, len(base))
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		copy(work, base)
		sortNodes(work)
	}
}
