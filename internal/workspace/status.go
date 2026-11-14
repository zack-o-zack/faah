package workspace

import (
	"faah/internal/git"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SetDiffBase sets the git ref or commit against which working tree diffs and statuses are computed.
func (ix *Index) SetDiffBase(base string) {
	ix.mu.Lock()
	ix.diffBase = base
	ix.mu.Unlock()
}

// diffBaseRef returns the current git diff base ref (e.g. "HEAD" or PR merge-base).
func (ix *Index) diffBaseRef() string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.diffBase
}

// SetPRHead stores the checked-out PR head commit SHA in PR review mode.
func (ix *Index) SetPRHead(head string) {
	ix.mu.Lock()
	base := ix.diffBase
	ix.mu.Unlock()
	// The PR's own file set only moves with the head or the base, so it is
	// worked out here once rather than on every git-status tick.
	files := git.FilesBetween(ix.root, base, head)
	ix.mu.Lock()
	ix.prHead = head
	ix.prFiles = files
	ix.mu.Unlock()
}

// PRFiles returns the paths the PR itself changes (diffBase..PR head) with
// their git status letters, as opposed to files only the reviewer has touched.
// Empty outside PR review.
func (ix *Index) PRFiles() map[string]string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	out := make(map[string]string, len(ix.prFiles))
	for k, v := range ix.prFiles {
		out[k] = v
	}
	return out
}

// SetPushedHead records the PR branch's tip after a push (or pull), which is
// the boundary "ahead"/"unpushed" are counted from. Unlike prHead it moves on push.
func (ix *Index) SetPushedHead(head string) {
	ix.mu.Lock()
	ix.pushedHead = head
	ix.mu.Unlock()
}

// pushedHeadRef returns the unpushed boundary, or empty outside PR review mode.
func (ix *Index) pushedHeadRef() string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.pushedHead
}

// prHeadRef returns the checked-out PR head commit SHA, or empty if not in PR review mode.
func (ix *Index) prHeadRef() string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.prHead
}

// GitChanges returns the number of modified files and their workspace-relative paths.
func (ix *Index) GitChanges() (int, []string) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	res := make([]string, len(ix.gitFiles))
	copy(res, ix.gitFiles)
	return ix.gitChanges, res
}

// GitStatusMap returns a copy of the mapping from relative path to git status letter.
func (ix *Index) GitStatusMap() map[string]string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	if ix.gitStatusMap == nil {
		return map[string]string{}
	}
	res := make(map[string]string, len(ix.gitStatusMap))
	for k, v := range ix.gitStatusMap {
		res[k] = v
	}
	return res
}

// HasDiffAvailable reports in O(1) whether rel has a tracked git diff according
// to the in-memory index maps (excluding untracked "U" files), or whether the
// caller should fall back when diffBase differs from the index's diffBase.
func (ix *Index) HasDiffAvailable(rel, serverDiffBase string, isPR bool) (avail, authoritative bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	ixBase := ix.diffBase
	if ixBase == "" {
		ixBase = "HEAD"
	}
	srvBase := serverDiffBase
	if srvBase == "" {
		srvBase = "HEAD"
	}
	if ixBase != srvBase || (ix.gitStatusMap == nil && ix.builtAt.IsZero()) {
		return false, false
	}
	if st := ix.gitStatusMap[rel]; st != "" && st != "U" {
		return true, true
	}
	if isPR {
		if st := ix.prFiles[rel]; st != "" && st != "U" {
			return true, true
		}
		if st := ix.gitYourStatusMap[rel]; st != "" && st != "U" {
			return true, true
		}
	}
	return false, true
}

func computeDirtyState(gs, ys map[string]string) (dirtyDirs, yourDirtyDirs map[string]bool, gitFiles []string) {
	dirtyDirs = map[string]bool{}
	for p := range gs {
		gitFiles = append(gitFiles, p)
		for i := strings.LastIndexByte(p, '/'); i >= 0; i = strings.LastIndexByte(p, '/') {
			p = p[:i]
			dirtyDirs[p] = true
		}
	}
	sort.Slice(gitFiles, func(i, j int) bool {
		si, sj := gs[gitFiles[i]], gs[gitFiles[j]]
		if (si != "U") != (sj != "U") {
			return si != "U"
		}
		return gitFiles[i] < gitFiles[j]
	})
	yourDirtyDirs = map[string]bool{}
	for p := range ys {
		for i := strings.LastIndexByte(p, '/'); i >= 0; i = strings.LastIndexByte(p, '/') {
			p = p[:i]
			yourDirtyDirs[p] = true
		}
	}
	return dirtyDirs, yourDirtyDirs, gitFiles
}

