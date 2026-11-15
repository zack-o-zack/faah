package review

import (
	"os/exec"
	"sort"
	"strings"

	"faah/internal/git"
	"faah/internal/render"
)

// WalkthroughFile holds one file's diff hunks.
type WalkthroughFile struct {
	Path      string            `json:"path"`
	Status    string            `json:"status"` // "M", "A", "D", "R"
	Additions int               `json:"additions"`
	Deletions int               `json:"deletions"`
	Diff      string            `json:"diff"`
	Hunks     []render.DiffHunk `json:"hunks"`
	Group     string            `json:"group"`
	OldPath   string            `json:"oldPath,omitempty"`
}

// WalkthroughResponse is the response payload for /api/review/walkthrough.
type WalkthroughResponse struct {
	Files          []WalkthroughFile `json:"files"`
	TotalFiles     int               `json:"totalFiles"`
	TotalAdditions int               `json:"totalAdditions"`
	TotalDeletions int               `json:"totalDeletions"`
	BaseRef        string            `json:"baseRef"`
	HeadRef        string            `json:"headRef"`
	PRMode         bool              `json:"prMode"`
}

// BuildWalkthrough builds file diffs for the Review Walkthrough.
func BuildWalkthrough(root, diffBase, diffHead string, isPR bool, statuses map[string]string) WalkthroughResponse {
	var (
		walkthroughFiles = []WalkthroughFile{}
		baseRef          = diffBase
		headRef          = "working-tree"
		totalAdditions   = 0
		totalDeletions   = 0
		fallback         = false
	)

	type targetFile struct {
		path    string
		status  string
		oldPath string
		group   string
	}
	var targets []targetFile

	if isPR {
		baseRef = diffBase
		headRef = diffHead
		for path, status := range statuses {
			targets = append(targets, targetFile{path: path, status: status, group: fileGroup(path)})
		}
	} else {
		statusMap := statuses
		for path, status := range statusMap {
			targets = append(targets, targetFile{path: path, status: status, group: fileGroup(path)})
		}

		// If working tree is clean, fallback to HEAD~1..HEAD so the reviewer has immediate diff to inspect
		if len(targets) == 0 && git.Available(root) {
			if headOut, err := exec.Command("git", "-C", root, "rev-parse", "--verify", "HEAD").Output(); err == nil {
				headSHA := strings.TrimSpace(string(headOut))
				if cfList := git.CommitFiles(root, headSHA); len(cfList) > 0 {
					baseRef = "HEAD~1"
					fallback = true
					if len(headSHA) > 7 {
						headRef = headSHA[:7]
					} else {
						headRef = headSHA
					}
					for _, cf := range cfList {
						targets = append(targets, targetFile{path: cf.Path, status: cf.Status, oldPath: cf.From, group: fileGroup(cf.Path)})
					}
				}
			}
		}
	}

	if !fallback && len(targets) > 0 {
		head := ""
		if isPR {
			head = diffHead
		}
		moves := git.ChangedFiles(root, baseRef, head)
		targetIndices := make(map[string]int, len(targets))
		for i, target := range targets {
			targetIndices[target.path] = i
		}
		oldPaths := map[string]bool{}
		for _, move := range moves {
			if move.Status != "R" || move.From == "" {
				continue
			}
			if i, exists := targetIndices[move.Path]; exists {
				targets[i].oldPath = move.From
				targets[i].status = "R"
				oldPaths[move.From] = true
			}
		}
		filtered := targets[:0]
		for _, target := range targets {
			if !oldPaths[target.path] {
				filtered = append(filtered, target)
			}
		}
		targets = filtered
	}
	sort.Slice(targets, func(i, j int) bool {
		gi, gj := targets[i].group, targets[j].group
		if gi != gj {
			return groupRank(gi) < groupRank(gj)
		}
		return targets[i].path < targets[j].path
	})

	for _, target := range targets {
		head := ""
		if isPR {
			head = diffHead
		} else if fallback {
			head = "HEAD"
		}
		paths := []string{target.path}
		if target.oldPath != "" {
			paths = append(paths, target.oldPath)
		}
		diffText := git.DiffPaths(root, baseRef, head, paths...)
		if diffText == "" && target.oldPath == "" {
			continue
		}

		hunks := render.HighlightDiff(target.path, diffText)
		if target.oldPath != "" && len(hunks) == 0 {
			diffText = ""
		}
		addCount, delCount := 0, 0
		for _, h := range hunks {
			for _, row := range h.Rows {
				if row.Type == "add" {
					addCount++
				} else if row.Type == "del" {
					delCount++
				}
			}
		}

		totalAdditions += addCount
		totalDeletions += delCount

		walkthroughFiles = append(walkthroughFiles, WalkthroughFile{
			Path:      target.path,
			Status:    target.status,
			Additions: addCount,
			Deletions: delCount,
			Diff:      diffText,
			Hunks:     hunks,
			Group:     target.group,
			OldPath:   target.oldPath,
		})
	}

	return WalkthroughResponse{
		Files:          walkthroughFiles,
		TotalFiles:     len(walkthroughFiles),
		TotalAdditions: totalAdditions,
		TotalDeletions: totalDeletions,
		BaseRef:        baseRef,
		HeadRef:        headRef,
		PRMode:         isPR,
	}
}
