package forge

import (
	"strings"
	"testing"

	"faah/internal/settings"
)

func TestResolveGitHubTokenPrecedence(t *testing.T) {
	// settings.json wins over everything, including the environment.
	t.Setenv("GITHUB_TOKEN", "env-token")
	settingsToken := "settings-token"
	token, source := resolveGitHubToken(settings.Settings{GitHubToken: &settingsToken})
	if token != "settings-token" || source != "settings" {
		t.Errorf("got (%q, %q), want (settings-token, settings)", token, source)
	}

	// With no settings token, the environment variable wins.
	token, source = resolveGitHubToken(settings.Settings{})
	if token != "env-token" || source != "env" {
		t.Errorf("got (%q, %q), want (env-token, env)", token, source)
	}
}

func TestResolveGitHubTokenNoneAvailable(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "")
	// Force `gh` to be unresolvable so the outcome is deterministic
	// regardless of whether the test machine happens to have it installed.
	empty := t.TempDir()
	t.Setenv("PATH", empty)

	token, source := resolveGitHubToken(settings.Settings{})
	if token != "" || source != "" {
		t.Errorf("got (%q, %q), want (\"\", \"\")", token, source)
	}
}

func TestResolveGitHubTokenBlankSettingsFallsThrough(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "env-token")
	blank := "   "
	token, source := resolveGitHubToken(settings.Settings{GitHubToken: &blank})
	if token != "env-token" || source != "env" {
		t.Errorf("a blank settings token must fall through to the env var; got (%q, %q)", token, source)
	}
}

func TestTokenSetupPerForge(t *testing.T) {
	cases := []struct {
		p       Provider
		host    string
		url     string
		hostKey string
	}{
		{&GitHub{}, "github.com", "https://github.com/settings/personal-access-tokens/new", ""},
		{&gitlab{}, "gitlab.corp.io", "https://gitlab.corp.io/-/user_settings/personal_access_tokens", "gitlab.host"},
		{&gitea{}, "git.example.org", "https://git.example.org/user/settings/applications", "gitea.host"},
		{&bitbucket{}, "bitbucket.org", "https://id.atlassian.com/manage-profile/security/api-tokens", ""},
	}
	for _, c := range cases {
		st := c.p.TokenSetup(c.host)
		if st.URL != c.url || st.HostKey != c.hostKey || len(st.Steps) == 0 || st.Env == "" || st.Readonly == "" {
			t.Errorf("%s: %+v", c.p.Name(), st)
		}
		// Every setting the dialog writes must exist in the Settings schema.
		for _, key := range []string{c.p.Info().TokenKey, st.HostKey} {
			if key != "" && !schemaHas(key) {
				t.Errorf("%s: setting %q missing from the schema", c.p.Name(), key)
			}
		}
		if st.Extra != nil && !schemaHas(st.Extra.Key) {
			t.Errorf("%s: setting %q missing from the schema", c.p.Name(), st.Extra.Key)
		}
	}
}

func schemaHas(key string) bool {
	for _, it := range settings.Schema {
		if it.Key == key {
			return true
		}
	}
	return false
}

func TestGiteaTokenScopedToHost(t *testing.T) {
	t.Setenv("GITEA_HOST", "")
	t.Setenv("GITEA_TOKEN", "envtok")
	g := &gitea{}
	if tok, _ := g.ResolveToken(settings.Settings{}, PRTarget{Host: "codeberg.org"}); tok != "envtok" {
		t.Errorf("codeberg default: %q", tok)
	}
	if tok, _ := g.ResolveToken(settings.Settings{}, PRTarget{Host: "evil.example"}); tok != "" {
		t.Errorf("token leaked to another host: %q", tok)
	}
	host, tok := "https://git.corp.example/", "settok"
	cfg := settings.Settings{GiteaHost: &host, GiteaToken: &tok}
	if got, src := g.ResolveToken(cfg, PRTarget{Host: "git.corp.example"}); got != "settok" || src != "settings" {
		t.Errorf("configured host: %q/%q", got, src)
	}
	if got, _ := g.ResolveToken(cfg, PRTarget{Host: "codeberg.org"}); got != "" {
		t.Errorf("configured host set, codeberg got %q", got)
	}
}

func TestBitbucketAuthKinds(t *testing.T) {
	b := &bitbucket{}
	t.Setenv("BITBUCKET_EMAIL", "")
	if a := bitbucketAPI("tok"); a.auth != "Bearer tok" {
		t.Errorf("access token API auth = %q", a.auth)
	}
	if a := b.GitAuth(PRTarget{}, "tok"); a.Prefix != "https://bitbucket.org/" || a.Header != basicGitAuth("bitbucket.org", "x-token-auth", "tok").Header {
		t.Errorf("access token git auth = %+v", a)
	}
	t.Setenv("BITBUCKET_EMAIL", "me@example.com")
	if a := bitbucketAPI("tok"); !strings.HasPrefix(a.auth, "Basic ") {
		t.Errorf("API token auth = %q", a.auth)
	}
	if a := b.GitAuth(PRTarget{}, "tok"); a.Header != basicGitAuth("bitbucket.org", "x-bitbucket-api-token-auth", "tok").Header {
		t.Errorf("API token git auth = %+v", a)
	}
}

// A token configured for gitlab.com must never be sent to whatever host a
// merge request URL names.
func TestGitLabTokenScopedToHost(t *testing.T) {
	t.Setenv("GITLAB_HOST", "")
	t.Setenv("GITLAB_TOKEN", "envtok")
	t.Setenv("PATH", t.TempDir()) // no glab
	tok := "settok"
	cfg := settings.Settings{GitLabToken: &tok}
	g := &gitlab{}
	if got, src := g.ResolveToken(cfg, PRTarget{Host: "gitlab.com"}); got != "settok" || src != "settings" {
		t.Errorf("gitlab.com: %q/%q", got, src)
	}
	if got, _ := g.ResolveToken(settings.Settings{}, PRTarget{Host: "gitlab.com"}); got != "envtok" {
		t.Errorf("gitlab.com env: %q", got)
	}
	if got, _ := g.ResolveToken(cfg, PRTarget{Host: "evil.example.com"}); got != "" {
		t.Errorf("token leaked to another host: %q", got)
	}
	t.Setenv("GITLAB_HOST", "https://git.corp.example/")
	if got, _ := g.ResolveToken(cfg, PRTarget{Host: "git.corp.example"}); got != "settok" {
		t.Errorf("GITLAB_HOST instance: %q", got)
	}
	if got, _ := g.ResolveToken(cfg, PRTarget{Host: "gitlab.com"}); got != "" {
		t.Errorf("with GITLAB_HOST set, gitlab.com got %q", got)
	}
}
