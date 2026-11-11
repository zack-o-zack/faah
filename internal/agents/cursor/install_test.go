package cursor

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func fakeRuntime(t *testing.T, node, npm, install string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake runtime uses shell scripts")
	}
	dir := t.TempDir()
	for name, body := range map[string]string{
		"node": "echo '" + node + "'\n",
		"npm":  "if [ \"$1\" = --version ]; then echo '" + npm + "'; exit; fi\n" + install,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\n"+body), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir)
}

func TestCursorRuntimeRequirements(t *testing.T) {
	for _, tc := range []struct{ node, npm string }{{"v22.12.0", "11.0.0"}, {"v20.19.0", "11.0.0"}, {"v24.0.0", "6.14.0"}, {"invalid", "11.0.0"}, {"v24.0.0", "invalid"}} {
		t.Run(tc.node+tc.npm, func(t *testing.T) {
			fakeRuntime(t, tc.node, tc.npm, "exit 99\n")
			if _, err := prepare(context.Background()); err == nil || !strings.Contains(err.Error(), requirements) {
				t.Fatal(err)
			}
		})
	}
	for _, missing := range []string{"node", "npm"} {
		t.Run("missing="+missing, func(t *testing.T) {
			fakeRuntime(t, "v24.0.0", "11.0.0", "exit 99\n")
			if err := os.Remove(filepath.Join(os.Getenv("PATH"), missing)); err != nil {
				t.Fatal(err)
			}
			if _, err := prepare(context.Background()); err == nil || !strings.Contains(err.Error(), requirements) {
				t.Fatal(err)
			}
		})
	}
}

func TestCursorInstallOnceAndRefreshHelper(t *testing.T) {
	fakeRuntime(t, "v24.0.0", "11.0.0", `
[ "$*" = 'install --omit=dev --no-audit --no-fund' ] || exit 2
echo install >> installs
/bin/sleep 0.1
`)
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if got, err := prepareCache(ctx, dir); err != nil || got != dir {
				t.Errorf("cache = %q: %v", got, err)
			}
		}()
	}
	wg.Wait()
	installs, err := os.ReadFile(filepath.Join(dir, "installs"))
	if err != nil || string(installs) != "install\n" {
		t.Fatalf("installs = %q: %v", installs, err)
	}
	pkg, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Dependencies map[string]string `json:"dependencies"`
	}
	if err := json.Unmarshal(pkg, &v); err != nil || v.Dependencies["@cursor/sdk"] != sdkVersion {
		t.Fatalf("package = %s: %v", pkg, err)
	}
	path := filepath.Join(dir, "helper.mjs")
	if err := os.WriteFile(path, []byte("old helper"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareCache(ctx, dir); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, helper) {
		t.Fatalf("helper was not refreshed: %v", err)
	}
	past := time.Unix(1000000000, 0)
	if err := os.Chtimes(path, past, past); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareCache(ctx, dir); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || !info.ModTime().Equal(past) {
		t.Fatalf("unchanged helper was rewritten: %v", err)
	}
	installs, err = os.ReadFile(filepath.Join(dir, "installs"))
	if err != nil || string(installs) != "install\n" {
		t.Fatalf("SDK was reinstalled: %q %v", installs, err)
	}
}

func TestCursorInstallFailureAndLock(t *testing.T) {
	fakeRuntime(t, "v24.0.0", "11.0.0", "echo registry-unavailable >&2\nexit 1\n")
	dir := t.TempDir()
	if _, err := prepareCache(context.Background(), dir); err == nil || !strings.Contains(err.Error(), "registry-unavailable") || !strings.Contains(err.Error(), requirements) {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "installed")); !os.IsNotExist(err) {
		t.Fatalf("failed install was marked complete: %v", err)
	}
	lock := filepath.Join(dir, "install.lock")
	if _, err := os.Stat(lock); !os.IsNotExist(err) {
		t.Fatalf("failed install kept the lock: %v", err)
	}
	if err := os.WriteFile(lock, nil, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := prepareCache(ctx, dir); err == nil || !strings.Contains(err.Error(), "install lock") {
		t.Fatal(err)
	}
}
