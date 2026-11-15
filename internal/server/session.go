package server

import (
	"encoding/json"
	"io"
	"net/http"

	"faah/internal/httpx"
	"faah/internal/session"
)

// ---------------------------------------------------------------- Workspace Session

// handleSession handles GET and POST requests for /api/session.
// GET returns the current workspace session state.
// POST updates tab list, active tab, and open directories, saving changes to disk.
func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		httpx.WriteJSON(w, s.session.Get())
	case http.MethodPost:
		if !httpx.LocalPost(w, r) {
			return
		}
		var payload struct {
			Tabs     *[]session.Tab `json:"tabs"`
			Active   *int           `json:"active"`
			OpenDirs *[]string      `json:"openDirs"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
			httpx.Fail(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		updated := s.session.Update(func(ws *session.Workspace) {
			if payload.Tabs != nil {
				ws.Tabs = *payload.Tabs
			}
			if payload.Active != nil {
				ws.Active = *payload.Active
			}
			if payload.OpenDirs != nil {
				ws.OpenDirs = *payload.OpenDirs
			}
		})
		httpx.WriteJSON(w, updated)
	default:
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
