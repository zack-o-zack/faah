package review

import (
	"sort"
	"strings"

	"faah/internal/diffview"
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
	HiddenWhitespaceFiles int               `json:"hiddenWhitespaceFiles"`
	Files                 []WalkthroughFile `json:"files"`
	TotalFiles            int               `json:"totalFiles"`
	TotalAdditions        int               `json:"totalAdditions"`
	TotalDeletions        int               `json:"totalDeletions"`
	BaseRef               string            `json:"baseRef"`
	HeadRef               string            `json:"headRef"`
}

// WalkthroughOptions describes the comparison and display of a walkthrough.
type WalkthroughOptions struct {
	Root, DiffBase, DiffHead string
	Statuses                 map[string]string
	IgnoreWhitespace         bool
}

type targetFile struct {
	path, status, oldPath, group string
}

type walkthroughTargets struct {
	files            []targetFile
	baseRef, headRef string
	exactPaths       map[string]bool
}

// BuildWalkthrough builds file diffs for the Review Walkthrough.
func BuildWalkthrough(o WalkthroughOptions) WalkthroughResponse {
	collected := collectWalkthroughTargets(o)
	if len(collected.files) > 0 {
		collected.files = attachRenameOrigins(o, collected.baseRef, collected.files, collected.exactPaths)
	}
	sort.Slice(collected.files, func(i, j int) bool {
		gi, gj := collected.files[i].group, collected.files[j].group
		if gi != gj {
			return groupRank(gi) < groupRank(gj)
		}
		return collected.files[i].path < collected.files[j].path
	})

	response := WalkthroughResponse{Files: []WalkthroughFile{}, BaseRef: collected.baseRef, HeadRef: collected.headRef}
	for _, target := range collected.files {
		file, hidden, include := buildWalkthroughFile(o, collected.baseRef, collected.exactPaths, target)
		if hidden {
			response.HiddenWhitespaceFiles++
		}
		if include {
			response.Files = append(response.Files, file)
			response.TotalAdditions += file.Additions
			response.TotalDeletions += file.Deletions
		}
	}
	response.TotalFiles = len(response.Files)
	return response
}

func collectWalkthroughTargets(o WalkthroughOptions) walkthroughTargets {
	collected := walkthroughTargets{baseRef: o.DiffBase, headRef: o.DiffHead, exactPaths: map[string]bool{}}
	for path, status := range o.Statuses {
		collected.files = append(collected.files, targetFile{path: path, status: status, group: fileGroup(path)})
	}
	return collected
}
func attachRenameOrigins(o WalkthroughOptions, baseRef string, targets []targetFile, exactPaths map[string]bool) []targetFile {
	moves := git.ChangedFiles(o.Root, baseRef, o.DiffHead)
	if o.IgnoreWhitespace {
		for _, move := range moves {
			exactPaths[move.Path] = true
		}
	}
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
	return targets
}
func buildWalkthroughFile(o WalkthroughOptions, baseRef string, exactPaths map[string]bool, target targetFile) (WalkthroughFile, bool, bool) {
	paths := []string{target.path}
	if target.oldPath != "" {
		paths = append(paths, target.oldPath)
	}
	diffText, hunks := diffview.Read(o.Root, target.path, baseRef, o.DiffHead, o.IgnoreWhitespace, paths[1:]...)
	if diffText == "" && target.oldPath == "" {
		if o.IgnoreWhitespace && exactPaths[target.path] {
			return WalkthroughFile{}, true, false
		}
		return WalkthroughFile{}, false, false
	}

	if o.IgnoreWhitespace {
		if target.oldPath != "" && len(hunks) == 0 &&
			!strings.Contains(diffText, "Binary files ") && !strings.Contains(diffText, "old mode ") {
			diffText = ""
		}
	}
	// Git reports identical rename content with a 100% similarity header.
	// Binary edits also have no text hunks, so hunks cannot identify pure moves.
	if target.oldPath != "" && strings.Contains(diffText, "\nsimilarity index 100%\n") && !strings.Contains(diffText, "\nold mode ") {
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

	return WalkthroughFile{
		Path:      target.path,
		Status:    target.status,
		Additions: addCount,
		Deletions: delCount,
		Diff:      diffText,
		Hunks:     hunks,
		Group:     target.group,
		OldPath:   target.oldPath,
	}, false, true
}
