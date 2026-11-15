package review

import (
	"os"
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
	HiddenWhitespaceFiles int               `json:"hiddenWhitespaceFiles"`
	Files                 []WalkthroughFile `json:"files"`
	TotalFiles            int               `json:"totalFiles"`
	TotalAdditions        int               `json:"totalAdditions"`
	TotalDeletions        int               `json:"totalDeletions"`
	BaseRef               string            `json:"baseRef"`
	HeadRef               string            `json:"headRef"`
	PRMode                bool              `json:"prMode"`
}

// WalkthroughOptions describes the comparison and display of a walkthrough.
type WalkthroughOptions struct {
	Root, DiffBase, DiffHead string
	ComparisonBase           string
	IsPR                     bool
	Statuses                 map[string]string
	IgnoreWhitespace         bool
}

type targetFile struct {
	path, status, oldPath, group string
}

// BuildWalkthrough builds file diffs for the Review Walkthrough.
func BuildWalkthrough(o WalkthroughOptions) WalkthroughResponse {
	chosen := o.ComparisonBase
	branchBase := !o.IsPR && chosen != "" && chosen != "HEAD"
	if branchBase {
		o.DiffBase = git.MergeBase(o.Root, chosen, "HEAD")
		if o.DiffBase == "" {
			o.DiffBase = chosen
		}
	}
	targets, baseRef, headRef, fallback, exactPaths := collectWalkthroughTargets(o)
	if !branchBase && !fallback && len(targets) > 0 {
		targets = attachRenameOrigins(o, baseRef, targets, exactPaths)
	}
	sort.Slice(targets, func(i, j int) bool {
		gi, gj := targets[i].group, targets[j].group
		if gi != gj {
			return groupRank(gi) < groupRank(gj)
		}
		return targets[i].path < targets[j].path
	})

	response := WalkthroughResponse{Files: []WalkthroughFile{}, BaseRef: baseRef, HeadRef: headRef, PRMode: o.IsPR}
	for _, target := range targets {
		file, hidden, include := buildWalkthroughFile(o, baseRef, fallback, exactPaths, target)
		if hidden {
			response.HiddenWhitespaceFiles++
		}
		if include {
			response.Files = append(response.Files, file)
			response.TotalAdditions += file.Additions
			response.TotalDeletions += file.Deletions
		}
	}
	if branchBase {
		response.BaseRef = chosen
	}
	response.TotalFiles = len(response.Files)
	return response
}

func collectWalkthroughTargets(o WalkthroughOptions) ([]targetFile, string, string, bool, map[string]bool) {
	baseRef, headRef, fallback := o.DiffBase, "working-tree", false
	var targets []targetFile
	exactPaths := map[string]bool{}
	if o.IsPR {
		baseRef = o.DiffBase
		headRef = o.DiffHead
		for path, status := range o.Statuses {
			targets = append(targets, targetFile{path: path, status: status, group: fileGroup(path)})
		}
	} else if o.ComparisonBase != "" && o.ComparisonBase != "HEAD" {
		for _, file := range git.ChangedFiles(o.Root, o.DiffBase, "") {
			targets = append(targets, targetFile{path: file.Path, status: file.Status, oldPath: file.From, group: fileGroup(file.Path)})
			exactPaths[file.Path] = true
		}
		for path, status := range o.Statuses {
			if status == "U" {
				targets = append(targets, targetFile{path: path, status: status, group: fileGroup(path)})
			}
		}
	} else {
		statusMap := o.Statuses
		for path, status := range statusMap {
			targets = append(targets, targetFile{path: path, status: status, group: fileGroup(path)})
		}

		// If working tree is clean, fallback to HEAD~1..HEAD so the reviewer has immediate diff to inspect
		if len(targets) == 0 && git.Available(o.Root) {
			if headOut, err := exec.Command("git", "-C", o.Root, "rev-parse", "--verify", "HEAD").Output(); err == nil {
				headSHA := strings.TrimSpace(string(headOut))
				if cfList := git.CommitFiles(o.Root, headSHA); len(cfList) > 0 {
					baseRef = "HEAD~1"
					fallback = true
					if len(headSHA) > 7 {
						headRef = headSHA[:7]
					} else {
						headRef = headSHA
					}
					for _, cf := range cfList {
						if o.IgnoreWhitespace {
							exactPaths[cf.Path] = true
						}
						targets = append(targets, targetFile{path: cf.Path, status: cf.Status, oldPath: cf.From, group: fileGroup(cf.Path)})
					}
				}
			}
		}
	}

	return targets, baseRef, headRef, fallback, exactPaths
}
func attachRenameOrigins(o WalkthroughOptions, baseRef string, targets []targetFile, exactPaths map[string]bool) []targetFile {
	head := ""
	if o.IsPR {
		head = o.DiffHead
	}
	moves := git.ChangedFiles(o.Root, baseRef, head)
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
func buildWalkthroughFile(o WalkthroughOptions, baseRef string, fallback bool, exactPaths map[string]bool, target targetFile) (WalkthroughFile, bool, bool) {
	head := ""
	if o.IsPR {
		head = o.DiffHead
	} else if fallback {
		head = "HEAD"
	}
	paths := []string{target.path}
	if target.oldPath != "" {
		paths = append(paths, target.oldPath)
	}
	readDiff := git.DiffPaths
	if o.IgnoreWhitespace {
		readDiff = git.DiffPathsIgnoringWhitespace
	}
	var diffText string
	if !o.IsPR && target.status == "U" {
		// Git diff against a ref omits untracked paths. Compare them to an empty
		// file instead; exit code 1 means differences were found.
		out, _ := exec.Command("git", "-C", o.Root, "diff", "--no-index", "--no-color", "--no-ext-diff", "--", os.DevNull, target.path).Output()
		diffText = string(out)
		target.status = "A"
	} else {
		diffText = readDiff(o.Root, baseRef, head, paths...)
	}
	if diffText == "" && target.oldPath == "" {
		if o.IgnoreWhitespace && exactPaths[target.path] {
			return WalkthroughFile{}, true, false
		}
		return WalkthroughFile{}, false, false
	}

	hunks := render.HighlightDiff(target.path, diffText)
	if o.IgnoreWhitespace {
		// Git suppresses wholly blank hunks, but leaves blank edits in mixed
		// hunks. Keep the parser's line numbers when hiding those rows.
		for i := range hunks {
			rows := hunks[i].Rows[:0]
			for _, row := range hunks[i].Rows {
				if row.Type != "ctx" && strings.TrimSpace(row.Text) == "" {
					continue
				}
				rows = append(rows, row)
			}
			hunks[i].Rows = rows
		}
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
