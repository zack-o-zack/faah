package forge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"faah/internal/forge/forgetest"
)

type overviewFixture struct {
	name   string
	routes map[string]string
	calls  int
}

func overviewFixtures() []overviewFixture {
	return []overviewFixture{
		{"github", map[string]string{
			"/repos/o/r/pulls/3":                 `{"body":"## Overview","user":{"login":"owner","avatar_url":"https://avatar.test/owner"},"created_at":"2026-01-01T10:00:00Z","requested_reviewers":[{"login":"pending"},{"login":"ana"}]}`,
			"/repos/o/r/commits/head/check-runs": `{"check_runs":[{"name":"test","status":"completed","conclusion":"success","html_url":"https://ci.test/test"},{"name":"lint","status":"completed","conclusion":"failure"},{"name":"build","status":"in_progress"},{"name":"optional","status":"completed","conclusion":"skipped"},{"name":"info","status":"completed","conclusion":"neutral"}]}`,
			"/repos/o/r/commits/head/status":     `{"statuses":[{"context":"deploy","state":"pending","target_url":"https://ci.test/deploy"}]}`,
			"/repos/o/r/pulls/3/reviews":         `[{"id":2,"user":{"login":"ana","avatar_url":"https://avatar.test/ana"},"state":"APPROVED","submitted_at":"2026-01-02T00:00:00Z"},{"id":1,"user":{"login":"ana"},"state":"CHANGES_REQUESTED","submitted_at":"2026-01-01T00:00:00Z"},{"id":3,"user":{"login":"bo"},"state":"CHANGES_REQUESTED"},{"id":4,"user":{"login":"cy"},"state":"COMMENTED"}]`,
		}, 4},
		{"gitlab", map[string]string{
			"/api/v4/projects/group%2Fsub%2Fapp/merge_requests/4":                 `{"description":"## Overview","author":{"username":"owner","avatar_url":"https://avatar.test/owner"},"created_at":"2026-01-01T10:00:00Z","reviewers":[{"username":"pending"},{"username":"ana"}]}`,
			"/api/v4/projects/group%2Fsub%2Fapp/repository/commits/head/statuses": `[{"name":"test","status":"success","target_url":"https://ci.test/test"},{"name":"lint","status":"failed"},{"name":"build","status":"running"},{"name":"optional","status":"skipped"},{"name":"info","status":"unknown"},{"name":"deploy","status":"pending","target_url":"https://ci.test/deploy"}]`,
			"/api/v4/projects/group%2Fsub%2Fapp/merge_requests/4/reviewers":       `[{"user":{"username":"ana"},"state":"reviewed","created_at":"2026-01-01T00:00:00Z"},{"user":{"username":"bo"},"state":"requested_changes"},{"user":{"username":"cy"},"state":"reviewed"},{"user":{"username":"pending"},"state":"unreviewed"}]`,
			"/api/v4/projects/group%2Fsub%2Fapp/merge_requests/4/approvals":       `{"approved_by":[{"user":{"username":"ana","avatar_url":"https://avatar.test/ana"}}]}`,
		}, 4},
		{"gitea", map[string]string{
			"/api/v1/repos/o/r/pulls/3":               `{"body":"## Overview","user":{"login":"owner","avatar_url":"https://avatar.test/owner"},"created_at":"2026-01-01T10:00:00Z","requested_reviewers":[{"login":"pending"},{"login":"ana"}]}`,
			"/api/v1/repos/o/r/commits/head/statuses": `[{"context":"test","status":"success","target_url":"https://ci.test/test"},{"context":"lint","status":"failure"},{"context":"build","status":"pending"},{"context":"optional","status":"warning"},{"context":"info","status":"unknown"},{"context":"deploy","status":"pending","target_url":"https://ci.test/deploy"}]`,
			"/api/v1/repos/o/r/pulls/3/reviews":       `[{"id":2,"user":{"login":"ana","avatar_url":"https://avatar.test/ana"},"state":"APPROVED","submitted_at":"2026-01-02T00:00:00Z"},{"id":1,"user":{"login":"ana"},"state":"REQUEST_CHANGES","submitted_at":"2026-01-01T00:00:00Z"},{"id":3,"user":{"login":"bo"},"state":"REQUEST_CHANGES"},{"id":4,"user":{"login":"cy"},"state":"COMMENT"}]`,
		}, 3},
		{"bitbucket", map[string]string{
			"/2.0/repositories/ws/r/pullrequests/9":       `{"description":"## Overview","author":{"uuid":"owner","nickname":"owner","links":{"avatar":{"href":"https://avatar.test/owner"}}},"created_on":"2026-01-01T10:00:00Z","reviewers":[{"uuid":"pending","nickname":"pending"},{"uuid":"ana","nickname":"ana"}],"participants":[{"user":{"uuid":"ana","nickname":"ana","links":{"avatar":{"href":"https://avatar.test/ana"}}},"approved":true,"state":"approved","participated_on":"2026-01-02T00:00:00Z"},{"user":{"uuid":"ana","nickname":"ana"},"state":"changes_requested","participated_on":"2026-01-01T00:00:00Z"},{"user":{"uuid":"bo","nickname":"bo"},"state":"changes_requested"},{"user":{"uuid":"cy","nickname":"cy"},"participated_on":"2026-01-01T00:00:00Z"}]}`,
			"/2.0/repositories/ws/r/commit/head/statuses": `{"values":[{"name":"test","state":"SUCCESSFUL","url":"https://ci.test/test"},{"name":"lint","state":"FAILED"},{"name":"build","state":"INPROGRESS"},{"name":"optional","state":"STOPPED"},{"name":"info","state":"unknown"},{"name":"deploy","state":"INPROGRESS","url":"https://ci.test/deploy"}]}`,
		}, 2},
	}
}

