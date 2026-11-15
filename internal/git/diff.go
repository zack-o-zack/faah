package git

import (
	"os/exec"
	"strconv"
	"strings"
)

// Untracked lists untracked, non-ignored files relative to the served root.
func Untracked(root string) []string {
	info := Probe(root)
	if !info.ok {
		return nil
	}
	out, err := exec.Command("git", "-C", root, "ls-files", "--others", "--exclude-standard", "-z").Output()
	if err != nil {
		return nil
	}
	var files []string
	for _, p := range strings.Split(string(out), "\x00") {
		if p != "" {
			files = append(files, p)
		}
	}
	return files
}

// FilesBetween maps each path that differs between two commits to its
// name-status letter (A, M, D, R...), relative to the served root (paths outside
// it are dropped). PR review uses it for the PR's own file set and statuses:
// diffBase..head, fixed until the next Pull.
func FilesBetween(root, from, to string) map[string]string {
	info := Probe(root)
	if !info.ok || from == "" || to == "" {
		return nil
	}
	out, err := exec.Command("git", "-C", root, "diff", "--name-status", "-z", from, to).Output()
	if err != nil {
		return nil
	}
	files := map[string]string{}
	parseNameStatusZ(out, repoRelKey(info, root), files, true)
	return files
}

// DiffAgainst is gitDiff generalized to an arbitrary base ref, so a PR
// review session (pr.go) can diff a file against the merge-base with the
// PR's target branch instead of the working tree's HEAD.
func DiffAgainst(root, relpath, base string) string {
	return DiffPaths(root, base, "", relpath)
}

// DiffBetween is DiffAgainst generalized to a two-dot diff between two
// commits, rather than a commit against the working tree. A PR review
// session uses it to render the PR's own diff (merge-base..head) separately
// from the reviewer's local changes since checkout (head..working tree),
// which DiffAgainst covers.
func DiffBetween(root, relpath, from, to string) string {
	return DiffPaths(root, from, to, relpath)
}

// MergeBase returns the merge-base commit of a and b, or "" if it cannot
// be determined (e.g. b was never fetched locally).
func MergeBase(root, a, b string) string {
	if !Available(root) {
		return ""
	}
	out, err := exec.Command("git", "-C", root, "merge-base", a, b).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// HunksAgainst parses the unified diff of relpath against base into
// 1-based NEW-FILE line numbers for a change gutter: added lines, modified
// (replaced) lines, and one marker per pure-deletion run (the new-file line
// immediately preceding the removed run; 0 means "before the first line").
// Fails quiet: empty when git is off/unavailable or the file has no diff
// against base (clean/untracked). base is "HEAD" for the working-tree
// gutter, or a PR's merge-base in review mode (server.go's diffBase).
func HunksAgainst(root, relpath, base string) (added, modified, deleted []int) {
	return parseDiffHunks(DiffAgainst(root, relpath, base))
}

// parseDiffHunks is HunksAgainst's body, split out so a commit's own diff
// (DiffCommit) can feed the same gutter parser as a diff against a ref.
func parseDiffHunks(diff string) (added, modified, deleted []int) {
	if diff == "" {
		return nil, nil, nil
	}
	newLine := 0
	inHunk := false
	// Current block: a maximal run of consecutive '+'/'-' lines.
	dels := 0
	var adds []int
	blockStart := 0 // newLine when the block began (for deletion markers)
	flush := func() {
		switch {
		case dels > 0 && len(adds) > 0:
			modified = append(modified, adds...) // replacement
		case len(adds) > 0:
			added = append(added, adds...) // pure insertion
		case dels > 0:
			deleted = append(deleted, blockStart-1) // pure deletion
		}
		dels, adds = 0, nil
	}
	for _, line := range strings.Split(diff, "\n") {
		switch {
		case strings.HasPrefix(line, "@@"):
			flush()
			inHunk = true
			newLine = parseNewStart(line)
		case !inHunk, strings.HasPrefix(line, "\\"): // pre-hunk header / "\ No newline"
			// skip: neither +/- nor a new-file line
		case strings.HasPrefix(line, "+"):
			if dels == 0 && len(adds) == 0 {
				blockStart = newLine
			}
			adds = append(adds, newLine)
			newLine++
		case strings.HasPrefix(line, "-"):
			if dels == 0 && len(adds) == 0 {
				blockStart = newLine
			}
			dels++
		default: // context line (" ...", or the trailing empty split element)
			flush()
			newLine++
		}
	}
	flush()
	return added, modified, deleted
}

// parseNewStart pulls newStart out of a hunk header "@@ -a,b +c,d @@".
func parseNewStart(hdr string) int {
	i := strings.IndexByte(hdr, '+')
	if i < 0 {
		return 1
	}
	rest := hdr[i+1:]
	if end := strings.IndexAny(rest, ", "); end >= 0 {
		rest = rest[:end]
	}
	if n, err := strconv.Atoi(rest); err == nil {
		return n
	}
	return 1
}

// DiffFull returns the whole unified diff for `git diff <refs...>`, capped at
// max bytes (with a marker line when cut). Untracked files are not part of a git
// diff; callers that care list them separately (Untracked).
func DiffFull(root string, max int, refs ...string) string {
	if !Available(root) {
		return ""
	}
	args := append([]string{"-C", root, "diff", "--no-color", "--no-ext-diff"}, refs...)
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		return ""
	}
	if max > 0 && len(out) > max {
		return string(out[:max]) + "\n… diff truncated; run git diff for the rest …\n"
	}
	return string(out)
}

// DiffCommit returns the unified diff a single commit made to relpath --
// the commit against its first parent, or against the empty tree for a root
// commit. This is the ref form of DiffAgainst: the working tree isn't
// involved at all, so the result is frozen no matter what is edited since.
func DiffCommit(root, relpath, sha string) string {
	if !Available(root) || !ValidSHA(sha) {
		return ""
	}
	args := append([]string{"-C", root, "diff-tree", "-p", "--no-color"}, commitDiffArgs...)
	args = append(args, sha, "--", relpath)
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		return ""
	}
	return string(out)
}

// HunksCommit is HunksAgainst for a single commit's own diff.
func HunksCommit(root, relpath, sha string) (added, modified, deleted []int) {
	return parseDiffHunks(DiffCommit(root, relpath, sha))
}

// ChangedFiles lists changes with rename origins in one Git subprocess.
// An empty head compares the base to the working tree (including staged paths).
func ChangedFiles(root, base, head string) []CommitFile {
	info := Probe(root)
	if !info.ok || base == "" {
		return nil
	}
	args := []string{"-C", root, "diff", "--name-status", "-z", "--find-renames", base}
	if head != "" {
		args = append(args, head)
	}
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		return nil
	}
	return parseChangedFiles(out, repoRelKey(info, root))
}

// DiffPaths includes both sides of a rename so Git can compute its actual edits.
func DiffPaths(root, base, head string, paths ...string) string {
	if !Available(root) {
		return ""
	}
	args := []string{"-C", root, "diff", "--no-color", "--find-renames", base}
	if head != "" {
		args = append(args, head)
	}
	args = append(args, "--")
	args = append(args, paths...)
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		if base == "HEAD" && head == "" {
			// An unborn repository has no HEAD; retain the empty-tree comparison.
			args[5] = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
			if emptyOut, emptyErr := exec.Command("git", args...).Output(); emptyErr == nil {
				return string(emptyOut)
			}
		}
		return ""
	}
	return string(out)
}
