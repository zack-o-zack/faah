package git

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// RestoreSnapshotPaths restores the specified root-relative paths to their
// state in snapshotSHA, removing any path that did not exist in snapshotSHA.
func RestoreSnapshotPaths(root, snapshotSHA string, paths []string) error {
	info := Probe(root)
	if !info.ok {
		return errors.New("git repository not available")
	}
	if !ValidSHA(snapshotSHA) {
		return errors.New("invalid snapshot SHA")
	}
	for _, rel := range paths {
		clean := filepath.Clean(filepath.FromSlash(rel))
		if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.IsAbs(clean) {
			continue
		}
		abs := filepath.Join(root, clean)
		repoRel, err := filepath.Rel(info.toplevel, abs)
		if err != nil {
			continue
		}
		repoRel = filepath.ToSlash(repoRel)

		// Check if the path existed in snapshotSHA.
		if exec.Command("git", "-C", info.toplevel, "cat-file", "-e", snapshotSHA+":"+repoRel).Run() == nil {
			if out, err := exec.Command("git", "-C", info.toplevel, "checkout", snapshotSHA, "--", repoRel).CombinedOutput(); err != nil {
				return fmt.Errorf("git checkout %s: %w: %s", rel, err, strings.TrimSpace(string(out)))
			}
			// Reset index entry to HEAD if HEAD has it, or unstage if it was newly added.
			_ = exec.Command("git", "-C", info.toplevel, "reset", "-q", "HEAD", "--", repoRel).Run()
		} else {
			_ = exec.Command("git", "-C", info.toplevel, "rm", "-f", "--ignore-unmatch", "--cached", "--", repoRel).Run()
			_ = os.Remove(abs)
		}
	}
	return nil
}

// SnapshotWorktree captures the entire working tree (including unstaged and
// untracked files) as a ref-free commit SHA in the repository's object database
// using a temporary index in os.TempDir(). Neither HEAD nor the real git index
// is modified. Returns "" if git is unavailable or the snapshot fails.
func SnapshotWorktree(root string) string {
	info := Probe(root)
	if !info.ok {
		return ""
	}
	tmpFile, err := os.CreateTemp("", "faah-idx-*")
	if err != nil {
		return ""
	}
	tmpIdx := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpIdx)

	// Seed the temp index from the real index so git add only hashes modified/untracked files.
	realIdx := filepath.Join(info.gitdir, "index")
	if data, err := os.ReadFile(realIdx); err == nil {
		_ = os.WriteFile(tmpIdx, data, 0o600)
	} else {
		_ = os.Remove(tmpIdx)
	}

	env := append(os.Environ(),
		"GIT_INDEX_FILE="+tmpIdx,
		"GIT_AUTHOR_NAME=faah",
		"GIT_AUTHOR_EMAIL=faah@localhost",
		"GIT_COMMITTER_NAME=faah",
		"GIT_COMMITTER_EMAIL=faah@localhost",
	)

	addCmd := exec.Command("git", "-C", root, "add", "-A")
	addCmd.Env = env
	if addCmd.Run() != nil {
		return ""
	}

	wtCmd := exec.Command("git", "-C", root, "write-tree")
	wtCmd.Env = env
	treeOut, err := wtCmd.Output()
	if err != nil {
		return ""
	}
	treeSHA := strings.TrimSpace(string(treeOut))
	if !ValidSHA(treeSHA) {
		return ""
	}

	ctArgs := []string{"-C", root, "commit-tree", treeSHA, "-m", "faah turn snapshot"}
	if headOut, err := exec.Command("git", "-C", root, "rev-parse", "--verify", "HEAD").Output(); err == nil {
		if headSHA := strings.TrimSpace(string(headOut)); ValidSHA(headSHA) {
			ctArgs = []string{"-C", root, "commit-tree", treeSHA, "-p", headSHA, "-m", "faah turn snapshot"}
		}
	}
	ctCmd := exec.Command("git", ctArgs...)
	ctCmd.Env = env
	commitOut, err := ctCmd.Output()
	if err != nil {
		return ""
	}
	sha := strings.TrimSpace(string(commitOut))
	if !ValidSHA(sha) {
		return ""
	}
	return sha
}
