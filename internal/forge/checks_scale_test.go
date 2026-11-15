package forge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func scaleForge(t *testing.T, name string, total int) (Provider, PRTarget, *atomic.Int32, *atomic.Int32) {
	t.Helper()
	var fixture overviewFixture
	for _, f := range overviewFixtures() {
		if f.name == name {
			fixture = f
		}
	}
	routes := map[string]func(http.ResponseWriter, *http.Request){}
	var active, peak, calls atomic.Int32
	for path, body := range fixture.routes {
		routes["GET "+path] = reply(200, body)
		if !strings.Contains(path, "/commits/") && !strings.HasSuffix(path, "/statuses") {
			continue
		}
		if name == "github" && strings.HasSuffix(path, "/status") {
			routes["GET "+path] = reply(200, `{"total_count":0,"statuses":[]}`)
			continue
		}
		routes["GET "+path] = func(w http.ResponseWriter, r *http.Request) {
			now := active.Add(1)
			defer active.Add(-1)
			for {
				old := peak.Load()
				if now <= old || peak.CompareAndSwap(old, now) {
					break
				}
			}
			time.Sleep(time.Millisecond)
			page, _ := strconv.Atoi(r.URL.Query().Get("page"))
			if page == 0 {
				page = 1
			}
			size := 100
			if name == "gitea" {
				size = 50
			}
			start := (page - 1) * size
			end := min(start+size, total)
			rows := []map[string]any{}
			for i := start; i < end; i++ {
				n := fmt.Sprintf("check-%04d", i)
				switch name {
				case "github":
					rows = append(rows, map[string]any{"id": i + 1, "name": n, "status": "completed", "conclusion": "success", "app": map[string]any{"id": 1, "name": "CI", "slug": "ci"}})
				case "gitlab":
					rows = append(rows, map[string]any{"id": i + 1, "name": n, "status": "success"})
				case "gitea":
					rows = append(rows, map[string]any{"id": i + 1, "context": n, "status": "success"})
				default:
					rows = append(rows, map[string]any{"key": n, "name": n, "state": "SUCCESSFUL"})
				}
			}
			if end < total {
				w.Header().Set("Link", fmt.Sprintf(`<%s?page=%d>; rel="next"`, r.URL.Path, page+1))
			}
			w.Header().Set("X-Total", strconv.Itoa(total))
			w.Header().Set("X-Total-Count", strconv.Itoa(total))
			switch name {
			case "github":
				json.NewEncoder(w).Encode(map[string]any{"total_count": total, "check_runs": rows})
			case "bitbucket":
				next := ""
				if end < total {
					next = fmt.Sprintf("%s?page=%d&pagelen=100", r.URL.Path, page+1)
				}
				json.NewEncoder(w).Encode(map[string]any{"size": total, "values": rows, "next": next})
			default:
				json.NewEncoder(w).Encode(rows)
			}
		}
	}
	for path, handler := range routes {
		routes[path] = func(w http.ResponseWriter, r *http.Request) { calls.Add(1); handler(w, r) }
	}
	p, target := fakeOverviewRoutes(t, name, routes)
	return p, target, &peak, &calls
}
func TestOverviewChecksScale(t *testing.T) {
	for _, name := range []string{"github", "gitlab", "gitea", "bitbucket"} {
		for _, count := range []int{230, 1200} {
			t.Run(fmt.Sprintf("%s/%d", name, count), func(t *testing.T) {
				p, target, peak, _ := scaleForge(t, name, count)
				got, err := p.FetchOverview(context.Background(), target, "tok", "head")
				if err != nil {
					t.Fatal(err)
				}
				if len(got.Checks) != min(count, 1000) || got.TotalChecks != count || got.Truncated != (count > 1000) {
					t.Fatalf("count=%d total=%d truncated=%t", len(got.Checks), got.TotalChecks, got.Truncated)
				}
				if peak.Load() < 2 || peak.Load() > 4 {
					t.Fatalf("page concurrency=%d, want 2..4", peak.Load())
				}
				for _, c := range got.Checks {
					if c.ID == "" {
						t.Fatal("check has no stable id")
					}
				}
			})
		}
	}
}
func TestGitHubOverviewLatestChecksPerAppAndContext(t *testing.T) {
	routes := map[string]func(http.ResponseWriter, *http.Request){
		"GET /repos/o/r/pulls/3": reply(200, `{}`), "GET /repos/o/r/pulls/3/reviews": reply(200, `[]`),
		"GET /repos/o/r/commits/head/check-runs": reply(200, `{"total_count":3,"check_runs":[{"id":1,"name":"test","status":"completed","conclusion":"failure","app":{"id":1,"name":"A"}},{"id":2,"name":"test","status":"completed","conclusion":"success","app":{"id":1,"name":"A"}},{"id":3,"name":"test","status":"completed","conclusion":"failure","app":{"id":2,"name":"B"}}]}`),
		"GET /repos/o/r/commits/head/status":     reply(200, `{"total_count":2,"statuses":[{"id":1,"context":"deploy","state":"pending"},{"id":2,"context":"deploy","state":"success"}]}`),
	}
	p, target := fakeOverviewRoutes(t, "github", routes)
	got, err := p.FetchOverview(context.Background(), target, "tok", "head")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Checks) != 3 {
		t.Fatalf("reruns were not deduplicated: %+v", got.Checks)
	}
	ids := map[string]bool{}
	for _, check := range got.Checks {
		if ids[check.ID] || check.ID == "" {
			t.Fatal("unstable or duplicate id")
		}
		ids[check.ID] = true
		if check.App == "A" && check.State != CheckPassed {
			t.Fatal("old run won")
		}
		if check.Name == "deploy" && check.State != CheckPassed {
			t.Fatal("old status won")
		}
	}
}

func TestOverviewLoadCost(t *testing.T) {
	for _, name := range []string{"github", "gitlab", "gitea", "bitbucket"} {
		for _, count := range []int{10, 300, 1000} {
			t.Run(fmt.Sprintf("%s/%d", name, count), func(t *testing.T) {
				p, target, _, calls := scaleForge(t, name, count)
				start := time.Now()
				got, err := p.FetchOverview(context.Background(), target, "tok", "head")
				elapsed := time.Since(start)
				if err != nil || len(got.Checks) != count {
					t.Fatalf("checks=%d err=%v", len(got.Checks), err)
				}
				t.Logf("checks=%d HTTP_calls=%d wall=%s", count, calls.Load(), elapsed)
			})
		}
	}
}
