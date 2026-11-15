package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/workspace"
)

func TestIndexHonoursGitignore(t *testing.T) {
	s, _ := newTestServer(t)
	for _, f := range s.ix.Files() {
		if strings.HasPrefix(f.Path, "secret/") {
			t.Errorf("indexed an ignored path: %s", f.Path)
		}
	}
	if n, _, _ := s.ix.Stats(); n != 4 {
		t.Errorf("indexed %d files, want 4", n)
	}
}

// Ignored entries stay visible in the tree, flagged, but out of search.
func TestTreeListsIgnoredEntries(t *testing.T) {
	_, root := newTestServer(t)
	os.MkdirAll(filepath.Join(root, ".git"), 0o755)
	os.WriteFile(filepath.Join(root, ".git", "HEAD"), []byte("ref: refs/heads/main\n"), 0o644)
	ix := workspace.NewIndex(root)
	ix.Build()
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	entries := func(url string) (int, map[string]map[string]any) {
		code, body := get(t, s, url)
		out := map[string]map[string]any{}
		kids, _ := body["children"].([]any)
		for _, k := range kids {
			m := k.(map[string]any)
			out[m["name"].(string)] = m
		}
		return code, out
	}

	_, top := entries("/api/tree?dir=")
	if e := top["secret"]; e == nil || e["ignored"] != true || e["dir"] != true {
		t.Errorf("secret/ = %v, want a listed, ignored directory", e)
	}
	if e := top["main.go"]; e == nil || e["ignored"] != nil {
		t.Errorf("main.go = %v, want listed and not ignored", e)
	}
	if _, ok := top[".git"]; ok {
		t.Error(".git is listed; version control internals should stay hidden")
	}

	code, inside := entries("/api/tree?dir=secret")
	if code != http.StatusOK || inside["keys.go"] == nil || inside["keys.go"]["ignored"] != true {
		t.Errorf("secret listing = %d %v, want keys.go marked ignored", code, inside)
	}
	for _, bad := range []string{"secret/..", "secret/../..", "secret/../../etc", "secret//keys.go"} {
		if code, _ := get(t, s, "/api/tree?dir="+bad); code == http.StatusOK {
			t.Errorf("tree listing for %q returned 200", bad)
		}
	}

	if _, body := get(t, s, "/api/search?q=Token"); body["files"] != float64(0) {
		t.Errorf("workspace search reached an ignored file: %v", body)
	}
	if _, body := get(t, s, "/api/search?q=Token&glob=secret/keys.go"); body["files"] != float64(1) {
		t.Errorf("find-in-file on an open ignored file found %v files, want 1", body["files"])
	}
	if _, body := get(t, s, "/api/search?q=Token&glob=secret/../secret/keys.go"); body["files"] != float64(0) {
		t.Errorf("a glob with .. reached an unindexed file: %v", body)
	}
	if code, _ := get(t, s, "/api/file?path=secret/keys.go"); code != http.StatusOK {
		t.Errorf("opening an ignored file returned %d", code)
	}
}

func TestFindIndexingStatus(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "testfile.txt"), []byte("hello world"), 0o644); err != nil {
		t.Fatal(err)
	}
	ix := workspace.NewIndex(root)
	srv := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	// Before indexing: indexing should be true and files empty
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/find?q=test", nil)
	srv.handleFind(w, req)

	var payload struct {
		Results  []any `json:"results"`
		Indexing bool  `json:"indexing"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode find response: %v", err)
	}
	if !payload.Indexing {
		t.Fatalf("expected indexing: true before build")
	}

	// Build index
	ix.Build()

	// After indexing: indexing should be false and results found
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/api/find?q=testfile", nil)
	srv.handleFind(w2, req2)

	var payload2 struct {
		Results  []any `json:"results"`
		Indexing bool  `json:"indexing"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &payload2); err != nil {
		t.Fatalf("decode find response 2: %v", err)
	}
	if payload2.Indexing {
		t.Fatalf("expected indexing: false after build")
	}
	if len(payload2.Results) == 0 {
		t.Fatalf("expected results after build, got 0")
	}
}

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
	ix := workspace.NewIndex(root)
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