func fakeOverview(t *testing.T, f overviewFixture, mode string) (Provider, PRTarget, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	started := make(chan struct{})
	var reached atomic.Int32
	routes := map[string]func(http.ResponseWriter, *http.Request){}
	for path, body := range f.routes {
		routes["GET "+path] = func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			if mode == "full" {
				if reached.Add(1) == int32(f.calls) {
					close(started)
				}
				select {
				case <-started:
				case <-time.After(3 * time.Second):
					t.Error("overview calls were not concurrent")
				}
			}
			if mode == "error" {
				reply(503, `{"message":"forge unavailable"}`)(w, r)
				return
			}
			if mode == "empty" {
				if strings.Contains(body, `"values"`) {
					body = `{"values":[]}`
				} else if strings.Contains(body, `"check_runs"`) {
					body = `{"check_runs":[]}`
				} else if strings.Contains(body, `"statuses"`) {
					body = `{"statuses":[]}`
				} else if strings.HasPrefix(body, "[") {
					body = `[]`
				} else {
					body = `{}`
				}
			}
			reply(200, body)(w, r)
		}
	}
	provider, target := fakeOverviewRoutes(t, f.name, routes)
	return provider, target, &calls
}
func fakeOverviewRoutes(t *testing.T, name string, routes map[string]func(http.ResponseWriter, *http.Request)) (Provider, PRTarget) {
	switch name {
	case "github":
		rc := &recorder{routes: routes}
		srv := rc.serve(t, "Bearer tok")
		u, _ := url.Parse(srv.URL)
		old := githubHTTPClient.Transport
		githubHTTPClient.Transport = forgetest.RoundTripperFunc(func(r *http.Request) (*http.Response, error) {
			clone := r.Clone(r.Context())
			v := *r.URL
			v.Scheme = u.Scheme
			v.Host = u.Host
			clone.URL = &v
			return http.DefaultTransport.RoundTrip(clone)
		})
		t.Cleanup(func() { githubHTTPClient.Transport = old })
		return &GitHub{}, PRTarget{Owner: "o", Repo: "r", Number: 3}
	case "gitlab":
		return &gitlab{}, withFakeGitLab(t, &fakeGitLab{routes: routes})
	case "gitea":
		_, target := fakeGitea(t, routes)
		return &gitea{}, target
	default:
		_, target := fakeBitbucket(t, routes)
		return &bitbucket{}, target
	}
}

