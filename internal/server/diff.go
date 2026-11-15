package server

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"faah/internal/git"
	"faah/internal/httpx"
	"faah/internal/render"
	"faah/internal/ui"
)

// handleDiff returns the unified diff of a file against HEAD. available is false
// (with an empty diff and 200) when git is off/absent or the file is unchanged.
//
// In a PR review session, "diff" stays the full merge-base..working-tree diff
// for backward compatibility, but the response also splits it into prDiff
// (diffBase..prHeadSHA -- the PR's own, frozen change) and yourDiff
// (prHeadSHA..working-tree -- what the reviewer has edited/committed locally
// since checkout). Committing in that session only ever changes yourDiff, so
// the frontend can label the two apart instead of showing one blended diff
// that looks the same whether or not the reviewer has touched anything.
func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	_, rel, ok := s.resolvePath(r.URL.Query().Get("path"))
	if !ok {
		httpx.Fail(w, 400, "bad path")
		return
	}
	// A ref names one local commit to read instead of the working tree: the
	// diff that commit itself made to this file, frozen regardless of what has
	// been edited since. Empty ref -> today's working-tree-vs-diffBase diff.
	if ref := r.URL.Query().Get("ref"); ref != "" {
		base := r.URL.Query().Get("base")
		var diff string
		if base != "" && git.ValidSHA(base) && git.ValidSHA(ref) {
			diff = git.DiffBetween(s.ix.Root(), rel, base, ref)
		} else {
			diff = git.DiffCommit(s.ix.Root(), rel, ref)
		}
		httpx.WriteJSON(w, map[string]any{
			"path":      rel,
			"ref":       ref,
			"base":      base,
			"diff":      diff,
			"hunks":     render.HighlightDiff(rel, diff),
			"available": diff != "",
		})
		return
	}
	diff := git.DiffAgainst(s.ix.Root(), rel, s.diffBase)
	if ui.Verbose {
		status := "clean"
		if diff != "" {
			lines := strings.Count(diff, "\n")
			status = fmt.Sprintf("%d diff lines", lines)
		}
		ui.Status("info", "diff", fmt.Sprintf("%s · %s", rel, status), 0, os.Stdout)
	}
	avail := diff != ""
	resp := map[string]any{
		"path":  rel,
		"diff":  diff,
		"hunks": render.HighlightDiff(rel, diff),
	}
	if s.pr != nil {
		prDiff := git.DiffBetween(s.ix.Root(), rel, s.diffBase, s.prHeadSHA)
		yourDiff := git.DiffAgainst(s.ix.Root(), rel, s.prHeadSHA)
		resp["prDiff"] = prDiff
		resp["yourDiff"] = yourDiff
		resp["prHunks"] = render.HighlightDiff(rel, prDiff)
		resp["yourHunks"] = render.HighlightDiff(rel, yourDiff)
		avail = avail || prDiff != "" || yourDiff != ""
	}
	resp["available"] = avail
	httpx.WriteJSON(w, resp)
}

// handleGutter returns per-file changed-line ranges (new-file line numbers) for
// a VS Code-style change gutter. available is false (200, empty arrays) when
// git is off/absent or the file is unchanged/untracked; never 500 for those.
func (s *Server) handleGutter(w http.ResponseWriter, r *http.Request) {
	_, rel, ok := s.resolvePath(r.URL.Query().Get("path"))
	if !ok {
		httpx.Fail(w, 400, "bad path")
		return
	}
	var added, modified, deleted []int
	if ref := r.URL.Query().Get("ref"); ref != "" {
		added, modified, deleted = git.HunksCommit(s.ix.Root(), rel, ref)
	} else {
		added, modified, deleted = git.HunksAgainst(s.ix.Root(), rel, s.diffBase)
	}
	nz := func(v []int) []int { // marshal as [] not null
		if v == nil {
			return []int{}
		}
		return v
	}
	httpx.WriteJSON(w, map[string]any{
		"path":      rel,
		"available": added != nil || modified != nil || deleted != nil,
		"added":     nz(added),
		"modified":  nz(modified),
		"deleted":   nz(deleted),
	})
}
