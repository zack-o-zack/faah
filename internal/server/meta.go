package server

import (
	"net/http"
	"path/filepath"

	"faah/internal/git"
	"faah/internal/httpx"
)

func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	n, at, ms := s.ix.Stats()
	inGit := git.Available(s.ix.Root())
	gitCount, gitFiles := s.ix.MetaGitChanges(inGit)
	meta := map[string]any{
		"root":           s.ix.Root(),
		"name":           filepath.Base(s.ix.Root()),
		"files":          n,
		"indexMs":        ms,
		"builtAt":        at,
		"ready":          s.ix.Ready(),
		"git":            inGit,
		"gitChanges":     gitCount,
		"gitFiles":       gitFiles,
		"forge":          s.forgeMeta(),
		"lspServers":     s.lsp.Available(),
		"metrics":        getProcessMetrics(s.lsp),
		"version":        s.version,
		"basePath":       s.baseURLPath(),
		"workbench":      s.workbenchURL,
		"agentEnabled":   s.agent != nil,
		"threadsEnabled": s.threads != nil,
		"agent":          s.agent.name(),
		"agentModel":     s.agent.model(),
		"agentPinned":    s.agent.isPinned(),
		"agents":         []agentHarness{},
	}
	if s.pr != nil {
		meta["pr"] = s.pr.MetaMap(s.ix.PRFiles())
	}
	httpx.WriteJSON(w, meta)
}
