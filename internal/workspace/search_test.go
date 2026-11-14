package workspace

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAsciiLowerPreservesLength(t *testing.T) {
	for _, s := range []string{"", "abc", "ABC", "İd", "cafÉ", "日本", "MiXeD123"} {
		var buf []byte
		got := asciiLower(&buf, []byte(s))
		if len(got) != len(s) {
			t.Errorf("asciiLower(%q) changed length %d -> %d", s, len(s), len(got))
		}
		if asciiLowerString(s) != string(got) {
			t.Errorf("string and byte forms disagree for %q", s)
		}
	}
}

func TestSearchContextCancellation(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 20; i++ {
		content := "package main\n\nfunc SearchTarget() {}\n"
		if err := os.WriteFile(filepath.Join(root, "file_"+string(rune('a'+i))+".go"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	ix := NewIndex(root)
	ix.Build()

	// 1. Normal search should find all files
	res, _, err := SearchContext(context.Background(), ix, SearchOpts{Query: "SearchTarget"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res) != 20 {
		t.Fatalf("expected 20 file hits, got %d", len(res))
	}

	// 2. search with already canceled context returns immediately
	ctxCanceled, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err = SearchContext(ctxCanceled, ix, SearchOpts{Query: "SearchTarget"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}

	// 3. search cancelled while in-flight terminates worker goroutines
	ctxTimed, cancelTimed := context.WithTimeout(context.Background(), 10*time.Microsecond)
	defer cancelTimed()
	_, _, err = SearchContext(ctxTimed, ix, SearchOpts{Query: "SearchTarget"})
	if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected cancellation or deadline error, got %v", err)
	}
}

func BenchmarkSearchLiteralInMemory(b *testing.B) {
	root := b.TempDir()
	content := "package main\n\n// TargetSearchToken is here\nfunc TargetSearchToken() string { return \"ok\" }\n"
	for i := 0; i < 20; i++ {
		_ = os.WriteFile(filepath.Join(root, fmt.Sprintf("file_%d.go", i)), []byte(content), 0o644)
	}
	ix := NewIndex(root)
	ix.Build()

	opts := SearchOpts{
		Query:    "TargetSearchToken",
		MaxFiles: 50,
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _, _ = SearchContext(context.Background(), ix, opts)
	}
}

func BenchmarkSearchDefWord(b *testing.B) {
	root := b.TempDir()
	missContent := strings.Repeat("package main\nfunc helperFunc(x int) int { return x + 1 }\n", 50)
	for i := 0; i < 40; i++ {
		_ = os.WriteFile(filepath.Join(root, fmt.Sprintf("miss_%d.go", i)), []byte(missContent), 0o644)
	}
	hitContent := "package main\nfunc TargetSymbolDef() string { return \"ok\" }\n"
	_ = os.WriteFile(filepath.Join(root, "hit.go"), []byte(hitContent), 0o644)

	ix := NewIndex(root)
	ix.Build()

	opts := SearchOpts{
		Query:        "TargetSymbolDef",
		Word:         true,
		Case:         true,
		ClassifyDefs: true,
		MaxFiles:     50,
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _, _ = SearchContext(context.Background(), ix, opts)
	}
}
