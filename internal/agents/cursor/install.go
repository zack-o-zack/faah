package cursor

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const sdkVersion = "1.3.1"

//go:embed helper/helper.mjs
var helper []byte

const requirements = "cursor needs Node.js 22.13 or later and npm 7 or later; install them, or pick another agent"

func prepare(ctx context.Context) (string, error) {
	for _, bin := range []string{"node", "npm"} {
		b, err := exec.CommandContext(ctx, bin, "--version").Output()
		var major, minor int
		if err != nil {
			return "", fmt.Errorf("%s: %w", requirements, err)
		}
		if _, err = fmt.Sscanf(strings.TrimPrefix(strings.TrimSpace(string(b)), "v"), "%d.%d", &major, &minor); err != nil || major < 1 || (bin == "node" && (major < 22 || (major == 22 && minor < 13))) || (bin == "npm" && major < 7) {
			return "", errors.New(requirements)
		}
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(cache, "faah", "cursor-sdk", sdkVersion)
	return prepareCache(ctx, dir)
}

func prepareCache(ctx context.Context, dir string) (string, error) {
	var err error
	if err = os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	lock, err := lockInstall(ctx, filepath.Join(dir, "install.lock"))
	if err != nil {
		return "", err
	}
	defer lock.Close()
	if err = writeChanged(filepath.Join(dir, "helper.mjs"), helper); err != nil {
		return "", err
	}
	pkg := []byte(`{"private":true,"type":"module","dependencies":{"@cursor/sdk":"` + sdkVersion + `"}}`)
	if err = writeChanged(filepath.Join(dir, "package.json"), pkg); err != nil {
		return "", err
	}
	marker := filepath.Join(dir, "installed")
	if _, err = os.Stat(marker); err != nil {
		cmd := exec.CommandContext(ctx, "npm", "install", "--omit=dev", "--no-audit", "--no-fund")
		cmd.Dir = dir
		b, e := cmd.CombinedOutput()
		if e != nil {
			return "", fmt.Errorf("cursor SDK installation failed; %s: %w\n%s", requirements, e, b)
		}
		if err = os.WriteFile(marker, []byte(sdkVersion), 0600); err != nil {
			return "", err
		}
	}
	return dir, nil
}

func lockInstall(ctx context.Context, path string) (*os.File, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	for {
		if err := ctx.Err(); err != nil {
			file.Close()
			return nil, fmt.Errorf("cursor SDK install lock: %w", err)
		}
		locked, err := tryInstallLock(file)
		if err != nil {
			file.Close()
			return nil, fmt.Errorf("cursor SDK install lock: %w", err)
		}
		if locked {
			return file, nil
		}
		select {
		case <-ctx.Done():
			file.Close()
			return nil, fmt.Errorf("cursor SDK install lock: %w", ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func writeChanged(path string, b []byte) error {
	old, err := os.ReadFile(path)
	if err == nil && sha256.Sum256(old) == sha256.Sum256(b) {
		return nil
	}
	return os.WriteFile(path, b, 0600)
}
