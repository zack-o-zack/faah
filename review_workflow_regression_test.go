package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReviewWorkflowRunRejectsUnknownID(t *testing.T) {
	s, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/review-workflow/run", strings.NewReader(`{"workflowId":"missing"}`))
	req.Host = "127.0.0.1:7777"
	req.Header.Set("Origin", "http://127.0.0.1:7777")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "unknown review workflow") {
		t.Fatalf("unknown workflow response = %d %s", rec.Code, rec.Body.String())
	}
	if s.reviewFlow.CurrentRun() != nil {
		t.Fatal("unknown workflow started a run")
	}
}
