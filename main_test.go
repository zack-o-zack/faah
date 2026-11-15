package main

import (
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"faah/internal/git/gittest"
)

func TestListenPortFallback(t *testing.T) {
	// Bind a port first
	ln1, addr1, err := listen("127.0.0.1", 0)
	if err != nil {
		t.Fatalf("first listen failed: %v", err)
	}
	defer ln1.Close()

	// Extract port number
	_, portStr, err := net.SplitHostPort(addr1)
	if err != nil {
		t.Fatalf("split host port failed: %v", err)
	}
	p, _ := strconv.Atoi(portStr)

	// Trying to listen on the same port should find the next available port
	ln2, addr2, err := listen("127.0.0.1", p)
	if err != nil {
		t.Fatalf("second listen failed: %v", err)
	}
	defer ln2.Close()

	if addr2 == addr1 {
		t.Fatalf("second listener got the same address %s", addr2)
	}
}

func TestResolveTarget(t *testing.T) {
	root := t.TempDir()
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "report #1.json")
	if err := os.WriteFile(file, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	dirRoot, initialFile, initialLine, err := resolveTarget(root)
	if err != nil {
		t.Fatalf("resolveTarget(directory): %v", err)
	}
	if dirRoot != resolvedRoot || initialFile != "" || initialLine != 0 {
		t.Fatalf("resolveTarget(directory) = %q, %q, %d; want %q, empty, 0", dirRoot, initialFile, initialLine, resolvedRoot)
	}

	fileRoot, initialFile, initialLine, err := resolveTarget(file)
	if err != nil {
		t.Fatalf("resolveTarget(file): %v", err)
	}
	if fileRoot != resolvedRoot || initialFile != filepath.Base(file) || initialLine != 0 {
		t.Fatalf("resolveTarget(file) = %q, %q, %d; want %q, %q, 0", fileRoot, initialFile, initialLine, resolvedRoot, filepath.Base(file))
	}
}

func TestResolveTargetGitRepo(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	repo := gittest.Repo(t)
	subFile := filepath.Join(repo, "pkg", "sub", "app.go")
	if err := os.MkdirAll(filepath.Dir(subFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(subFile, []byte("package sub\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	root, initialFile, initialLine, err := resolveTarget(subFile)
	if err != nil {
		t.Fatalf("resolveTarget(subFile): %v", err)
	}
	if root != repo {
		t.Fatalf("resolveTarget root = %q, want repo %q", root, repo)
	}
	if initialFile != "pkg/sub/app.go" || initialLine != 0 {
		t.Fatalf("resolveTarget file = %q, line = %d; want pkg/sub/app.go, 0", initialFile, initialLine)
	}

	targetWithLine := subFile + ":42"
	root, initialFile, initialLine, err = resolveTarget(targetWithLine)
	if err != nil {
		t.Fatalf("resolveTarget(%q): %v", targetWithLine, err)
	}
	if root != repo || initialFile != "pkg/sub/app.go" || initialLine != 42 {
		t.Fatalf("resolveTarget with line: got root=%q file=%q line=%d", root, initialFile, initialLine)
	}

	targetWithLineCol := subFile + ":42:15"
	root, initialFile, initialLine, err = resolveTarget(targetWithLineCol)
	if err != nil {
		t.Fatalf("resolveTarget(%q): %v", targetWithLineCol, err)
	}
	if root != repo || initialFile != "pkg/sub/app.go" || initialLine != 42 {
		t.Fatalf("resolveTarget with line:col: got root=%q file=%q line=%d", root, initialFile, initialLine)
	}
}

func TestResolveTargetRejectsMissingPath(t *testing.T) {
	if _, _, _, err := resolveTarget(filepath.Join(t.TempDir(), "missing.go")); err == nil {
		t.Fatal("resolveTarget accepted a missing path")
	}
}

func TestViewerURL(t *testing.T) {
	got := viewerURL("127.0.0.1:7777", "report #1.json", 0)
	u, err := url.Parse(got)
	if err != nil {
		t.Fatalf("viewerURL returned an invalid URL: %v", err)
	}
	if u.Scheme != "http" || u.Host != "127.0.0.1:7777" || u.Query().Get("path") != "report #1.json" || u.Query().Get("line") != "" {
		t.Fatalf("viewerURL = %q", got)
	}

	gotWithLine := viewerURL("127.0.0.1:7777", "report #1.json", 42)
	uWithLine, err := url.Parse(gotWithLine)
	if err != nil {
		t.Fatalf("viewerURL with line returned an invalid URL: %v", err)
	}
	if uWithLine.Query().Get("path") != "report #1.json" || uWithLine.Query().Get("line") != "42" {
		t.Fatalf("viewerURL with line = %q", gotWithLine)
	}

	if got := viewerURL("127.0.0.1:7777", "", 0); got != "http://127.0.0.1:7777" {
		t.Fatalf("viewerURL without a file = %q", got)
	}

	// Base path tests
	if got := viewerURL("127.0.0.1:7777", "", 0, "/rev-123/"); got != "http://127.0.0.1:7777/rev-123/" {
		t.Fatalf("viewerURL with base path = %q, want http://127.0.0.1:7777/rev-123/", got)
	}
	if got := viewerURL("127.0.0.1:7777", "main.go", 10, "/rev-123"); got != "http://127.0.0.1:7777/rev-123/?line=10&path=main.go" {
		t.Fatalf("viewerURL with base path and file = %q", got)
	}
}

func TestNetworkURLs(t *testing.T) {
	addrs := []net.Addr{
		&net.IPNet{IP: net.ParseIP("192.168.1.20"), Mask: net.CIDRMask(24, 32)},
		&net.IPNet{IP: net.ParseIP("127.0.0.1"), Mask: net.CIDRMask(8, 32)},
		&net.IPNet{IP: net.ParseIP("10.0.0.4"), Mask: net.CIDRMask(24, 32)},
		&net.IPNet{IP: net.ParseIP("192.168.1.20"), Mask: net.CIDRMask(24, 32)},
		&net.IPNet{IP: net.ParseIP("2001:db8::1"), Mask: net.CIDRMask(64, 128)},
	}

	got := networkURLsFromAddrs("0.0.0.0:7777", "main.go", 42, addrs)
	want := []string{
		"http://10.0.0.4:7777?line=42&path=main.go",
		"http://192.168.1.20:7777?line=42&path=main.go",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("networkURLsFromAddrs = %v, want %v", got, want)
	}
}

func TestVersionDrivenFromVERSIONFile(t *testing.T) {
	data, err := os.ReadFile("VERSION")
	if err != nil {
		t.Fatalf("failed to read VERSION file: %v", err)
	}
	expected := strings.TrimSpace(string(data))
	if version != expected {
		t.Fatalf("version variable %q does not match VERSION file %q", version, expected)
	}
}