// gitPartial returns a copy of the staged paths that were modified again in
// the worktree after staging, as of the last git status run.
func (ix *Index) gitPartial() map[string]bool {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	if len(ix.gitPartialMap) == 0 {
		return nil
	}
	m := make(map[string]bool, len(ix.gitPartialMap))
	for k, v := range ix.gitPartialMap {
		m[k] = v
	}
	return m
}

// UpdateGitStatus re-runs git status, updates in-memory status codes, staged
// flags, and dirty directory markers across ix.children without re-walking
// the filesystem tree. Reports gitChanges count, gitFiles list, whether
// anything changed (status, staged, or yourStatus), and the raw status/staged/dirty-dir
// maps.
func (ix *Index) UpdateGitStatus() (count int, files []string, changed bool, statuses map[string]string, dirtyDirs map[string]bool, staged map[string]bool, yourStatuses map[string]string, yourDirtyDirs map[string]bool) {
	if !ix.Ready() || git.Disabled() || !git.Available(ix.root) {
		return 0, nil, false, nil, nil, nil, nil, nil
	}

	base := ix.diffBaseRef()
	head := ix.prHeadRef()
	gs, sg, pt, ys := git.StatusAndStagedAgainst(ix.root, base, head)
	if gs == nil {
		gs = map[string]string{}
	}
	if sg == nil {
		sg = map[string]bool{}
	}
	if pt == nil {
		pt = map[string]bool{}
	}
	if head != "" && ys == nil {
		ys = map[string]string{}
	}
	newDirtyDirs, newYourDirtyDirs, newGitFiles := computeDirtyState(gs, ys)

	ix.mu.Lock()
	defer ix.mu.Unlock()

	// Check if status, staged, and yourStatuses maps are all unchanged
	same := len(gs) == len(ix.gitStatusMap) && len(sg) == len(ix.gitStagedMap) && len(pt) == len(ix.gitPartialMap) && len(ys) == len(ix.gitYourStatusMap)
	if same {
		for k, v := range gs {
			if ix.gitStatusMap[k] != v {
				same = false
				break
			}
		}
	}
	if same {
		for k, v := range sg {
			if ix.gitStagedMap[k] != v {
				same = false
				break
			}
		}
	}
	if same {
		for k, v := range pt {
			if ix.gitPartialMap[k] != v {
				same = false
				break
			}
		}
	}
	if same {
		for k, v := range ys {
			if ix.gitYourStatusMap[k] != v {
				same = false
				break
			}
		}
	}
	if same {
		resFiles := make([]string, len(ix.gitFiles))
		copy(resFiles, ix.gitFiles)
		return ix.gitChanges, resFiles, false, gs, newDirtyDirs, sg, ys, newYourDirtyDirs
	}

	// Update nodes in-place across ix.children
	for dir, kids := range ix.children {
		filtered := kids[:0]
		for _, node := range kids {
			if node.Dir {
				node.Dirty = newDirtyDirs[node.Path]
				node.YourDirty = newYourDirtyDirs[node.Path]
				filtered = append(filtered, node)
			} else {
				newStatus := gs[node.Path]
				newStaged := sg[node.Path]
				newPartial := pt[node.Path]
				newYourStatus := ys[node.Path]

				if (node.Status == "D" || node.YourStatus == "D") && newStatus != "D" && newYourStatus != "D" {
					absPath := filepath.Join(ix.root, filepath.FromSlash(node.Path))
					if _, err := os.Stat(absPath); err != nil {
						continue // committed deletion: remove from tree
					}
				}

				node.Status = newStatus
				node.Staged = newStaged
				node.Partial = newPartial
				node.YourStatus = newYourStatus
				filtered = append(filtered, node)
			}
		}
		ix.children[dir] = filtered
	}

	injectDeletedNodes(ix.children, gs, sg, pt, ys, newDirtyDirs, newYourDirtyDirs)
	cleanupEmptyDirs(ix.children, ix.root)

	ix.gitChanges = len(newGitFiles)
	ix.gitFiles = newGitFiles
	ix.gitStatusMap = gs
	ix.gitStagedMap = sg
	ix.gitPartialMap = pt
	ix.gitYourStatusMap = ys

	resFiles := make([]string, len(ix.gitFiles))
	copy(resFiles, ix.gitFiles)
	return ix.gitChanges, resFiles, true, gs, newDirtyDirs, sg, ys, newYourDirtyDirs
}

// MetaGitChanges returns metadata status counts, lazily initializing status once ready.
func (ix *Index) MetaGitChanges(inGit bool) (int, []string) {
	if inGit && ix.Ready() {
		ix.mu.RLock()
		noStatus := ix.gitStatusMap == nil
		ix.mu.RUnlock()
		if noStatus {
			ix.UpdateGitStatus()
		}
	}
	return ix.GitChanges()
}
