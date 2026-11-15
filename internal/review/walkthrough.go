package review

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"faah/internal/git"
	"faah/internal/render"
)

// WalkthroughFile holds one file's diff hunks and extracted cognitive understanding.
type WalkthroughFile struct {
	Path          string            `json:"path"`
	Status        string            `json:"status"` // "M", "A", "D"
	Additions     int               `json:"additions"`
	Deletions     int               `json:"deletions"`
	Diff          string            `json:"diff"`
	Hunks         []render.DiffHunk `json:"hunks"`
	Understanding *Understanding    `json:"understanding"`
}

// Understanding aggregates fast returns, edge cases, and core logic blocks.
type Understanding struct {
	Summary     string        `json:"summary"`
	FastReturns []InsightItem `json:"fastReturns"`
	EdgeCases   []InsightItem `json:"edgeCases"`
	CoreLogic   []InsightItem `json:"coreLogic"`
}

// InsightItem represents a surfaced guard, edge case, or core code block.
type InsightItem struct {
	Line        int    `json:"line"`
	EndLine     int    `json:"endLine,omitempty"`
	Kind        string `json:"kind"` // "guard", "nil_check", "auth", "validation", "cache", "error", "timeout", "panic", "fallback", "core", "function"
	Text        string `json:"text"`
	Explanation string `json:"explanation"`
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

var (
	reReturn     = regexp.MustCompile(`(?i)\b(?:return|continue|break|throw|reject|goto)\b`)
	reNilCheck   = regexp.MustCompile(`(?i)(?:==\s*nil|!=\s*nil|===?\s*null|!==?\s*null|===?\s*undefined|!==?\s*undefined|!\w+)`)
	reAuth       = regexp.MustCompile(`(?i)(?:auth|permission|forbidden|unauthorized|token|credential|denied|role|secret|allow)`)
	reValidation = regexp.MustCompile(`(?i)(?:validate|invalid|required|missing|empty|len\(|<=?\s*0|>=?\s*0|bounds|overflow)`)
	reCache      = regexp.MustCompile(`(?i)(?:cache|hit|cached|memo|idempotent|existing|found)`)
	reError      = regexp.MustCompile(`(?i)(?:err\s*!=\s*nil|errors\.New|fmt\.Errorf|new\s+Error|Exception|failed|failure)`)
	reTimeout    = regexp.MustCompile(`(?i)(?:timeout|timed out|ctx\.Done\(\)|DeadlineExceeded|Canceled|expired)`)
	reFallback   = regexp.MustCompile(`(?i)(?:fallback|default:|recover\(\)|except\s*:|catch\s*\()`)
	rePanic      = regexp.MustCompile(`(?i)(?:panic\(|fatal\(|fatalf\(|assert\()`)
	reFuncDef    = regexp.MustCompile(`(?i)\b(?:func\s+|function\s+|class\s+|def\s+|type\s+\w+\s+(?:struct|interface))\b`)
)

func truncateInsightText(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) > max {
		return s[:max-3] + "..."
	}
	return s
}

