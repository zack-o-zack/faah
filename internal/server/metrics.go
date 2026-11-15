package server

import (
	"net/http"

	"faah/internal/httpx"
	lsppkg "faah/internal/lsp"
	"faah/internal/metrics"
)

func getProcessMetrics(lsp *lsppkg.Manager) metrics.ProcessMetrics {
	if lsp == nil {
		return metrics.Collect(0, false)
	}
	return metrics.Collect(lsp.MemoryBytes(), lsp.Enabled())
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, getProcessMetrics(s.lsp))
}
