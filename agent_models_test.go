package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestAgentModelsBrowsesWithoutSelecting(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "claude"), []byte("#!/bin/sh\necho 'Available: sonnet, opus, haiku, fable, best, or default.'\n"), 0755); err != nil {
		t.Fatal(err)
	}
	// Both agents must come from fixtures, even when no harness is installed.
	t.Setenv("PATH", dir)
	fakeCLI(t, "codex")
	s := agentServer(t, t.TempDir(), "codex")
	beforeName, beforeModel := s.agent.Name(), s.agent.Model()
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/agent/models?name=claude", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("models: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Models []string `json:"models"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Models) == 0 {
		t.Fatal("expected the browsed agent's real model list")
	}
	if s.agent.Name() != beforeName || s.agent.Model() != beforeModel {
		t.Fatal("browsing models changed the selected agent or model")
	}
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/agent/models?name=unknown-agent", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown agent: %d", w.Code)
	}
}
