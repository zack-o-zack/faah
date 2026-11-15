package git

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// CurrentBranch returns the checked-out branch name, or "HEAD" when
// detached (e.g. inside a PR review worktree).
func CurrentBranch(root string) string {
	out, err := exec.Command("git", "-C", root, "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		if sym, err2 := exec.Command("git", "-C", root, "symbolic-ref", "--quiet", "--short", "HEAD").Output(); err2 == nil {
			return strings.TrimSpace(string(sym))
		}
		return ""
	}
	return strings.TrimSpace(string(out))
}

// ErrNotFastForward is returned by FFOnlyPull when fetching ref would not
// fast-forward the current branch; resolving that is not supported.
var ErrNotFastForward = errors.New("not a fast-forward")

// FFOnlyPull fetches ref from remote and fast-forwards the current branch
// onto it. It never touches history any other way: if the merge would not be
// a clean fast-forward, it returns ErrNotFastForward without modifying
// anything, leaving conflict resolution to the user in a terminal.
func FFOnlyPull(root, remote, ref string) error {
	if out, err := exec.Command("git", "-C", root, "fetch", "--no-tags", remote, ref).CombinedOutput(); err != nil {
		return fmt.Errorf("git fetch: %w: %s", err, strings.TrimSpace(string(out)))
	}
	if _, err := exec.Command("git", "-C", root, "merge", "--ff-only", "FETCH_HEAD").CombinedOutput(); err != nil {
		return ErrNotFastForward
	}
	return nil
}

// OpInProgress names the history-rewriting operation left half-done in
// the repository -- "rebase" or "merge" -- or "" when there is none. A
// conflicted rebase or merge (from a harness that gave up, or a terminal)
// would otherwise just look like a dirty working tree.
func OpInProgress(root string) string {
	gd := Dir(root)
	if gd == "" {
		return ""
	}
	exists := func(name string) bool {
		_, err := os.Stat(filepath.Join(gd, name))
		return err == nil
	}
	if exists("rebase-merge") || exists("rebase-apply") {
		return "rebase"
	}
	if exists("MERGE_HEAD") {
		return "merge"
	}
	return ""
}

// RebasingBranch returns the branch a rebase in progress is rewriting
// (HEAD itself is detached until it finishes), or "" when there is none.
func RebasingBranch(root string) string {
	gd := Dir(root)
	if gd == "" {
		return ""
	}
	for _, dir := range []string{"rebase-merge", "rebase-apply"} {
		if b, err := os.ReadFile(filepath.Join(gd, dir, "head-name")); err == nil {
			return strings.TrimPrefix(strings.TrimSpace(string(b)), "refs/heads/")
		}
	}
	return ""
}

// IsAncestor reports whether commit a is an ancestor of (or equal to) b.
func IsAncestor(root, a, b string) bool {
	return exec.Command("git", "-C", root, "merge-base", "--is-ancestor", a, b).Run() == nil
}

// AheadBehindRef counts the commits HEAD has that ref does not, and the
// other way round. Both are 0 when ref doesn't resolve.
func AheadBehindRef(root, ref string) (ahead, behind int) {
	out, err := exec.Command("git", "-C", root, "rev-list", "--left-right", "--count", "HEAD..."+ref).Output()
	if err != nil {
		return 0, 0
	}
	parts := strings.Fields(string(out))
	if len(parts) >= 2 {
		ahead, _ = strconv.Atoi(parts[0])
		behind, _ = strconv.Atoi(parts[1])
	}
	return ahead, behind
}

