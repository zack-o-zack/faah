package forge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// sortComments orders comments oldest first (ID breaking ties), the order
// threads are built in.
func sortComments(cs []PRComment) {
	sort.SliceStable(cs, func(i, j int) bool {
		if cs[i].CreatedAt != cs[j].CreatedAt {
			return cs[i].CreatedAt < cs[j].CreatedAt
		}
		return cs[i].ID < cs[j].ID
	})
}

var githubHTTPClient = &http.Client{Timeout: 15 * time.Second}

var githubLinkNextRe = regexp.MustCompile(`<([^>]+)>;\s*rel="next"`)

// api is one forge's API root, auth header and error-body reader.
type api struct {
	name    string            // for error text: "github", "gitlab", "gitea", "bitbucket"
	base    string            // e.g. "https://codeberg.org/api/v1"
	auth    string            // full Authorization header value, "" for anonymous
	accept  string            // Accept header; defaults to "application/json"
	headers map[string]string // extra request headers
	message func(body []byte) string
}

func (a api) request(ctx context.Context, method, path string, body any) (*http.Response, error) {
	u := path
	if !strings.HasPrefix(path, "http://") && !strings.HasPrefix(path, "https://") {
		u = a.base + path
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rdr)
	if err != nil {
		return nil, err
	}
	accept := a.accept
	if accept == "" {
		accept = "application/json"
	}
	req.Header.Set("Accept", accept)
	for k, v := range a.headers {
		req.Header.Set(k, v)
	}
	if a.auth != "" {
		req.Header.Set("Authorization", a.auth)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return githubHTTPClient.Do(req)
}

// do issues method on path (relative to base, or an absolute URL) and
// decodes a 2xx reply into out when it is non-nil. The status is returned
// on error too, so callers can tell "not mergeable" from "head moved".
func (a api) do(ctx context.Context, method, path string, body, out any) (int, error) {
	resp, err := a.request(ctx, method, path, body)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		msg := strings.TrimSpace(string(b))
		if a.message != nil {
			if m := a.message(b); m != "" {
				msg = m
			}
		}
		return resp.StatusCode, fmt.Errorf("%s: %s %s: %s: %s", a.name, method, path, resp.Status, msg)
	}
	if out != nil && len(bytes.TrimSpace(b)) > 0 {
		if err := json.Unmarshal(b, out); err != nil {
			return resp.StatusCode, err
		}
	}
	return resp.StatusCode, nil
}

// linkPages follows an RFC 8288 Link header's rel="next" until exhausted,
// decoding each page as a raw JSON array so callers can unmarshal elements
// into their own shape.
func (a api) linkPages(ctx context.Context, path string) ([]json.RawMessage, error) {
	var all []json.RawMessage
	next := path
	for next != "" {
		resp, err := a.request(ctx, http.MethodGet, next, nil)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			msg := strings.TrimSpace(string(b))
			if a.message != nil {
				if m := a.message(b); m != "" {
					msg = m
				}
			}
			return nil, fmt.Errorf("%s: get %s: %s: %s", a.name, path, resp.Status, msg)
		}
		var page []json.RawMessage
		err = json.NewDecoder(resp.Body).Decode(&page)
		next = ""
		if m := githubLinkNextRe.FindStringSubmatch(resp.Header.Get("Link")); m != nil {
			next = m[1]
		}
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
	}
	return all, nil
}
