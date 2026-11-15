package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/workspace"
)

// A Unicode character whose lowercase form is a different byte length used to
// shift every match offset after it on the same line, so the highlighted span
// drifted. Folding ASCII only keeps offsets exact.
func TestCaseInsensitiveOffsetsWithUnicode(t *testing.T) {
	root := t.TempDir()
	// U+0130 lowercases from two bytes to one under full Unicode folding.
	body := "package x\n\nvar İd = FindUser(name)\n"
	if err := os.WriteFile(filepath.Join(root, "u.go"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	ix := workspace.NewIndex(root)
	ix.Build()
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	code, out := get(t, s, "/api/search?q=finduser")
	if code != http.StatusOK {
		t.Fatalf("search: %d", code)
	}
	res := out["results"].([]any)
	if len(res) != 1 {
		t.Fatalf("got %d files, want 1", len(res))
	}
	m := res[0].(map[string]any)["matches"].([]any)[0].(map[string]any)
	if m["mid"] != "FindUser" {
		t.Errorf("matched text = %q, want %q", m["mid"], "FindUser")
	}
	if m["pre"] != "var İd = " {
		t.Errorf("text before the match = %q, want %q", m["pre"], "var İd = ")
	}
	if m["post"] != "(name)" {
		t.Errorf("text after the match = %q, want %q", m["post"], "(name)")
	}
}

// The include filter has to work for plain names and full paths, not only for
// wildcard patterns. Find-in-file relies on it with an exact path.
func TestSearchGlobFilter(t *testing.T) {
	s, _ := newTestServer(t)

	cases := []struct {
		glob string
		want []string
	}{
		{"", []string{"greet.go", "main.go"}},
		{"greet.go", []string{"greet.go"}}, // plain name, no wildcard
		{"*.go", []string{"greet.go", "main.go"}},
		{"sub/deep.py", nil}, // exact path, no match for this query
		{"nothing.go", nil},
	}
	for _, c := range cases {
		url := "/api/search?q=greet"
		if c.glob != "" {
			url += "&glob=" + c.glob
		}
		code, body := get(t, s, url)
		if code != http.StatusOK {
			t.Fatalf("glob %q: status %d", c.glob, code)
		}
		list, ok := body["results"].([]any)
		if !ok {
			t.Fatalf("glob %q: results is %T, want an array even when empty", c.glob, body["results"])
		}
		var got []string
		for _, r := range list {
			got = append(got, r.(map[string]any)["path"].(string))
		}
		if strings.Join(got, ",") != strings.Join(c.want, ",") {
			t.Errorf("glob %q matched %v, want %v", c.glob, got, c.want)
		}
	}

	// Find-in-file passes the active file's exact path.
	code, body := get(t, s, "/api/search?q=package&glob=sub/deep.py")
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if n := len(body["results"].([]any)); n != 0 {
		t.Errorf("exact-path glob leaked %d other files", n)
	}
	code, body = get(t, s, "/api/search?q=handler&glob=sub/deep.py")
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	res := body["results"].([]any)
	if len(res) != 1 || res[0].(map[string]any)["path"] != "sub/deep.py" {
		t.Errorf("exact-path glob returned %v, want just sub/deep.py", res)
	}
}

func TestHandleSearchWithCanceledRequest(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n\nfunc Hello() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ix := workspace.NewIndex(root)
	ix.Build()
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	req := httptest.NewRequest(http.MethodGet, "/api/search?q=Hello", nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel() // cancel immediately to simulate aborted request
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	s.handleSearch(rec, req)

	// Since context was canceled, handleSearch should return cleanly without writing a 400 error
	if rec.Code == http.StatusBadRequest {
		t.Fatalf("expected canceled search to return quietly, got status %d", rec.Code)
	}
}
