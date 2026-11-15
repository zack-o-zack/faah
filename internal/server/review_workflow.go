package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"faah/internal/httpx"
	"faah/internal/review"
)

// ---------------------------------------------------------------- HTTP Handlers

func (s *Server) handleReviewWorkflowConfig(w http.ResponseWriter, r *http.Request) {
	if s.reviewFlow == nil {
		httpx.Fail(w, http.StatusServiceUnavailable, "review workflow unavailable")
		return
	}
	if r.Method == http.MethodGet {
		httpx.WriteJSON(w, s.reviewFlow.Config())
		return
	}
	if r.Method == http.MethodPost {
		if !httpx.LocalPost(w, r) {
			return
		}
		var cfg review.Config
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			httpx.Fail(w, http.StatusBadRequest, "invalid json: "+err.Error())
			return
		}
		if err := s.reviewFlow.SaveConfig(cfg); err != nil {
			httpx.Fail(w, http.StatusBadRequest, err.Error())
			return
		}
		httpx.WriteJSON(w, map[string]any{"ok": true, "config": s.reviewFlow.Config()})
		return
	}
	httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
}

func (s *Server) handleReviewWorkflowRun(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || s.reviewFlow == nil {
		return
	}
	var body struct {
		WorkflowID string `json:"workflowId"`
		StageIndex int    `json:"stageIndex"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	run, err := s.reviewFlow.Run(body.WorkflowID, body.StageIndex)
	if err != nil {
		httpx.Fail(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, map[string]any{"ok": true, "run": run})
}

func (s *Server) handleReviewWorkflowStop(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || s.reviewFlow == nil {
		return
	}
	run, err := s.reviewFlow.Stop()
	if err != nil {
		httpx.Fail(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, map[string]any{"ok": true, "run": run})
}

func (s *Server) handleReviewWorkflowStatus(w http.ResponseWriter, r *http.Request) {
	if s.reviewFlow == nil {
		httpx.Fail(w, http.StatusServiceUnavailable, "review workflow unavailable")
		return
	}
	httpx.WriteJSON(w, map[string]any{
		"run":    s.reviewFlow.CurrentRun(),
		"config": s.reviewFlow.Config(),
	})
}

func (s *Server) handleReviewWorkflowStream(w http.ResponseWriter, r *http.Request) {
	if s.reviewFlow == nil {
		httpx.Fail(w, http.StatusServiceUnavailable, "review workflow unavailable")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	ch, unsub := s.reviewFlow.Subscribe()
	defer unsub()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	// Send initial state snapshot
	currentRun := s.reviewFlow.CurrentRun()
	if runData, err := json.Marshal(currentRun); err == nil {
		fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", runData)
		flusher.Flush()
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
			if !open {
				return
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, ev.Data); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// handleReviewWalkthrough delivers grouped file diffs for the Review Walkthrough.
func (s *Server) handleReviewWalkthrough(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	isPR := s.pr != nil && s.prHeadSHA != ""
	var statuses map[string]string
	if isPR {
		statuses = s.ix.PRFiles()
	} else {
		statuses = s.ix.GitStatusMap()
	}
	httpx.WriteJSON(w, review.BuildWalkthrough(s.ix.Root(), s.diffBase, s.prHeadSHA, isPR, statuses, r.URL.Query().Get("ignoreWhitespace") == "1"))
}
