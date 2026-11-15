package server

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"faah/internal/metrics"
)

func TestUnifiedEventStream(t *testing.T) {
	s, _ := newTestServer(t)
	ts := httptest.NewServer(s)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/stream", nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext failed: %v", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("expected text/event-stream, got %q", ct)
	}

	scanner := bufio.NewScanner(resp.Body)
	var foundMetrics bool
	var metricsData string

	for scanner.Scan() {
		line := scanner.Text()
		if line == "event: metrics" {
			foundMetrics = true
		} else if foundMetrics && strings.HasPrefix(line, "data: ") {
			metricsData = strings.TrimPrefix(line, "data: ")
			break
		}
	}

	if !foundMetrics || metricsData == "" {
		t.Fatalf("did not receive initial metrics event on /api/stream")
	}

	var m metrics.ProcessMetrics
	if err := json.Unmarshal([]byte(metricsData), &m); err != nil {
		t.Fatalf("failed to unmarshal metrics JSON: %v, raw: %s", err, metricsData)
	}
	if m.Goroutine <= 0 {
		t.Errorf("expected goroutines > 0, got %d", m.Goroutine)
	}
}
