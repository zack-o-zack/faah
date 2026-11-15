package forge

import (
	"net/url"
	"os/exec"
	"sort"
	"strings"

	"faah/internal/git"
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

// FindRemote reports the git repository containing dir and the name of its
// remote that points at owner/repo, preferring origin, then upstream (a fork
// checkout), then any other. Both are empty when dir is not such a clone.
func FindRemote(dir, owner, repo string) (toplevel, remote string) {
	if owner == "" || repo == "" {
		return "", ""
	}
	info := git.Probe(dir)
	if !info.OK() || info.Root() == "" {
		return "", ""
	}
	out, err := exec.Command("git", "-C", info.Root(), "remote").Output()
	if err != nil {
		return "", ""
	}
	names := strings.Fields(string(out))
	rank := func(n string) int {
		switch n {
		case "origin":
			return 0
		case "upstream":
			return 1
		}
		return 2
	}
	sort.SliceStable(names, func(i, j int) bool { return rank(names[i]) < rank(names[j]) })
	for _, name := range names {
		u, err := exec.Command("git", "-C", info.Root(), "remote", "get-url", name).Output()
		if err == nil && remoteMatchesRepo(string(u), owner, repo) {
			return info.Root(), name
		}
	}
	return "", ""
}

// remoteMatchesRepo reports whether a remote URL (https, ssh or scp-style)
// names owner/repo, ignoring case. owner may be a nested GitLab group path
// ("group/sub"), so the whole repository path is compared, not just its last
// two segments; only a local-path remote matches by suffix.
func remoteMatchesRepo(remoteURL, owner, repo string) bool {
	want := strings.ToLower(owner + "/" + repo)
	u := strings.ToLower(strings.TrimSpace(remoteURL))
	local := false
	switch {
	case strings.Contains(u, "://"):
		parsed, err := url.Parse(u)
		if err != nil {
			return false
		}
		local = parsed.Scheme == "file"
		u = parsed.Path
	case RemoteHost(u) != "":
		_, u, _ = strings.Cut(u, ":")
	default:
		local = true
	}
	u = strings.TrimSuffix(strings.Trim(u, "/"), ".git")
	return u == want || (local && strings.HasSuffix(u, "/"+want))
}
