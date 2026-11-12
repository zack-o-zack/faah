package agents

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func canonical(path string) (string, error) {
	current, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	suffix := []string{}
	for {
		resolved, resolveErr := filepath.EvalSymlinks(current)
		if resolveErr == nil {
			for index := len(suffix) - 1; index >= 0; index-- {
				resolved = filepath.Join(resolved, suffix[index])
			}
			return resolved, nil
		}
		if !os.IsNotExist(resolveErr) {
			return "", resolveErr
		}
		if _, statErr := os.Lstat(current); statErr == nil {
			return "", errors.New("broken symlink")
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", resolveErr
		}
		suffix = append(suffix, filepath.Base(current))
		current = parent
	}
}

// WithinWorkspace reports whether a path stays inside dir after resolving symlinks.
func WithinWorkspace(dir, path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(dir, path)
	}
	root, err := canonical(dir)
	if err != nil {
		return false
	}
	resolved, err := canonical(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(root, resolved)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
