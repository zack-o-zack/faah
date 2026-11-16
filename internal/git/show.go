package git

import (
	"fmt"
	"os/exec"
	"path"
	"strconv"
	"strings"
)

// ShowFile reads a bounded blob at a commit, independent of local edits.
func ShowFile(root, sha, rel string, max int64) ([]byte, error) {
	if !ValidSHA(sha) {
		return nil, fmt.Errorf("invalid commit SHA")
	}
	if rel == "" || rel == "." || path.IsAbs(rel) || path.Clean(rel) != rel || strings.Contains(rel, "\\") {
		return nil, fmt.Errorf("invalid file path")
	}
	for _, part := range strings.Split(rel, "/") {
		if part == ".." {
			return nil, fmt.Errorf("invalid file path")
		}
	}
	object := sha + ":" + rel
	out, err := exec.Command("git", "-C", root, "cat-file", "-s", object).Output()
	if err != nil {
		return nil, fmt.Errorf("file %q not found at commit %s: %w", rel, sha, err)
	}
	size, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("read blob size: %w", err)
	}
	if max < 0 || size > max {
		return nil, fmt.Errorf("file too large (%d bytes, limit %d)", size, max)
	}
	kind, err := exec.Command("git", "-C", root, "cat-file", "-t", object).Output()
	if err != nil || strings.TrimSpace(string(kind)) != "blob" {
		return nil, fmt.Errorf("path %q is not a file at commit %s", rel, sha)
	}
	out, err = exec.Command("git", "-C", root, "show", object).Output()
	if err != nil {
		return nil, fmt.Errorf("read %q at commit %s: %w", rel, sha, err)
	}
	return out, nil
}
