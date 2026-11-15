package git

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// repoRelKey returns a function mapping a git-porcelain path (always relative
// to the repo toplevel) to a path relative to root, or false when it falls
// outside root's subtree (root may be a subdirectory of the repo).
func repoRelKey(info Info, root string) func(string) (string, bool) {
	prefix := ""
	if rel, err := filepath.Rel(info.toplevel, root); err == nil && rel != "." {
		prefix = filepath.ToSlash(rel) + "/"
	}
	return func(p string) (string, bool) {
		if prefix == "" {
			return p, true
		}
		if !strings.HasPrefix(p, prefix) {
			return "", false // outside the served subtree
		}
		return p[len(prefix):], true
	}
}

// StatusAndStagedAgainst runs a single `git status --porcelain=v2 -z -uall`
// command to extract both working-tree status codes and staged index paths,
// plus the staged paths modified again in the worktree since (partial),
// and optionally overlays diffs against base and head (for PR review mode)
// without spawning duplicate git status processes.
func StatusAndStagedAgainst(root, base, head string) (status map[string]string, staged, partial map[string]bool, yourStatus map[string]string) {
	info := Probe(root)
	if !info.ok {
		return nil, nil, nil, nil
	}
	out, err := exec.Command("git", "-C", root, "status", "--porcelain=v2", "-z", "-uall").Output()
	if err != nil {
		return nil, nil, nil, nil
	}
	key := repoRelKey(info, root)

	wtStatus := map[string]string{}
	staged = map[string]bool{}
	partial = map[string]bool{}
	markStaged := func(k, xy string) {
		if len(xy) == 2 && xy[0] != '.' {
			staged[k] = true
			if xy[1] != '.' {
				partial[k] = true
			}
		}
	}
	fields := strings.Split(string(out), "\x00")
	for i := 0; i < len(fields); i++ {
		f := fields[i]
		if f == "" {
			continue
		}
		switch f[0] {
		case '?': // "? <path>"
			if k, ok := key(f[2:]); ok {
				wtStatus[k] = "U" // untracked
			}
		case '1': // "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
			p := strings.SplitN(f, " ", 9)
			if len(p) == 9 {
				if k, ok := key(p[8]); ok {
					wtStatus[k] = mapXY(p[1])
					markStaged(k, p[1])
				}
			}
		case '2': // "2 <XY> ... <Rscore> <path>", then original path in the next field
			p := strings.SplitN(f, " ", 10)
			if len(p) == 10 {
				if k, ok := key(p[9]); ok {
					wtStatus[k] = mapXY(p[1])
					markStaged(k, p[1])
				}
			}
			i++ // the original path follows as its own NUL-terminated field
		case 'u': // "u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
			p := strings.SplitN(f, " ", 11)
			if len(p) == 11 {
				if k, ok := key(p[10]); ok {
					wtStatus[k] = "!" // unmerged / conflict
					staged[k] = true
				}
			}
		}
	}

	overlayDiff := func(ref string) map[string]string {
		m := make(map[string]string, len(wtStatus))
		for k, v := range wtStatus {
			m[k] = v
		}
		if ref != "" && ref != "HEAD" {
			if diffOut, err := exec.Command("git", "-C", root, "diff", "--name-status", "-z", ref).Output(); err == nil {
				parseNameStatusZ(diffOut, key, m, false)
			}
		}
		if len(m) == 0 {
			return nil
		}
		return m
	}

	if head != "" {
		yourStatus = overlayDiff(head)
	}
	if base != "" && base != "HEAD" {
		status = overlayDiff(base)
	} else if len(wtStatus) > 0 {
		status = wtStatus
	}
	if len(staged) == 0 {
		staged = nil
	}
	if len(partial) == 0 {
		partial = nil
	}
	return status, staged, partial, yourStatus
}

// StatusAgainst maps changed files relative to root against base.
// When base is "HEAD" or empty, it returns working-tree changes only.
// When base is an arbitrary commit or ref (such as a PR merge-base),
// it includes both files changed against base and working-tree changes.
func StatusAgainst(root, base string) map[string]string {
	st, _, _, _ := StatusAndStagedAgainst(root, base, "")
	return st
}

// mapXY collapses a porcelain v2 two-letter XY code (X=index, Y=worktree) into
// a single status letter, preferring the staged side when both are set.
func mapXY(xy string) string {
	if len(xy) < 2 {
		return "M"
	}
	c := xy[0]
	if c == '.' {
		c = xy[1]
	}
	switch c {
	case 'A':
		return "A"
	case 'D':
		return "D"
	case 'R':
		return "R"
	case 'C':
		return "C"
	case 'U':
		return "!" // unmerged / conflict
	default: // M (modified), T (typechange) and anything else read as modified
		return "M"
	}
}

// parseNameStatusZ parses `git diff --name-status -z` output into dst.
func parseNameStatusZ(out []byte, key func(string) (string, bool), dst map[string]string, overwrite bool) {
	for _, file := range parseChangedFiles(out, key) {
		if overwrite {
			dst[file.Path] = file.Status
		} else if _, exists := dst[file.Path]; !exists {
			dst[file.Path] = file.Status
		}
	}

}

// StagedPaths maps repo-relative-to-served-root path -> true for every
// file with staged (index) changes. Used to drive the stage tick in the file
// tree and to gate Commit. Fails quiet: nil on any error or no repo.
func StagedPaths(root string) map[string]bool {
	files := StagedFiles(root)
	if len(files) == 0 {
		return nil
	}
	staged := make(map[string]bool, len(files))
	for _, k := range files {
		staged[k] = true
	}
	return staged
}

// Status maps repo-relative-to-served-root path -> single-letter status for
// every file git considers changed. Uses porcelain v2 -z, the stable
// null-delimited format. Fails quiet: nil on any error, no repo, or disabled.
func Status(root string) map[string]string {
	return StatusAgainst(root, "HEAD")
}
