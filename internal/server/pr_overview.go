package server

import (
	"context"
	"net/http"
	"sync"
	"time"

	"faah/internal/forge"
	"faah/internal/httpx"
	prpkg "faah/internal/pr"
)

// One bounded cache entry per server. The lock also coalesces simultaneous loads.
type prOverviewCache struct {
	mu      sync.Mutex
	pr      *prpkg.Session
	head    string
	expires time.Time
	data    forge.PROverview
}

func (s *Server) handlePROverview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.prOrFail(w) {
		return
	}
	p := s.pr
	head := p.Snapshot().Meta.HeadSHA
	cache := &s.overviewCache
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if r.URL.Query().Get("refresh") != "1" && cache.pr == p && cache.head == head && time.Now().Before(cache.expires) {
		httpx.WriteJSON(w, cache.data)
		return
	}
	provider, target, token := p.Credentials()
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	overview, err := provider.FetchOverview(ctx, target, token, head)
	if err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	overview.Description.BodyHTML = renderPRBody(overview.Description.Body)
	ttl := 2 * time.Minute
	for _, check := range overview.Checks {
		if check.State == forge.CheckRunning {
			ttl = 15 * time.Second
			break
		}
	}
	cache.pr = p
	cache.head = head
	cache.data = overview
	cache.expires = time.Now().Add(ttl)
	httpx.WriteJSON(w, overview)
}
