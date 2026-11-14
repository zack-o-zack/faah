package forge

import (
	"net/url"
	"strings"
)

// normalizeHost turns a configured host ("https://git.example.com/" or
// "git.example.com") into a bare lowercase host, or def when it is empty.
func normalizeHost(h, def string) string {
	h = strings.TrimSpace(h)
	if h == "" {
		return def
	}
	if u, err := url.Parse(h); err == nil && u.Host != "" {
		return strings.ToLower(u.Host)
	}
	return strings.ToLower(strings.TrimSuffix(h, "/"))
}

// ForRemote returns the provider a git remote URL belongs to, or nil.
func ForRemote(remoteURL string) Provider {
	for _, p := range defaultProviders {
		if p.MatchRemote(remoteURL) {
			return p
		}
	}
	return nil
}

// RemoteHost is the host of an https, ssh or scp-style remote URL, lowercased.
func RemoteHost(remoteURL string) string {
	u := strings.TrimSpace(remoteURL)
	if strings.Contains(u, "://") {
		if parsed, err := url.Parse(u); err == nil {
			return strings.ToLower(parsed.Hostname())
		}
		return ""
	}
	if at := strings.IndexByte(u, '@'); at >= 0 {
		if host, _, ok := strings.Cut(u[at+1:], ":"); ok {
			return strings.ToLower(host)
		}
	}
	return ""
}

// DetectPRURL checks if rawURL is a recognized pull request URL for any supported provider.
// If matched and valid, returns the matching provider, parsed target, and true.
func DetectPRURL(rawURL string) (Provider, PRTarget, bool) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, PRTarget{}, false
	}
	for _, p := range defaultProviders {
		if p.MatchURL(rawURL) {
			target, err := p.ParseURL(rawURL)
			if err == nil {
				return p, target, true
			}
		}
	}
	return nil, PRTarget{}, false
}

// PRURLExamples is the URL shapes faah opens, for error messages.
const PRURLExamples = "https://github.com/owner/repo/pull/123, https://gitlab.com/group/project/-/merge_requests/45, https://codeberg.org/owner/repo/pulls/7, or https://bitbucket.org/workspace/repo/pull-requests/9"
