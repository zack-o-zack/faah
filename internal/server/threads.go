package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"faah/internal/httpx"
	"faah/internal/threads"
)

// ---------------------------------------------------------------- HTTP

func (s *Server) handleThreadGet(w http.ResponseWriter, r *http.Request) {
	if !s.threadsOrFail(w) {
		return
	}
	t := s.threads.Get(r.URL.Query().Get("id"))
	if t == nil {
		httpx.Fail(w, http.StatusNotFound, threads.ErrGone.Error())
		return
	}
	httpx.WriteJSON(w, t)
}

func (s *Server) handleThreadCreate(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	var body struct {
		Path    string `json:"path"`
		L1      int    `json:"l1"`
		L2      int    `json:"l2"`
		Message string `json:"message"`
		Scope   string `json:"scope"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Fail(w, 400, "bad request")
		return
	}
	var abs, rel string
	if body.Path != "" {
		var ok bool
		if abs, rel, ok = s.resolvePath(body.Path); !ok {
			httpx.Fail(w, 400, "bad path")
			return
		}
	}
	t, err := s.threads.Create(abs, rel, body.L1, body.L2, body.Message, body.Scope)
	if err != nil {
		httpx.Fail(w, threadStatus(err), err.Error())
		return
	}
	httpx.WriteJSON(w, t)
}

func (s *Server) handleThreadSend(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	var body struct {
		ID      string `json:"id"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Fail(w, 400, "bad request")
		return
	}
	t, err := s.threads.Send(body.ID, body.Message)
	if err != nil {
		httpx.Fail(w, threadStatus(err), err.Error())
		return
	}
	httpx.WriteJSON(w, t)
}

func (s *Server) handleThreadCancel(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" && r.Body != nil {
		var body struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) == nil {
			id = body.ID
		}
	}
	httpx.WriteJSON(w, map[string]any{"cancelled": s.threads.Cancel(id)})
}

func (s *Server) handleThreadScope(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	var body struct {
		ID    string `json:"id"`
		Scope string `json:"scope"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Fail(w, 400, "bad request")
		return
	}
	if err := s.threads.SetScope(body.ID, body.Scope); err != nil {
		httpx.Fail(w, threadStatus(err), err.Error())
		return
	}
	httpx.WriteJSON(w, s.threads.Get(body.ID))
}

func (s *Server) handleThreadDelete(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" && r.Body != nil {
		var body struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) == nil {
			id = body.ID
		}
	}
	if id == "" {
		httpx.Fail(w, 400, "missing thread id")
		return
	}
	httpx.WriteJSON(w, map[string]any{"deleted": s.threads.Delete(id)})
}

func (s *Server) handleThreadRevert(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	var body struct {
		ID   string `json:"id"`
		Turn int    `json:"turn"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ID == "" || body.Turn < 1 {
		httpx.Fail(w, http.StatusBadRequest, "id and turn are required")
		return
	}
	t, paths, err := s.threads.RevertTurn(body.ID, body.Turn)
	if err != nil {
		httpx.Fail(w, threadStatus(err), err.Error())
		return
	}
	for _, p := range paths {
		s.ix.TouchPath(p)
	}
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}
	httpx.WriteJSON(w, map[string]any{"ok": true, "thread": t, "reverted": paths})
}

// handleThreadStream is the SSE feed: one thread's snapshot and live deltas
// with ?id=, or the thread list's changes without it.
func (s *Server) handleThreadStream(w http.ResponseWriter, r *http.Request) {
	if !s.threadsOrFail(w) {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}
	ch, first, unsub, ok := s.threads.Subscribe(r.URL.Query().Get("id"))
	if !ok {
		httpx.Fail(w, http.StatusNotFound, threads.ErrGone.Error())
		return
	}
	defer unsub()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	write := func(ev threads.Event) bool {
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, ev.Data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !write(first) {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-s.streamsDone:
			return
		case ev, open := <-ch:
			if !open || !write(ev) {
				return
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) threadsOrFail(w http.ResponseWriter) bool {
	if s.threads == nil {
		httpx.Fail(w, http.StatusNotFound, "threads are not available in this session")
		return false
	}
	return true
}

func threadStatus(err error) int {
	switch {
	case errors.Is(err, threads.ErrBusy), errors.Is(err, errHarnessNotReadOnly):
		return http.StatusConflict
	case errors.Is(err, threads.ErrGone):
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func (s *Server) handleThreads(w http.ResponseWriter, r *http.Request) {
	if !s.threadsOrFail(w) {
		return
	}
	httpx.WriteJSON(w, map[string]any{"threads": s.threads.List()})
}
