package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"faah/internal/git/gittest"
	"faah/internal/review"
	"faah/internal/workspace"
)

func TestReviewWorkflowConfigEndpoints(t *testing.T) {
	tmp := t.TempDir()
	ix := workspace.NewIndex(tmp)
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	// GET config
	req := httptest.NewRequest(http.MethodGet, "/api/review-workflow/config", nil)
	rec := httptest.NewRecorder()
	s.handleReviewWorkflowConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var cfg review.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("failed to parse json response: %v", err)
	}
	if len(cfg.Workflows) == 0 {
		t.Fatal("expected workflows in config response")
	}

	// POST new config
	customCfg := review.Config{
		Workflows: []review.WorkflowDef{
			{
				ID:   "custom",
				Name: "Custom Test Flow",
				Stages: []review.StageDef{
					{
						ID:       "s1",
						Title:    "Custom Stage 1",
						Question: "Question 1?",
						Prompt:   "Prompt 1",
					},
				},
			},
		},
		ActiveID: "custom",
	}
	data, _ := json.Marshal(customCfg)
	postReq := httptest.NewRequest(http.MethodPost, "/api/review-workflow/config", bytes.NewReader(data))
	postReq.Host = "127.0.0.1:7777"
	postReq.Header.Set("Origin", "http://127.0.0.1:7777")
	postRec := httptest.NewRecorder()
	s.handleReviewWorkflowConfig(postRec, postReq)
	if postRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on config update, got %d: %s", postRec.Code, postRec.Body.String())
	}

	// Verify on-disk write
	p := filepath.Join(tmp, ".faah", "workflows.json")
	if _, err := os.Stat(p); os.IsNotExist(err) {
		t.Fatalf("expected config file to be written at %s", p)
	}
}

func TestReviewWorkflowStatusAndStop(t *testing.T) {
	tmp := t.TempDir()
	ix := workspace.NewIndex(tmp)
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	// Status before any run
	req := httptest.NewRequest(http.MethodGet, "/api/review-workflow/status", nil)
	rec := httptest.NewRecorder()
	s.handleReviewWorkflowStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	// Stop when idle returns 200
	stopReq := httptest.NewRequest(http.MethodPost, "/api/review-workflow/stop", nil)
	stopReq.Host = "127.0.0.1:7777"
	stopReq.Header.Set("Origin", "http://127.0.0.1:7777")
	stopRec := httptest.NewRecorder()
	s.handleReviewWorkflowStop(stopRec, stopReq)
	if stopRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on stop, got %d", stopRec.Code)
	}
}

func TestReviewWorkflowRunEndpoint(t *testing.T) {
	tmp := t.TempDir()
	ix := workspace.NewIndex(tmp)
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	body, _ := json.Marshal(map[string]any{
		"workflowId": "standard",
		"stageIndex": 0,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/review-workflow/run", bytes.NewReader(body))
	req.Host = "127.0.0.1:7777"
	req.Header.Set("Origin", "http://127.0.0.1:7777")
	rec := httptest.NewRecorder()
	s.handleReviewWorkflowRun(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on run, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestReviewWorkflowSSEStreamAndNilManager(t *testing.T) {
	tmp := t.TempDir()
	ix := workspace.NewIndex(tmp)
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/api/review-workflow/stream", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	go s.handleReviewWorkflowStream(rec, req)

	time.Sleep(50 * time.Millisecond)
	cancel()

	body := rec.Body.String()
	if !strings.Contains(body, "event: snapshot") {
		t.Fatalf("expected stream to contain initial event: snapshot, got: %s", body)
	}

	// Test nil reviewFlow handler guard
	sNil := &Server{}
	recNil := httptest.NewRecorder()
	reqNil := httptest.NewRequest(http.MethodGet, "/api/review-workflow/config", nil)
	sNil.handleReviewWorkflowConfig(recNil, reqNil)
	if recNil.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for nil reviewFlow, got %d", recNil.Code)
	}
}

func TestReviewWorkflowHTTPHandlerValidation(t *testing.T) {
	tmp := t.TempDir()
	ix := workspace.NewIndex(tmp)
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	// Method not allowed on config handler
	reqMethod := httptest.NewRequest(http.MethodDelete, "/api/review-workflow/config", nil)
	recMethod := httptest.NewRecorder()
	s.handleReviewWorkflowConfig(recMethod, reqMethod)
	if recMethod.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 Method Not Allowed, got %d", recMethod.Code)
	}

	// Post invalid JSON to config
	badJSONReq := httptest.NewRequest(http.MethodPost, "/api/review-workflow/config", strings.NewReader("bad json"))
	badJSONReq.Host = "127.0.0.1:7777"
	badJSONReq.Header.Set("Origin", "http://127.0.0.1:7777")
	badJSONRec := httptest.NewRecorder()
	s.handleReviewWorkflowConfig(badJSONRec, badJSONReq)
	if badJSONRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d", badJSONRec.Code)
	}
}

func TestReviewWalkthroughEndpoint(t *testing.T) {
	tmp := t.TempDir()
	ix := workspace.NewIndex(tmp)
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})

	req := httptest.NewRequest(http.MethodGet, "/api/review/walkthrough", nil)
	rec := httptest.NewRecorder()
	s.handleReviewWalkthrough(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp review.WalkthroughResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Files == nil {
		t.Fatalf("expected non-nil files array")
	}
}

func TestReviewWalkthroughWhitespaceParameter(t *testing.T) {
	root := gittest.Repo(t)
	gittest.Run(t, root, "reset", "--hard", "HEAD")
	gittest.Run(t, root, "clean", "-fd")
	if err := os.WriteFile(filepath.Join(root, "keep.go"), []byte("    keep\n"), 0644); err != nil {
		t.Fatal(err)
	}
	ix := workspace.NewIndex(root)
	ix.Build()
	s := New(Options{Workspace: ix, Assets: assets, DevRoot: devRoot, Version: version})
	for _, value := range []string{"", "1", "true", "0", "2"} {
		rec := httptest.NewRecorder()
		s.handleReviewWalkthrough(rec, httptest.NewRequest(http.MethodGet, "/api/review/walkthrough?ignoreWhitespace="+value, nil))
		var response review.WalkthroughResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		want := 0
		if value == "1" {
			want = 1
		}
		if response.HiddenWhitespaceFiles != want {
			t.Fatalf("%q: %+v", value, response)
		}
	}
}
