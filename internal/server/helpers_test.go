package server

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/threads/threadstest"
	"faah/internal/workspace"
)

var (
	assets  fs.FS
	devRoot string
	version string
)

func TestMain(m *testing.M) {
	threadstest.RunCLIHelper()
	if err := os.Chdir("../.."); err != nil {
		panic(err)
	}
	data, err := os.ReadFile("VERSION")
	if err != nil {
		panic(err)
	}
	version = strings.TrimSpace(string(data))
	devRoot = os.Getenv("FAAH_DEV_ROOT")
	assets = os.DirFS(".")
	if devRoot != "" {
		assets = os.DirFS(devRoot)
	}
	os.Exit(m.Run())
}

func newTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	root := t.TempDir()
	write := func(rel, body string) {
		p := filepath.Join(root, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("main.go", "package main\n\nfunc main() {\n\tgreet(\"hi\")\n}\n")
	write("greet.go", "package main\n\nimport \"fmt\"\n\nfunc greet(s string) {\n\tfmt.Println(s)\n}\n")
	write(".gitignore", "secret/\n")
	write("secret/keys.go", "package secret\n\nconst Token = \"nope\"\n")
	write("sub/deep.py", "def handler(req):\n    return 1\n")

	ix := workspace.NewIndex(root)
	ix.Build()
	return New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version}), root
}

func get(t *testing.T, s *Server, url string) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	var m map[string]any
	json.Unmarshal(rec.Body.Bytes(), &m)
	return rec.Code, m
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func postDraft(t *testing.T, s *Server, prefix, body string) {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"path": "main.go", "line": 25, "side": "RIGHT", "body": body})
	req := httptest.NewRequest(http.MethodPost, prefix+"/api/pr/comments", bytes.NewReader(b))
	req.Host = "127.0.0.1:7777"
	req.Header.Set("Origin", "http://127.0.0.1:7777")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST %s/api/pr/comments failed: code %d, body %s", prefix, rec.Code, rec.Body.String())
	}
}
