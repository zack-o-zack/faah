package server

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"faah/internal/forge"
	"faah/internal/git"
	"faah/internal/httpx/httpxtest"
	prpkg "faah/internal/pr"
	"faah/internal/settings"
)

type connectProvider struct {
	forge.Provider
	good string
}

func (c *connectProvider) FetchPR(ctx context.Context, t forge.PRTarget, token string) (forge.PRMeta, error) {
	if token != c.good {
		return forge.PRMeta{}, errors.New("gitlab: 401 Unauthorized (token " + token + ")")
	}
	return forge.PRMeta{Number: t.Number}, nil
}

func (c *connectProvider) CheckPushAccess(ctx context.Context, t forge.PRTarget, token string) bool {
	return token == c.good
}

func connectServer(t *testing.T, host string) *Server {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("GITLAB_HOST", "")
	t.Setenv("GITLAB_TOKEN", "")
	t.Setenv("PATH", t.TempDir()) // no glab
	s, _ := newTestServer(t)
	s.pr = prpkg.New(&connectProvider{Provider: forge.ForRemote("https://gitlab.com"), good: "good-token"}, forge.PRTarget{Provider: "gitlab", Host: host, Owner: "g", Repo: "r", Number: 4}, forge.PRMeta{Number: 4}, "", "")
	return s
}

func TestForgeConnectAppliesAndSaves(t *testing.T) {
	s := connectServer(t, "gitlab.example.com")
	w := httpxtest.PostJSON(t, s, "/api/forge/connect", `{"token":"good-token"}`)
	if w.Code != 200 {
		t.Fatalf("connect: %d %s", w.Code, w.Body)
	}
	var res map[string]any
	json.Unmarshal(w.Body.Bytes(), &res)
	if res["saved"] != true || res["validated"] != true || res["writeAccess"] != true {
		t.Errorf("result = %v", res)
	}
	// Live: the running review uses it now, with no restart.
	_, _, token := s.pr.Credentials()
	if token != "good-token" || !s.pr.Snapshot().WriteAccess {
		t.Errorf("session token=%q writeAccess=%v", token, s.pr.Snapshot().WriteAccess)
	}
	// Saved, along with the host it belongs to, so the next session finds it.
	cfg := settings.Read()
	if cfg.GitLabToken == nil || *cfg.GitLabToken != "good-token" || cfg.GitLabHost == nil || *cfg.GitLabHost != "gitlab.example.com" {
		t.Errorf("settings = token %v host %v", cfg.GitLabToken, cfg.GitLabHost)
	}
	if tok, src := forge.ForRemote("https://gitlab.com").ResolveToken(cfg, forge.PRTarget{Host: "gitlab.example.com"}); tok != "good-token" || src != "settings" {
		t.Errorf("resolve after connect = %q/%q", tok, src)
	}
	meta := s.forgeMeta()
	if meta["hasToken"] != true || meta["source"] != "settings" {
		t.Errorf("forgeMeta = %v", meta)
	}
}

func TestForgeConnectRejectsBadToken(t *testing.T) {
	s := connectServer(t, "gitlab.com")
	w := httpxtest.PostJSON(t, s, "/api/forge/connect", `{"token":"bad-token"}`)
	if w.Code != 400 {
		t.Fatalf("bad token accepted: %d %s", w.Code, w.Body)
	}
	if body := w.Body.String(); strings.Contains(body, "bad-token") {
		t.Errorf("error echoes the token: %s", body)
	}
	if cfg := settings.Read(); cfg.GitLabToken != nil || cfg.GitLabHost != nil {
		t.Errorf("rejected token was kept: %v %v", cfg.GitLabToken, cfg.GitLabHost)
	}
	_, _, token := s.pr.Credentials()
	if token != "" {
		t.Errorf("session took a rejected token")
	}
	if w := httpxtest.PostJSON(t, s, "/api/forge/connect", `{"token":"  "}`); w.Code != 400 {
		t.Errorf("empty token: %d", w.Code)
	}
}

// A token already saved for one GitLab host is not replaced by connecting to
// another: the new one serves this session only.
func TestForgeConnectKeepsOtherHostsToken(t *testing.T) {
	s := connectServer(t, "gitlab.other.org")
	if err := settings.UpdateMap(map[string]any{"gitlab.token": "corp-token", "gitlab.host": "gitlab.corp.io"}); err != nil {
		t.Fatal(err)
	}
	w := httpxtest.PostJSON(t, s, "/api/forge/connect", `{"token":"good-token"}`)
	var res map[string]any
	json.Unmarshal(w.Body.Bytes(), &res)
	if w.Code != 200 || res["saved"] != false {
		t.Fatalf("connect: %d %v", w.Code, res)
	}
	cfg := settings.Read()
	if *cfg.GitLabToken != "corp-token" || *cfg.GitLabHost != "gitlab.corp.io" {
		t.Errorf("other host's token replaced: %v %v", *cfg.GitLabToken, *cfg.GitLabHost)
	}
	_, _, token := s.pr.Credentials()
	if token != "good-token" || s.forgeMeta()["source"] != "session" {
		t.Errorf("session token = %q, source %v", token, s.forgeMeta()["source"])
	}
}

func TestPRMergeDefaults(t *testing.T) {
	meta := forge.PRMeta{Number: 12, Title: "Add widgets", HeadRef: "widgets"}
	d := prMergeDefaults(meta, []git.UnpushedCommit{{Subject: "second"}, {Subject: "first"}})
	if d[forge.MergeMethodSquash].Title != "Add widgets (#12)" || d[forge.MergeMethodSquash].Message != "* first\n* second" {
		t.Fatalf("squash default = %+v", d[forge.MergeMethodSquash])
	}
	if d[forge.MergeMethodMerge].Title != "Merge pull request #12 from widgets" || d[forge.MergeMethodMerge].Message != "Add widgets" {
		t.Fatalf("merge default = %+v", d[forge.MergeMethodMerge])
	}
}
