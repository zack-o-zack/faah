package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/render"
	"faah/internal/workspace"
)

func TestFileAndSearchAndDef(t *testing.T) {
	s, _ := newTestServer(t)

	code, body := get(t, s, "/api/file?path=greet.go")
	if code != http.StatusOK {
		t.Fatalf("file: %d %v", code, body)
	}
	if body["lang"] != "Go" {
		t.Errorf("lang = %v, want Go", body["lang"])
	}
	lines := body["lines"].([]any)
	if !strings.Contains(lines[0].(string), "class=k>package") {
		t.Errorf("first line not highlighted: %q", lines[0])
	}

	code, body = get(t, s, "/api/search?q=greet")
	if code != http.StatusOK {
		t.Fatalf("search: %d", code)
	}
	if int(body["files"].(float64)) != 2 {
		t.Errorf("search hit %v files, want 2", body["files"])
	}

	// The declaration, not the call site, must come back as the definition.
	code, body = get(t, s, "/api/def?sym=greet")
	if code != http.StatusOK {
		t.Fatalf("def: %d", code)
	}
	defs := body["defs"].([]any)
	if len(defs) != 1 {
		t.Fatalf("got %d definitions, want 1: %v", len(defs), defs)
	}
	d := defs[0].(map[string]any)
	if d["path"] != "greet.go" || int(d["line"].(float64)) != 5 {
		t.Errorf("definition at %v:%v, want greet.go:5", d["path"], d["line"])
	}

	code, body = get(t, s, "/api/outline?path=sub/deep.py")
	if code != http.StatusOK {
		t.Fatalf("outline: %d", code)
	}
	syms := body["symbols"].([]any)
	if len(syms) != 1 || syms[0].(map[string]any)["name"] != "handler" {
		t.Errorf("outline = %v, want one symbol named handler", syms)
	}
}

func TestChunkedReadsCoverWholeFile(t *testing.T) {
	root := t.TempDir()
	var sb strings.Builder
	for i := 0; i < 4321; i++ {
		sb.WriteString("x := ")
		sb.WriteString(strings.Repeat("a", i%17))
		sb.WriteString("\n")
	}
	os.WriteFile(filepath.Join(root, "big.go"), []byte(sb.String()), 0o644)
	ix := workspace.NewIndex(root)
	ix.Build()
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	var all []string
	for start := 0; ; start += render.ChunkLines {
		_, body := get(t, s, "/api/file?path=big.go&start="+itoa(start))
		total := int(body["total"].(float64))
		for _, l := range body["lines"].([]any) {
			all = append(all, l.(string))
		}
		if start+render.ChunkLines >= total {
			if len(all) != total {
				t.Fatalf("chunked reads produced %d lines, want %d", len(all), total)
			}
			break
		}
	}
	if !strings.Contains(all[0], ":=") {
		t.Errorf("line 1 lost content: %q", all[0])
	}
	if !strings.Contains(all[4320], ":=") {
		t.Errorf("last line lost content: %q", all[4320])
	}
}

func TestCloseEndpoint(t *testing.T) {
	s, root := newTestServer(t)

	// 1. Open file to ensure it is in highlight cache
	code, body := get(t, s, "/api/file?path=greet.go")
	if code != http.StatusOK {
		t.Fatalf("file: %d %v", code, body)
	}
	abs := filepath.Join(root, "greet.go")

	// 2. Call /api/close?path=greet.go
	code, body = get(t, s, "/api/close?path=greet.go")
	if code != http.StatusOK {
		t.Fatalf("close: %d %v", code, body)
	}
	if body["ok"] != true {
		t.Errorf("expected ok: true, got %v", body)
	}

	// 3. Verify evicted from cache
	if render.Evict(abs) {
		t.Fatal("expected greet.go to be evicted from highlight cache after /api/close")
	}

	// 4. Bad path returns 400
	code, _ = get(t, s, "/api/close?path=../../nonexistent")
	if code != http.StatusBadRequest {
		t.Errorf("expected 400 for bad path, got %d", code)
	}
}

