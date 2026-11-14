package git

import (
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// StagedStat returns the diffstat summary of staged changes against HEAD.
// Fails quiet -> "".
func StagedStat(root string) string {
	if !Available(root) {
		return ""
	}
	out, err := exec.Command("git", "-C", root, "diff", "--stat", "--cached").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

const (
	maxStagedDiffBytes = 32 * 1024 // 32 KB limit on staged diff to stay safely under ARG_MAX / MAX_ARG_STRLEN
)

var lockfileExclusions = []string{
	":(exclude)*package-lock.json",
	":(exclude)*yarn.lock",
	":(exclude)*pnpm-lock.yaml",
	":(exclude)*go.sum",
	":(exclude)*Cargo.lock",
	":(exclude)*composer.lock",
	":(exclude)*poetry.lock",
	":(exclude)*Gemfile.lock",
	":(exclude)*.min.js",
	":(exclude)*.min.css",
	":(exclude)*.map",
}

// StagedDiff returns the unified diff of the index (staged changes)
// against HEAD, for handing to a coding harness asked to write a commit
// message. Large diffs are capped to maxStagedDiffBytes and noise files
// (lockfiles, minified assets) are excluded when other changes exist.
// Fails quiet -> "".
func StagedDiff(root string) string {
	return promptDiff(root, "--cached")
}

// RangeDiff is StagedDiff for the commits between from and to: what a
// squash of a PR would land, trimmed the same way for a harness prompt.
func RangeDiff(root, from, to string) string {
	return promptDiff(root, from, to)
}

// RangeStat is the diffstat between from and to.
func RangeStat(root, from, to string) string {
	if !Available(root) {
		return ""
	}
	out, err := exec.Command("git", "-C", root, "diff", "--stat", from, to).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func promptDiff(root string, diffArgs ...string) string {
	if !Available(root) {
		return ""
	}
	base := append([]string{"-C", root, "diff", "--no-color"}, diffArgs...)
	// Try fetching the diff excluding high-noise files (lockfiles, minified bundles)
	cmdArgs := append(append(append([]string(nil), base...), "--", "."), lockfileExclusions...)
	out, err := exec.Command("git", cmdArgs...).Output()
	if err != nil || len(strings.TrimSpace(string(out))) == 0 {
		// Fallback to unfiltered diff if excluded diff was empty or failed (e.g. only lockfiles were modified)
		out, err = exec.Command("git", base...).Output()
		if err != nil {
			return ""
		}
	}
	if len(out) > maxStagedDiffBytes {
		cut := maxStagedDiffBytes
		if idx := bytes.LastIndexByte(out[:cut], '\n'); idx > 0 {
			cut = idx
		}
		return string(out[:cut]) + "\n\n[Diff truncated: showing first 32KB. See changed files and summary above for full list of changes]"
	}
	return string(out)
}

// HasUncommittedChanges reports whether the working tree or index has any
// changes at all (staged, unstaged, or untracked). Used to gate commit and
// pull -- a pull is refused outright when there's anything uncommitted,
// rather than risking it colliding with incoming changes.
func HasUncommittedChanges(root string) bool {
	if !Available(root) {
		return false
	}
	out, err := exec.Command("git", "-C", root, "status", "--porcelain", "-uall").Output()
	if err != nil {
		return false
	}
	return len(strings.TrimSpace(string(out))) > 0
}

// Stage adds relpath to the index. An empty relpath (the served root
// itself) means "stage everything", so a bare "Stage All" action can reuse
// this instead of a separate endpoint.
func Stage(root, relpath string) error {
	if relpath == "" {
		relpath = "."
	}
	out, err := exec.Command("git", "-C", root, "add", "-A", "--", relpath).CombinedOutput()
	if err != nil {
		return fmt.Errorf("git add: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Unstage removes relpath from the index without touching the working tree.
func Unstage(root, relpath string) error {
	if relpath == "" {
		relpath = "."
	}
	out, err := exec.Command("git", "-C", root, "reset", "HEAD", "--", relpath).CombinedOutput()
	if err != nil {
		// On an unborn HEAD (a repository with no commits yet), `git reset`
		// fails because HEAD does not resolve; `git rm --cached` removes the
		// path from the index without touching the working tree.
		if _, rmErr := exec.Command("git", "-C", root, "rm", "-r", "--cached", "--", relpath).CombinedOutput(); rmErr == nil {
			return nil
		}
		return fmt.Errorf("git reset: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// ApplyHunk applies a single unified diff hunk for relpath to the index
// ("stage" / "unstage") or working tree ("discard" reverses the hunk in place).
func ApplyHunk(root, relpath, hunk, action string) error {
	info := Probe(root)
	if !info.ok {
		return errors.New("git repository not available")
	}
	hunk = strings.TrimRight(hunk, "\r\n")
	if !strings.HasPrefix(hunk, "@@") {
		return errors.New("hunk must start with @@ header")
	}
	absTarget := filepath.Join(root, filepath.FromSlash(relpath))
	repoRel, err := filepath.Rel(info.toplevel, absTarget)
	if err != nil {
		return err
	}
	repoRel = filepath.ToSlash(repoRel)

	var patch strings.Builder
	fmt.Fprintf(&patch, "diff --git a/%s b/%s\n--- a/%s\n+++ b/%s\n%s\n", repoRel, repoRel, repoRel, repoRel, hunk)
	patchBytes := []byte(patch.String())

	runApply := func(flags ...string) ([]byte, error) {
		args := append([]string{"-C", info.toplevel, "apply", "--unidiff-zero", "--whitespace=nowarn"}, flags...)
		args = append(args, "-")
		cmd := exec.Command("git", args...)
		cmd.Stdin = bytes.NewReader(patchBytes)
		return cmd.CombinedOutput()
	}

	switch action {
	case "stage":
		if out, err := runApply("--cached"); err != nil {
			return fmt.Errorf("git apply --cached: %w: %s", err, strings.TrimSpace(string(out)))
		}
	case "unstage":
		if out, err := runApply("--cached", "-R"); err != nil {
			return fmt.Errorf("git apply --cached -R: %w: %s", err, strings.TrimSpace(string(out)))
		}
	case "discard":
		// Try reversing against both index and worktree first (in case the hunk was
		// staged), falling back to worktree-only when the hunk is unstaged.
		if _, err := runApply("--index", "-R"); err != nil {
			if out, err2 := runApply("-R"); err2 != nil {
				return fmt.Errorf("git apply -R: %w: %s", err2, strings.TrimSpace(string(out)))
			}
		}
	default:
		return fmt.Errorf("unknown hunk action %q", action)
	}
	return nil
}

// StagedFiles returns a list of repo-relative paths staged in the index.
func StagedFiles(root string) []string {
	info := Probe(root)
	if !info.ok {
		return nil
	}
	out, err := exec.Command("git", "-C", root, "diff", "--name-only", "--cached", "-z").Output()
	if err != nil {
		return nil
	}
	key := repoRelKey(info, root)
	var files []string
	for _, p := range strings.Split(string(out), "\x00") {
		if p == "" {
			continue
		}
		if k, ok := key(p); ok {
			files = append(files, k)
		}
	}
	return files
}
