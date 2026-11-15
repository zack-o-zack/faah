package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"faah/internal/forge"
	prpkg "faah/internal/pr"
)

type overviewProvider struct {
	forge.Provider
	head  string
	fail  bool
	calls int
}

func (p *overviewProvider) FetchOverview(ctx context.Context, target forge.PRTarget, token, head string) (forge.PROverview, error) {
	p.calls++
	wantHead := p.head
	if wantHead == "" {
		wantHead = "pr-head"
	}
	if token != "token" || head != wantHead || target.Number != 7 {
		return forge.PROverview{}, errors.New("wrong overview request")
	}
	if p.fail {
		return forge.PROverview{}, errors.New("forge unavailable")
	}
	return forge.PROverview{Description: forge.PRDescription{Body: "## Description\n\n**Ready** <script>bad()</script>"}, Checks: []forge.PRCheck{{Name: "test", State: forge.CheckPassed}}, Reviewers: []forge.PRReviewer{{ID: "ana", Name: "Ana", State: forge.ReviewApproved}}}, nil
}
func TestPROverviewHandler(t *testing.T) {
	for _, mode := range []string{"success", "error", "no-pr", "method"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("XDG_CONFIG_HOME", t.TempDir())
			s, _ := newTestServer(t)
			provider := &overviewProvider{Provider: forge.ForRemote("https://github.com/o/r"), fail: mode == "error"}
			if mode != "no-pr" {
				s.pr = prpkg.New(provider, forge.PRTarget{Number: 7}, forge.PRMeta{HeadSHA: "pr-head"}, "", "base")
				s.pr.ReplaceCredentials("token", "session", false)
			}
			method := http.MethodGet
			if mode == "method" {
				method = http.MethodPost
			}
			rec := httptest.NewRecorder()
			s.mux.ServeHTTP(rec, httptest.NewRequest(method, "/api/pr/overview", nil))
			switch mode {
			case "success":
				if rec.Code != 200 {
					t.Fatalf("overview: %d %s", rec.Code, rec.Body.String())
				}
				var got forge.PROverview
				if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(got.Description.BodyHTML, "<h2") || !strings.Contains(got.Description.BodyHTML, "<strong>Ready</strong>") || len(got.Checks) != 1 || len(got.Reviewers) != 1 || provider.calls != 1 {
					t.Fatalf("overview: %+v calls=%d", got, provider.calls)
				}
			case "error":
				if rec.Code != 502 || !strings.Contains(rec.Body.String(), "forge unavailable") {
					t.Fatalf("error: %d %s", rec.Code, rec.Body.String())
				}
			case "no-pr":
				if rec.Code != 404 || provider.calls != 0 {
					t.Fatalf("no PR: %d", rec.Code)
				}
			case "method":
				if rec.Code != 405 || provider.calls != 0 {
					t.Fatalf("method: %d", rec.Code)
				}
			}
		})
	}
}

func TestPROverviewCache(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	s, _ := newTestServer(t)
	provider := &overviewProvider{Provider: forge.ForRemote("https://github.com/o/r")}
	s.pr = prpkg.New(provider, forge.PRTarget{Number: 7}, forge.PRMeta{HeadSHA: "pr-head"}, "", "base")
	s.pr.ReplaceCredentials("token", "session", false)
	get := func(query string) {
		t.Helper()
		rec := httptest.NewRecorder()
		s.mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/pr/overview"+query, nil))
		if rec.Code != 200 {
			t.Fatalf("overview: %d %s", rec.Code, rec.Body.String())
		}
	}
	get("")
	get("")
	if provider.calls != 1 {
		t.Fatalf("cache miss within window: %d calls", provider.calls)
	}
	get("?refresh=1")
	if provider.calls != 2 {
		t.Fatal("manual refresh did not bypass cache")
	}
	s.pr = prpkg.New(provider, forge.PRTarget{Number: 7}, forge.PRMeta{HeadSHA: "next-head"}, "", "base")
	s.pr.ReplaceCredentials("token", "session", false)
	provider.head = "next-head"
	get("")
	if provider.calls != 3 {
		t.Fatal("head change did not invalidate cache")
	}
}
