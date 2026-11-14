package forge

import (
	"encoding/base64"
	"os"
	"os/exec"
	"strings"

	"faah/internal/git"
	"faah/internal/settings"
)

// basicGitAuth is the https Basic auth most forges accept for git with a
// token as the password; user is whatever name the forge expects with it.
func basicGitAuth(host, user, token string) git.Auth {
	if token == "" {
		return git.Auth{}
	}
	return git.Auth{
		Prefix: "https://" + host + "/",
		Header: "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+token)),
		Token:  token,
	}
}

// TokenSetup walks someone through getting a token for one forge host: the
// page that creates it, what to pick there, and the settings faah stores it
// under. It drives the Connect dialog, so it must name exactly what the
// forge's own page calls things.
type TokenSetup struct {
	URL      string      `json:"url"`                // the forge page that creates a token
	Steps    []string    `json:"steps"`              // what to choose on that page, in order
	CLI      string      `json:"cli,omitempty"`      // a CLI login faah also reads, e.g. "gh auth login"
	Env      string      `json:"env"`                // the environment variable faah also reads
	HostKey  string      `json:"hostKey,omitempty"`  // setting naming the host the token belongs to, for forges that have many
	Extra    *TokenField `json:"extra,omitempty"`    // a second value some tokens need (Bitbucket's account email)
	Readonly string      `json:"readonly,omitempty"` // what works without any token
}

// TokenField is one more input the Connect dialog asks for.
type TokenField struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Placeholder string `json:"placeholder"`
	Hint        string `json:"hint"`
}

func (g *GitHub) ResolveToken(cfg settings.Settings, target PRTarget) (token, source string) {
	return resolveGitHubToken(cfg)
}

// resolveGitHubToken looks for a token in order: the explicit faah setting
// (github.token), the GITHUB_TOKEN environment variable, GH_TOKEN, then the gh CLI
// if installed and logged in. An empty return means PR review stays read-only.
func resolveGitHubToken(cfg settings.Settings) (token, source string) {
	if cfg.GitHubToken != nil {
		if t := strings.TrimSpace(*cfg.GitHubToken); t != "" {
			return t, "settings"
		}
	}
	if t := strings.TrimSpace(os.Getenv("GITHUB_TOKEN")); t != "" {
		return t, "env"
	}
	if t := strings.TrimSpace(os.Getenv("GH_TOKEN")); t != "" {
		return t, "env"
	}
	if out, err := exec.Command("gh", "auth", "token").Output(); err == nil {
		if t := strings.TrimSpace(string(out)); t != "" {
			return t, "gh"
		}
	}
	return "", ""
}

// gitlabTokenHost is the one host the gitlab.token setting and the
// GITLAB_TOKEN variable are sent to: the gitlab.host setting, else
// GITLAB_HOST (glab's own convention), else gitlab.com. A merge request URL
// can name any host, and a token must never reach one it wasn't issued by.
func gitlabTokenHost() string {
	cfg := settings.Read()
	h := ""
	if cfg.GitLabHost != nil {
		h = strings.TrimSpace(*cfg.GitLabHost)
	}
	if h == "" {
		h = strings.TrimSpace(os.Getenv("GITLAB_HOST"))
	}
	return normalizeHost(h, "gitlab.com")
}

// ResolveToken looks, in order, for the gitlab.token setting and then
// GITLAB_TOKEN (both only for gitlabTokenHost), then glab's stored token for
// the target's own host. Empty means the review stays read-only.
func (g *gitlab) ResolveToken(cfg settings.Settings, target PRTarget) (token, source string) {
	host := target.Host
	if host == "" {
		host = "gitlab.com"
	}
	if host == gitlabTokenHost() {
		if cfg.GitLabToken != nil {
			if t := strings.TrimSpace(*cfg.GitLabToken); t != "" {
				return t, "settings"
			}
		}
		if t := strings.TrimSpace(os.Getenv("GITLAB_TOKEN")); t != "" {
			return t, "env"
		}
	}
	if out, err := exec.Command("glab", "config", "get", "token", "--host", host).Output(); err == nil {
		if t := strings.TrimSpace(string(out)); t != "" {
			return t, "glab"
		}
	}
	return "", ""
}

// giteaTokenHost is the one host the gitea.token setting and GITEA_TOKEN are
// sent to: the gitea.host setting, else GITEA_HOST, else codeberg.org. A PR
// URL can name any host, and a token must never reach one it wasn't issued by.
func giteaTokenHost(cfg settings.Settings) string {
	h := ""
	if cfg.GiteaHost != nil {
		h = strings.TrimSpace(*cfg.GiteaHost)
	}
	if h == "" {
		h = strings.TrimSpace(os.Getenv("GITEA_HOST"))
	}
	return normalizeHost(h, "codeberg.org")
}

func (g *gitea) ResolveToken(cfg settings.Settings, t PRTarget) (token, source string) {
	if t.Host != "" && t.Host != giteaTokenHost(cfg) {
		return "", ""
	}
	if cfg.GiteaToken != nil {
		if tok := strings.TrimSpace(*cfg.GiteaToken); tok != "" {
			return tok, "settings"
		}
	}
	if tok := strings.TrimSpace(os.Getenv("GITEA_TOKEN")); tok != "" {
		return tok, "env"
	}
	return "", ""
}

// bitbucketEmail is the Atlassian account email an API token belongs to, or
// "" when the token is an access token.
func bitbucketEmail(cfg settings.Settings) string {
	if cfg.BitbucketEmail != nil {
		if e := strings.TrimSpace(*cfg.BitbucketEmail); e != "" {
			return e
		}
	}
	return strings.TrimSpace(os.Getenv("BITBUCKET_EMAIL"))
}

// Bitbucket Cloud has one host, so there is no cross-host risk to guard.
func (b *bitbucket) ResolveToken(cfg settings.Settings, t PRTarget) (token, source string) {
	if cfg.BitbucketToken != nil {
		if tok := strings.TrimSpace(*cfg.BitbucketToken); tok != "" {
			return tok, "settings"
		}
	}
	if tok := strings.TrimSpace(os.Getenv("BITBUCKET_TOKEN")); tok != "" {
		return tok, "env"
	}
	return "", ""
}