func TestSetRawHeaders(t *testing.T) {
	cases := []struct {
		path            string
		wantContentType string
		wantFilename    string
	}{
		{"index.html", "application/octet-stream", "index.html"},
		{"app.js", "application/octet-stream", "app.js"},
		{"main.go", "application/octet-stream", "main.go"},
		{"nested/path/theme.css", "application/octet-stream", "theme.css"},
		{"assets/logo.png", "image/png", "logo.png"},
		{"assets/photo.jpg", "image/jpeg", "photo.jpg"},
		{"assets/anim.gif", "image/gif", "anim.gif"},
		{"assets/vector.svg", "image/svg+xml", "vector.svg"},
		{"assets/icon.ico", "image/x-icon", "icon.ico"},
		{"assets/pic.webp", "image/webp", "pic.webp"},
	}

	for _, c := range cases {
		rec := httptest.NewRecorder()
		setRawHeaders(rec, c.path)

		if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: got nosniff header %q, want 'nosniff'", c.path, got)
		}

		gotCT := rec.Header().Get("Content-Type")
		if strings.HasPrefix(c.wantContentType, "image/") {
			if !strings.HasPrefix(gotCT, "image/") {
				t.Errorf("%s: got Content-Type %q, want image/*", c.path, gotCT)
			}
		} else if gotCT != c.wantContentType {
			t.Errorf("%s: got Content-Type %q, want %q", c.path, gotCT, c.wantContentType)
		}

		gotCD := rec.Header().Get("Content-Disposition")
		if !strings.HasPrefix(gotCD, "attachment") || !strings.Contains(gotCD, c.wantFilename) {
			t.Errorf("%s: got Content-Disposition %q, expected attachment containing %q", c.path, gotCD, c.wantFilename)
		}
	}
}

func TestRawEndpointHeaders(t *testing.T) {
	s, root := newTestServer(t)

	// Create test files
	files := map[string]string{
		"evil.html": "<!DOCTYPE html><html><script>alert(1)</script></html>",
		"icon.svg":  `<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>`,
		"data.json": `{"foo": "bar"}`,
	}
	for rel, content := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		rel             string
		wantContentType string
		wantDisposition string
	}{
		{"main.go", "application/octet-stream", "main.go"},
		{"evil.html", "application/octet-stream", "evil.html"},
		{"data.json", "application/octet-stream", "data.json"},
		{"icon.svg", "image/svg+xml", "icon.svg"},
	}

	for _, tc := range cases {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/raw?path="+url.QueryEscape(tc.rel), nil)
		s.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d (body: %s)", tc.rel, rec.Code, rec.Body.String())
		}
		if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options = %q, want nosniff", tc.rel, got)
		}
		if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, tc.wantContentType) {
			t.Errorf("%s: Content-Type = %q, want %q", tc.rel, got, tc.wantContentType)
		}
		if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, tc.wantDisposition) {
			t.Errorf("%s: Content-Disposition = %q, want %q", tc.rel, got, tc.wantDisposition)
		}
	}
}

func TestFileSave(t *testing.T) {
	s, root := newTestServer(t)

	// 1. Save changes to existing file
	newContent := "package main\n\nfunc main() {\n\tgreet(\"updated\")\n}\n"
	body, _ := json.Marshal(map[string]string{
		"path":    "main.go",
		"content": newContent,
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/file/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	diskBytes, err := os.ReadFile(filepath.Join(root, "main.go"))
	if err != nil {
		t.Fatalf("failed to read disk file: %v", err)
	}
	if string(diskBytes) != newContent {
		t.Fatalf("file content mismatch: got %q, want %q", string(diskBytes), newContent)
	}

	// 2. Reject path traversal
	body, _ = json.Marshal(map[string]string{
		"path":    "../../escape.txt",
		"content": "bad",
	})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/file/save", bytes.NewReader(body))
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for path traversal, got %d", rec.Code)
	}

	// 3. Reject directory target
	body, _ = json.Marshal(map[string]string{
		"path":    "sub",
		"content": "bad",
	})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/file/save", bytes.NewReader(body))
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for directory target, got %d", rec.Code)
	}
}

