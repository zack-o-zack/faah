package server

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"faah/internal/explain"
	"faah/internal/review"
	"faah/internal/ui"
)

func (s *Server) explainPRTarget(ctx context.Context) (explain.Target, explain.Evidence, error) {
	if s.pr == nil || s.prHeadSHA == "" {
		return explain.Target{}, explain.Evidence{}, errors.New("Open the pull request in review mode to explain it")
	}
	snap := s.pr.Snapshot()
	overview, err := s.loadPROverview(ctx, false)
	if err != nil && ui.Verbose {
		ui.Status("info", "explain", fmt.Sprintf("PR description unavailable: %v", err), 0, os.Stdout)
	}
	files := review.BuildWalkthrough(review.WalkthroughOptions{
		Root: s.ix.Root(), DiffBase: s.diffBase, DiffHead: s.prHeadSHA, Statuses: s.ix.PRFiles(),
	}).Files
	names := make([]string, 0, len(files))
	for _, f := range files {
		names = append(names, f.Status+" "+f.Path)
	}
	sort.Strings(names)
	key := explain.Key(explain.KindPR, snap.DiffBase, s.prHeadSHA, explain.Key(names...))
	short := func(s string) string { return s[:min(12, len(s))] }
	description := fmt.Sprintf("#%d %q (%s ← %s)\n%s\nMerge-base %s, head %s", snap.Meta.Number, snap.Meta.Title, snap.Meta.BaseRef, snap.Meta.HeadRef, snap.Target.URL, short(snap.DiffBase), short(s.prHeadSHA))
	if err == nil && strings.TrimSpace(overview.Description.Body) != "" {
		description += "\n" + explain.CapExternalText(strings.TrimSpace(overview.Description.Body))
	}
	diff := fmt.Sprintf("The full diff is saved at %s\nReference command: git diff %s %s", s.prDiffFile(), snap.DiffBase, s.prHeadSHA)
	sections := []explain.Section{
		{Title: "Pull request", Body: description},
		{Title: "Diff", Body: diff},
		{Title: "Changed files", Body: prFileReferences(files)},
	}
	return explain.Target{PR: true, Col: -1, Name: fmt.Sprintf("PR #%d", snap.Meta.Number)}, explain.Evidence{Kind: explain.KindPR, Key: key, Hash: key, Packet: explain.BuildPacket(sections)}, nil
}

func prFileReferences(files []review.WalkthroughFile) string {
	var b strings.Builder
	for _, file := range files[:min(60, len(files))] {
		name := file.Path
		if file.Status == "R" {
			name = file.OldPath + " → " + file.Path
		}
		fmt.Fprintf(&b, "- %s %s", file.Status, name)
		if file.Status == "D" {
			b.WriteString(" (deleted)\n")
			continue
		}
		var ranges []string
		for _, hunk := range file.Hunks {
			first, last := 0, 0
			for _, row := range hunk.Rows {
				if row.NewLine > 0 {
					if first == 0 {
						first = row.NewLine
					}
					last = row.NewLine
				}
			}
			if first > 0 {
				ranges = append(ranges, explain.Reference(file.Path, first, last))
			} else {
				ranges = append(ranges, fmt.Sprintf("(removed lines near %s:%d)", file.Path, hunk.NewStart))
			}
		}
		if len(ranges) > 0 {
			b.WriteString(": " + strings.Join(ranges, ", "))
		}
		b.WriteByte('\n')
	}
	if len(files) > 60 {
		fmt.Fprintf(&b, "(+%d more)\n", len(files)-60)
	}
	return strings.TrimSpace(b.String())
}
