package git

import (
	"fmt"
	"net/url"
	"os/exec"
	"strings"
)

// commitWebURL returns a web URL for one commit on GitHub/GitLab/Bitbucket,
// or "" when the remote isn't one of those.
func commitWebURL(root, sha string) string {
	host, path, ok := remoteHostPath(RemoteURL(root, CurrentBranch(root)))
	if !ok || path == "" {
		return ""
	}
	if strings.Contains(host, "gitlab") {
		return fmt.Sprintf("https://%s/%s/-/commit/%s", host, path, sha)
	}
	return fmt.Sprintf("https://%s/%s/commit/%s", host, path, sha)
}

// githubAuthorURL guesses a GitHub page for a commit author. A
// users.noreply.github.com address carries the login outright, so that becomes
// a profile link; otherwise the best that can be said from a commit alone is
// "this repo's commits by this address", which is at least always right about
// who it means. Non-GitHub remotes get nothing.
func githubAuthorURL(root, email, name string) string {
	host, path, ok := remoteHostPath(RemoteURL(root, CurrentBranch(root)))
	if !ok || path == "" || !strings.Contains(host, "github") {
		return ""
	}
	if login, _, found := strings.Cut(email, "@"); found && strings.HasSuffix(email, "users.noreply.github.com") {
		// "12345+octocat@users.noreply.github.com" and the older "octocat@..."
		if _, after, hasID := strings.Cut(login, "+"); hasID {
			login = after
		}
		if login != "" {
			return "https://" + host + "/" + url.PathEscape(login)
		}
	}
	q := email
	if q == "" {
		q = name
	}
	if q == "" {
		return ""
	}
	return fmt.Sprintf("https://%s/%s/commits?author=%s", host, path, url.QueryEscape(q))
}

// HeadCommit returns the abbreviated or full HEAD commit hash.
func HeadCommit(root string) string {
	out, err := exec.Command("git", "-C", root, "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// RemoteURL returns the fetch URL for the repo's upstream or origin remote.
func RemoteURL(root, branch string) string {
	if branch != "" {
		if remote, _, ok := Upstream(root, branch); ok {
			if out, err := exec.Command("git", "-C", root, "config", "--get", fmt.Sprintf("remote.%s.url", remote)).Output(); err == nil {
				if u := strings.TrimSpace(string(out)); u != "" {
					return u
				}
			}
		}
	}
	out, err := exec.Command("git", "-C", root, "config", "--get", "remote.origin.url").Output()
	if err == nil {
		return strings.TrimSpace(string(out))
	}
	return ""
}

// CommitsWebURL returns a web URL to view commits on GitHub/GitLab/Bitbucket if configured.
func CommitsWebURL(root, branch string) string {
	host, path, ok := remoteHostPath(RemoteURL(root, branch))
	if !ok || path == "" {
		return ""
	}
	seg := "commits"
	if strings.Contains(host, "gitlab") {
		seg = "-/commits"
	}
	if branch != "" && branch != "HEAD" {
		return fmt.Sprintf("https://%s/%s/%s/%s", host, path, seg, branch)
	}
	return fmt.Sprintf("https://%s/%s/%s", host, path, seg)
}

// remoteHostPath splits a remote URL -- in any of git's spellings -- into its
// host and "owner/repo" path. ok is false for a local path or anything it
// can't recognise.
func remoteHostPath(raw string) (host, path string, ok bool) {
	raw = strings.TrimSuffix(raw, ".git")
	switch {
	case strings.HasPrefix(raw, "git@"): // git@host:owner/repo
		h, p, found := strings.Cut(raw[4:], ":")
		if !found {
			return "", "", false
		}
		return h, strings.TrimPrefix(p, "/"), true
	case strings.HasPrefix(raw, "ssh://"): // ssh://git@host/owner/repo
		clean := strings.TrimPrefix(raw, "ssh://")
		if i := strings.Index(clean, "@"); i >= 0 {
			clean = clean[i+1:]
		}
		h, p, found := strings.Cut(clean, "/")
		if !found {
			return "", "", false
		}
		return h, p, true
	case strings.HasPrefix(raw, "http://"), strings.HasPrefix(raw, "https://"):
		u, err := url.Parse(raw)
		if err != nil {
			return "", "", false
		}
		u.User = nil // strip user:token if any
		return u.Host, strings.TrimPrefix(u.Path, "/"), true
	}
	return "", "", false
}