func TestOverviewProviders(t *testing.T) {
	for _, f := range overviewFixtures() {
		for _, mode := range []string{"full", "empty", "error"} {
			t.Run(f.name+"/"+mode, func(t *testing.T) {
				provider, target, calls := fakeOverview(t, f, mode)
				got, err := provider.FetchOverview(context.Background(), target, "tok", "head")
				if mode == "error" {
					if err == nil || !strings.Contains(err.Error(), "forge unavailable") {
						t.Fatalf("expected forge error, got %v", err)
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				if mode == "empty" {
					if got.Description.Body != "" || got.Checks == nil || len(got.Checks) != 0 || got.Reviewers == nil || len(got.Reviewers) != 0 {
						t.Fatalf("empty overview: %+v", got)
					}
					return
				}
				if got.Description.Author != "owner" || got.Description.AvatarURL != "https://avatar.test/owner" || got.Description.CreatedAt != "2026-01-01T10:00:00Z" {
					t.Fatalf("author/date metadata: %+v", got.Description)
				}
				if got.Description.Body != "## Overview" {
					t.Fatalf("body: %+v", got.Description)
				}
				states := map[string]string{}
				for _, c := range got.Checks {
					states[c.Name] = c.State
					if c.Name == "test" && c.URL != "https://ci.test/test" {
						t.Fatal(c)
					}
				}
				want := map[string]string{"test": CheckPassed, "lint": CheckFailed, "build": CheckRunning, "optional": CheckSkipped, "info": CheckNeutral, "deploy": CheckRunning}
				if f.name == "gitea" {
					want["optional"] = CheckNeutral
				}
				if !reflect.DeepEqual(states, want) {
					t.Fatalf("checks: %v, want %v", states, want)
				}
				reviews := map[string]string{}
				for _, r := range got.Reviewers {
					reviews[r.Name] = r.State
					if r.Name == "ana" && r.AvatarURL != "https://avatar.test/ana" {
						t.Fatal(r)
					}
				}
				if len(got.Reviewers) != 4 || !reflect.DeepEqual(reviews, map[string]string{"ana": ReviewApproved, "bo": ReviewChangesRequested, "cy": ReviewCommented, "pending": ReviewPending}) {
					t.Fatalf("latest reviews and requested reviewers: %+v", got.Reviewers)
				}
				if int(calls.Load()) != f.calls {
					t.Fatalf("HTTP calls = %d, want %d", calls.Load(), f.calls)
				}
			})
		}
	}
}

func TestGiteaOverviewCheckCap(t *testing.T) {
	_, target := fakeGitea(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /api/v1/repos/o/r/pulls/3":         reply(200, `{}`),
		"GET /api/v1/repos/o/r/pulls/3/reviews": reply(200, `[]`),
		"GET /api/v1/repos/o/r/commits/head/statuses": func(w http.ResponseWriter, r *http.Request) {
			page, _ := strconv.Atoi(r.URL.Query().Get("page"))
			count := 50
			if page == 101 {
				count = 1
			}
			rows := []struct {
				Name   string `json:"context"`
				Status string `json:"status"`
			}{}
			for i := 0; i < count; i++ {
				rows = append(rows, struct {
					Name   string `json:"context"`
					Status string `json:"status"`
				}{fmt.Sprintf("page%d-%d", page, i), "success"})
			}
			json.NewEncoder(w).Encode(rows)
		},
	})
	got, err := (&gitea{}).FetchOverview(context.Background(), target, "tok", "head")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Checks) != 1000 || !got.Truncated {
		t.Fatalf("explicit cap: got %d checks, want 1000 with truncated", len(got.Checks))
	}
}
