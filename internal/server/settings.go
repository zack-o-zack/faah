package server

import (
	"encoding/json"
	"io"
	"net/http"

	"faah/internal/httpx"
	"faah/internal/settings"
)

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		httpx.WriteJSON(w, map[string]any{
			"settings": settings.ReadMergedMap(),
			"defaults": settings.DefaultMap(),
			"schema":   s.settingsSchema(),
			"raw":      settings.ReadRawJSON(),
			"path":     settings.Path(),
		})
	case http.MethodPost:
		if !httpx.LocalPost(w, r) {
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB limit
		if err != nil {
			httpx.Fail(w, 400, "failed to read body")
			return
		}
		var payload map[string]any
		if len(body) > 0 {
			if err := json.Unmarshal(body, &payload); err != nil {
				httpx.Fail(w, 400, "invalid JSON: "+err.Error())
				return
			}
		} else {
			payload = make(map[string]any)
			for k, vs := range r.URL.Query() {
				if len(vs) > 0 {
					payload[k] = vs[0]
				}
			}
		}

		if rawStr, ok := payload["raw"].(string); ok {
			var raw map[string]json.RawMessage
			if json.Unmarshal([]byte(rawStr), &raw) == nil {
				if value, exists := raw["workbench.colorTheme"]; exists {
					var id string
					if json.Unmarshal(value, &id) != nil || !s.themes.Has(id) {
						httpx.Fail(w, 400, "unknown color theme")
						return
					}
				}
			}
			if err := settings.SaveRawJSON([]byte(rawStr)); err != nil {
				httpx.Fail(w, 400, "invalid JSON in settings: "+err.Error())
				return
			}
		} else {
			if value, exists := payload["workbench.colorTheme"]; exists {
				id, ok := value.(string)
				if !ok || !s.themes.Has(id) {
					httpx.Fail(w, 400, "unknown color theme")
					return
				}
			}
			if err := settings.UpdateMap(payload); err != nil {
				httpx.Fail(w, 500, err.Error())
				return
			}
		}

		if s.agent != nil {
			currentSettings := settings.Read()
			if currentSettings.Agent != "" && currentSettings.Agent != s.agent.name() {
				_ = s.agent.selectAgent(currentSettings.Agent, s.agent.model())
			}
		}

		httpx.WriteJSON(w, map[string]any{
			"settings": settings.ReadMergedMap(),
			"raw":      settings.ReadRawJSON(),
			"path":     settings.Path(),
			"ok":       true,
		})
	default:
		httpx.Fail(w, 405, "method not allowed")
	}
}

// Each response derives theme options from the CSS currently served to this workspace.
func (s *Server) settingsSchema() []settings.SchemaItem {
	schema := append([]settings.SchemaItem(nil), settings.Schema...)
	for i := range schema {
		if schema[i].Key == "workbench.colorTheme" {
			schema[i].Options = append([]string{""}, s.themes.IDs()...)
		}
	}
	return schema
}