func pluralS(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// insightExts are the languages whose returns, errors and functions the
// patterns below recognise.
var insightExts = map[string]bool{
	".go": true, ".js": true, ".mjs": true, ".cjs": true, ".jsx": true, ".ts": true, ".tsx": true,
	".py": true, ".rb": true, ".rs": true, ".java": true, ".kt": true, ".swift": true, ".c": true,
	".h": true, ".cc": true, ".cpp": true, ".hpp": true, ".cs": true, ".php": true, ".scala": true,
	".dart": true, ".lua": true, ".sh": true,
}

// extractCodeUnderstanding parses diff hunks to surface guard bailouts, edge cases, and core logic.
func extractCodeUnderstanding(rel string, hunks []render.DiffHunk) *Understanding {
	und := &Understanding{
		FastReturns: []InsightItem{},
		EdgeCases:   []InsightItem{},
		CoreLogic:   []InsightItem{},
	}
	if len(hunks) == 0 {
		und.Summary = "No modifications in this file."
		return und
	}
	// The patterns read code: in YAML, JSON or prose every line would be noise.
	if !insightExts[strings.ToLower(filepath.Ext(rel))] {
		return und
	}

	type rowInfo struct {
		row render.DiffRow
	}
	var addedRows []rowInfo
	for _, h := range hunks {
		for _, r := range h.Rows {
			if r.Type == "add" {
				addedRows = append(addedRows, rowInfo{row: r})
			}
		}
	}

	if len(addedRows) == 0 {
		und.Summary = "Only line deletions or unmodified context in this file."
		return und
	}

	for i := 0; i < len(addedRows); i++ {
		cur := addedRows[i].row
		txt := strings.TrimSpace(cur.Text)
		if txt == "" || strings.HasPrefix(txt, "//") || strings.HasPrefix(txt, "/*") || strings.HasPrefix(txt, "*") {
			continue
		}

		hasReturnInside := reReturn.MatchString(txt)
		blockHasReturn := hasReturnInside
		if !hasReturnInside && (strings.HasPrefix(txt, "if ") || strings.HasPrefix(txt, "if(")) {
			for j := i + 1; j < len(addedRows) && j <= i+3; j++ {
				nextTxt := strings.TrimSpace(addedRows[j].row.Text)
				if reReturn.MatchString(nextTxt) {
					blockHasReturn = true
					break
				}
				if strings.Contains(nextTxt, "}") {
					break
				}
			}
		}

		// 1. Error & failure edge cases
		if reError.MatchString(txt) || (blockHasReturn && strings.Contains(txt, "err")) {
			expl := "Error check and failure propagation"
			if strings.Contains(txt, "fmt.Errorf") || strings.Contains(txt, "errors.New") {
				expl = "Constructs and returns explicit error"
			}
			und.EdgeCases = append(und.EdgeCases, InsightItem{
				Line:        cur.NewLine,
				Kind:        "error",
				Text:        truncateInsightText(txt, 90),
				Explanation: expl,
			})
			continue
		}

		if reTimeout.MatchString(txt) {
			und.EdgeCases = append(und.EdgeCases, InsightItem{
				Line:        cur.NewLine,
				Kind:        "timeout",
				Text:        truncateInsightText(txt, 90),
				Explanation: "Context deadline or timeout handler",
			})
			continue
		}

		if rePanic.MatchString(txt) {
			und.EdgeCases = append(und.EdgeCases, InsightItem{
				Line:        cur.NewLine,
				Kind:        "panic",
				Text:        truncateInsightText(txt, 90),
				Explanation: "Assertion failure or unrecoverable panic exit",
			})
			continue
		}

		if reFallback.MatchString(txt) {
			und.EdgeCases = append(und.EdgeCases, InsightItem{
				Line:        cur.NewLine,
				Kind:        "fallback",
				Text:        truncateInsightText(txt, 90),
				Explanation: "Fallback resilience path on unexpected state",
			})
			continue
		}

		// 2. Fast returns & bailouts
		if blockHasReturn {
			kind := "guard"
			expl := "Early return guard clause"

			if reAuth.MatchString(txt) {
				kind = "auth"
				expl = "Authorization or access check guard"
			} else if reNilCheck.MatchString(txt) {
				kind = "nil_check"
				expl = "Nil / null guard preventing panic on invalid reference"
			} else if reCache.MatchString(txt) {
				kind = "cache"
				expl = "Fast-path cache or idempotent shortcut"
			} else if reValidation.MatchString(txt) {
				kind = "validation"
				expl = "Input boundary or parameter validation bailout"
			}

			und.FastReturns = append(und.FastReturns, InsightItem{
				Line:        cur.NewLine,
				Kind:        kind,
				Text:        truncateInsightText(txt, 90),
				Explanation: expl,
			})
			continue
		}

		// 3. Core logic declarations
		if reFuncDef.MatchString(txt) {
			und.CoreLogic = append(und.CoreLogic, InsightItem{
				Line:        cur.NewLine,
				Kind:        "function",
				Text:        truncateInsightText(txt, 90),
				Explanation: "Introduces or updates functional declaration",
			})
		}
	}

	parts := []string{}
	if len(und.FastReturns) > 0 {
		parts = append(parts, fmt.Sprintf("%d fast return%s", len(und.FastReturns), pluralS(len(und.FastReturns))))
	}
	if len(und.EdgeCases) > 0 {
		parts = append(parts, fmt.Sprintf("%d edge case%s", len(und.EdgeCases), pluralS(len(und.EdgeCases))))
	}
	if len(und.CoreLogic) > 0 {
		parts = append(parts, fmt.Sprintf("%d core change%s", len(und.CoreLogic), pluralS(len(und.CoreLogic))))
	}
	if len(parts) > 0 {
		und.Summary = fmt.Sprintf("Surfaces %s across modified hunks.", strings.Join(parts, ", "))
	} else {
		und.Summary = fmt.Sprintf("Modified %d line%s in this file.", len(addedRows), pluralS(len(addedRows)))
	}

	return und
}

// BuildWalkthrough builds file diffs and extracted understanding for the Review Walkthrough.
func BuildWalkthrough(root, diffBase, diffHead string, isPR bool, statuses map[string]string) WalkthroughResponse {
	var (
		walkthroughFiles = []WalkthroughFile{}
		baseRef          = diffBase
		headRef          = "working-tree"
		totalAdditions   = 0
		totalDeletions   = 0
	)

	type targetFile struct {
		path   string
		status string
	}
	var targets []targetFile

	if isPR {
		baseRef = diffBase
		headRef = diffHead
		for path, status := range statuses {
			targets = append(targets, targetFile{path: path, status: status})
		}
	} else {
		statusMap := statuses
		for path, status := range statusMap {
			targets = append(targets, targetFile{path: path, status: status})
		}

		// If working tree is clean, fallback to HEAD~1..HEAD so the reviewer has immediate diff to inspect
		if len(targets) == 0 && git.Available(root) {
			if headOut, err := exec.Command("git", "-C", root, "rev-parse", "--verify", "HEAD").Output(); err == nil {
				headSHA := strings.TrimSpace(string(headOut))
				if cfList := git.CommitFiles(root, headSHA); len(cfList) > 0 {
					baseRef = "HEAD~1"
					if len(headSHA) > 7 {
						headRef = headSHA[:7]
					} else {
						headRef = headSHA
					}
					for _, cf := range cfList {
						targets = append(targets, targetFile{path: cf.Path, status: cf.Status})
					}
				}
			}
		}
	}

	sort.Slice(targets, func(i, j int) bool {
		return targets[i].path < targets[j].path
	})

	for _, target := range targets {
		var diffText string
		if isPR {
			diffText = git.DiffBetween(root, target.path, diffBase, diffHead)
			if diffText == "" {
				diffText = git.DiffAgainst(root, target.path, diffBase)
			}
		} else if baseRef == "HEAD~1" {
			diffText = git.DiffBetween(root, target.path, "HEAD~1", "HEAD")
		} else {
			diffText = git.DiffAgainst(root, target.path, baseRef)
		}

		if diffText == "" {
			continue
		}

		hunks := render.HighlightDiff(target.path, diffText)
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
		und := extractCodeUnderstanding(target.path, hunks)

		walkthroughFiles = append(walkthroughFiles, WalkthroughFile{
			Path:          target.path,
			Status:        target.status,
			Additions:     addCount,
			Deletions:     delCount,
			Diff:          diffText,
			Hunks:         hunks,
			Understanding: und,
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
