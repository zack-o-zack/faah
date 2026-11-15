package server

import (
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"faah/internal/fuzzy"
	"faah/internal/httpx"
	"faah/internal/ui"
	"faah/internal/workspace"
)

func (s *Server) handleTree(w http.ResponseWriter, r *http.Request) {
	dir := strings.Trim(r.URL.Query().Get("dir"), "/")
	kids, ok := s.ix.Children(dir)
	if !ok && !s.ix.Ready() {
		// If indexing is still in flight, wait up to 300ms for this directory to be scanned
		for i := 0; i < 30; i++ {
			time.Sleep(10 * time.Millisecond)
			if kids, ok = s.ix.Children(dir); ok {
				break
			}
			if s.ix.Ready() {
				kids, ok = s.ix.Children(dir)
				break
			}
		}
	}
	if !ok {
		httpx.Fail(w, 404, "not indexed: "+dir)
		return
	}
	if keep := treeViewFilter(r.URL.Query().Get("compact")); keep != nil {
		kids, _ = s.ix.CompactChildren(dir, keep)
	}
	httpx.WriteJSON(w, map[string]any{"dir": dir, "children": kids})
}

// treeViewFilter says which entries a sidebar view shows, for compacting
// folder chains the way that view sees them: every entry, changed ones, or
// in PR review the reviewer's own (not pushed) ones. Empty means no compacting.
func treeViewFilter(view string) func(workspace.Node) bool {
	switch view {
	case "all":
		return func(workspace.Node) bool { return true }
	case "changed":
		return func(n workspace.Node) bool { return n.Dirty || n.Status != "" }
	case "yours":
		return func(n workspace.Node) bool { return n.YourDirty || n.YourStatus != "" }
	}
	return nil
}

func (s *Server) handleFind(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if !s.ix.Ready() {
		s.ix.WaitReady(300 * time.Millisecond)
	}
	ready := s.ix.Ready()
	res := fuzzy.Find(s.ix.Files(), q, limit)
	if res == nil {
		res = []fuzzy.Result{}
	}
	if ui.Verbose && q != "" {
		dur := ui.FmtDuration(time.Since(start))
		ui.Status("info", "find", fmt.Sprintf("%q · %d files  (%s)", q, len(res), dur), 0, os.Stdout)
	}
	httpx.WriteJSON(w, map[string]any{"results": res, "indexing": !ready})
}