func TestFSNew(t *testing.T) {
	s, root := newTestServer(t)

	// 1. Create new file with nested directory
	body, _ := json.Marshal(map[string]string{
		"path": "pkg/nested/new_file.go",
		"type": "file",
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/fs/new", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	targetPath := filepath.Join(root, "pkg", "nested", "new_file.go")
	st, err := os.Stat(targetPath)
	if err != nil {
		t.Fatalf("expected file to exist at %s: %v", targetPath, err)
	}
	if st.IsDir() {
		t.Fatalf("expected regular file, got directory")
	}

	// 2. Creating already existing file should fail with 409 Conflict
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/fs/new", bytes.NewReader(body))
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 conflict, got %d", rec.Code)
	}

	// 3. Create new directory
	body, _ = json.Marshal(map[string]string{
		"path": "src/components",
		"type": "dir",
	})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/fs/new", bytes.NewReader(body))
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	dirPath := filepath.Join(root, "src", "components")
	st, err = os.Stat(dirPath)
	if err != nil || !st.IsDir() {
		t.Fatalf("expected directory to exist at %s", dirPath)
	}

	// 4. Reject traversal
	body, _ = json.Marshal(map[string]string{
		"path": "../evil",
		"type": "file",
	})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/fs/new", bytes.NewReader(body))
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for path traversal, got %d", rec.Code)
	}
}

func TestTableEndpointServesRowsAndFileFlagsTables(t *testing.T) {
	t.Parallel()
	s, root := newTestServer(t)
	if err := os.WriteFile(filepath.Join(root, "bench.csv"), []byte("repo,files\nlinux,81902\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "bench.tsv"), []byte("repo\tfiles\nlinux\t81902\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	code, m := get(t, s, "/api/table?path=bench.csv")
	if code != 200 {
		t.Fatalf("status %d: %v", code, m)
	}
	rows, _ := m["rows"].([]any)
	if len(rows) != 1 || m["cols"] != float64(2) {
		t.Errorf("response = %v", m)
	}
	for path, want := range map[string]bool{"bench.csv": true, "bench.tsv": true, "main.go": false} {
		if _, m := get(t, s, "/api/file?path="+path); m["table"] != want {
			t.Errorf("%s: table = %v, want %v", path, m["table"], want)
		}
	}
	if code, _ := get(t, s, "/api/table?path=main.go"); code != 415 {
		t.Errorf("non-table file: status %d, want 415", code)
	}
}

func TestMarkdownPreview(t *testing.T) {
	t.Parallel()
	s, root := newTestServer(t)
	src := "# Hello World\n\nSee [deep](sub/deep.py#L2).\n\n## API_reference\n\n```go\nfunc main() {}\n```\n\n- [x] done\n"
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}

	code, m := get(t, s, "/api/markdown?path=README.md")
	if code != 200 {
		t.Fatalf("status %d: %v", code, m)
	}
	out, _ := m["html"].(string)
	for _, want := range []string{
		`<h1 id="hello-world" data-line="1">Hello World</h1>`,
		`<h2 id="api_reference" data-line="5">`,
		`<pre class="md-code" data-line="8" data-lang="go"><code><i class=k>func</i>`,
		`<a href="sub/deep.py#L2">deep</a>`,
		`type="checkbox"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("preview is missing %q:\n%s", want, out)
		}
	}

	if _, m := get(t, s, "/api/file?path=README.md"); m["markdown"] != true {
		t.Errorf("file response should flag Markdown, got %v", m["markdown"])
	}
	if code, _ := get(t, s, "/api/markdown?path=main.go"); code != 415 {
		t.Errorf("non-Markdown file: status %d, want 415", code)
	}
	if code, _ := get(t, s, "/api/markdown?path=../x.md"); code != 400 {
		t.Errorf("path outside the root: status %d, want 400", code)
	}
}