// AbortOp aborts the rebase or merge in progress, restoring the branch to
// where it was before that operation started.
func AbortOp(root string) error {
	op := OpInProgress(root)
	if op == "" {
		return errors.New("no rebase or merge in progress")
	}
	out, err := exec.Command("git", "-C", root, op, "--abort").CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %s --abort: %w: %s", op, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Push pushes the current branch to its configured remote. Returns
// trimmed combined output so the caller can recognize specific failures
// (e.g. no upstream configured) in the error text.
func Push(root string) (string, error) {
	out, err := exec.Command("git", "-C", root, "push").CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// PushSetUpstream pushes branch to remote and records it as the
// upstream, for a first push when the branch has none configured yet.
func PushSetUpstream(root, remote, branch string) (string, error) {
	out, err := exec.Command("git", "-C", root, "push", "-u", remote, branch).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// Upstream returns the remote and remote-branch name of branch's
// upstream (`@{u}`), or ok=false if none is configured.
func Upstream(root, branch string) (remote, remoteBranch string, ok bool) {
	out, err := exec.Command("git", "-C", root, "rev-parse", "--abbrev-ref", branch+"@{u}").Output()
	if err != nil {
		return "", "", false
	}
	remote, remoteBranch, found := strings.Cut(strings.TrimSpace(string(out)), "/")
	return remote, remoteBranch, found
}

// AheadBehind returns the number of commits HEAD is ahead and behind its
// upstream tracking branch (@{u}). If no upstream tracking branch is configured,
// it checks against origin/<branch> if available, or counts local commits if a
// remote is configured so initial publish pushes are permitted.
func AheadBehind(root string) (ahead, behind int, hasUpstream bool) {
	if !Available(root) {
		return 0, 0, false
	}
	out, err := exec.Command("git", "-C", root, "rev-list", "--left-right", "--count", "HEAD...@{u}").Output()
	if err == nil {
		parts := strings.Fields(string(out))
		if len(parts) >= 2 {
			a, _ := strconv.Atoi(parts[0])
			b, _ := strconv.Atoi(parts[1])
			return a, b, true
		}
	}

	branch := CurrentBranch(root)
	if branch != "" && branch != "HEAD" {
		if out, err := exec.Command("git", "-C", root, "rev-list", "--left-right", "--count", "HEAD...origin/"+branch).Output(); err == nil {
			parts := strings.Fields(string(out))
			if len(parts) >= 2 {
				a, _ := strconv.Atoi(parts[0])
				b, _ := strconv.Atoi(parts[1])
				return a, b, true
			}
		}

		if RemoteURL(root, "") != "" {
			if out, err := exec.Command("git", "-C", root, "rev-list", "--count", "HEAD").Output(); err == nil {
				c, _ := strconv.Atoi(strings.TrimSpace(string(out)))
				if c > 0 {
					return c, 0, false
				}
			}
		}
	}

	return 0, 0, false
}

// SyncState is where the current branch stands against its upstream:
// what the git panel needs to offer (or follow up on) a rebase or merge.
type SyncState struct {
	Code       string `json:"code,omitempty"` // "diverged" or "in-progress" on a refused pull
	Branch     string `json:"branch"`
	Upstream   string `json:"upstream"` // e.g. "origin/main"; empty when none is configured; a PR's base branch name
	Ahead      int    `json:"ahead"`
	Behind     int    `json:"behind"`
	InProgress string `json:"inProgress,omitempty"` // "rebase" or "merge" left half-done
	Dirty      bool   `json:"dirty"`

	// PR review sessions only: the PR number, and whether the checkout was
	// rewritten (rebased) past the PR head on the remote, so only a
	// force-push can update the PR.
	PR        int  `json:"pr,omitempty"`
	Rewritten bool `json:"rewritten,omitempty"`

	OntoRef string `json:"-"` // the ref faah fetched the PR's base into; the harness rebases onto it and never fetches
}

// Commit commits whatever is currently staged. Refuses up front when
// nothing is staged so the caller gets a clear message instead of git's own
// "nothing to commit" noise.
func Commit(root, message string) error {
	if len(StagedPaths(root)) == 0 {
		return errors.New("nothing staged to commit")
	}
	out, err := exec.Command("git", "-C", root, "commit", "-m", message).CombinedOutput()
	if err != nil {
		return fmt.Errorf("git commit: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
