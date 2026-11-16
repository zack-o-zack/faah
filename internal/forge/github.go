package forge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"faah/internal/git"
)

const githubAPIBase = "https://api.github.com"

var githubPRURLRe = regexp.MustCompile(`^(?:https?://)?github\.com/([^/]+)/([^/]+)/pull/(\d+)`)

// GitHub implements Provider for GitHub.
type GitHub struct{}

func (g *GitHub) Name() string { return "github" }

func (g *GitHub) MatchURL(rawURL string) bool {
	return githubPRURLRe.MatchString(strings.TrimSpace(rawURL))
}

func (g *GitHub) ParseURL(rawURL string) (PRTarget, error) {
	m := githubPRURLRe.FindStringSubmatch(strings.TrimSpace(rawURL))
	if m == nil {
		return PRTarget{}, fmt.Errorf("invalid GitHub pull request URL: %q (expected format https://github.com/owner/repo/pull/123)", rawURL)
	}
	n, _ := strconv.Atoi(m[3])
	return PRTarget{
		Provider: "github",
		Host:     "github.com",
		Owner:    m[1],
		Repo:     strings.TrimSuffix(m[2], ".git"),
		Number:   n,
		URL:      rawURL,
	}, nil
}

func (g *GitHub) Info() Info {
	return Info{
		Name: "github", Label: "GitHub", TokenKey: "github.token", TokenCategory: "GitHub",
		TokenHint: "set GITHUB_TOKEN, set GH_TOKEN, or run `gh auth login`",
	}
}

func (g *GitHub) TokenSetup(host string) TokenSetup {
	return TokenSetup{
		URL: "https://github.com/settings/personal-access-tokens/new",
		Steps: []string{
			"Name the token (e.g. fibo) and pick an expiration.",
			"Under Repository access, choose the repositories you review (or All repositories).",
			"Under Repository permissions, set Contents and Pull requests to Read and write.",
			"Generate the token and copy it.",
		},
		CLI:      "gh auth login",
		Env:      "GITHUB_TOKEN",
		Readonly: "Public repositories open and diff without a token; posting comments, reviewing, pushing and merging need one.",
	}
}

func (g *GitHub) MatchRemote(remoteURL string) bool {
	return RemoteHost(remoteURL) == "github.com"
}

func (g *GitHub) CloneURL(target PRTarget) string {
	return fmt.Sprintf("https://github.com/%s/%s.git", target.Owner, target.Repo)
}

func (g *GitHub) PRHeadRef(target PRTarget) string {
	return fmt.Sprintf("refs/pull/%d/head", target.Number)
}

func (g *GitHub) GitAuth(target PRTarget, token string) git.Auth {
	return basicGitAuth("github.com", "x-access-token", token)
}

func (g *GitHub) FetchPR(ctx context.Context, target PRTarget, token string) (PRMeta, error) {
	return fetchPRMeta(ctx, target.Owner, target.Repo, target.Number, token)
}

func (g *GitHub) CheckPushAccess(ctx context.Context, target PRTarget, token string) bool {
	return checkPushAccess(ctx, target.Owner, target.Repo, token)
}

func (g *GitHub) SubmitReview(ctx context.Context, target PRTarget, token, headSHA string, comments []DraftComment, event, body string) error {
	return submitReview(ctx, target.Owner, target.Repo, target.Number, token, headSHA, comments, event, body)
}

func (g *GitHub) FetchComments(ctx context.Context, target PRTarget, token string) ([]PRComment, []PRComment, error) {
	return fetchComments(ctx, target.Owner, target.Repo, target.Number, token)
}

func (g *GitHub) PostIssueComment(ctx context.Context, target PRTarget, token, body string) (PRComment, error) {
	return postIssueComment(ctx, target.Owner, target.Repo, target.Number, token, body)
}

func (g *GitHub) ReplyToReviewComment(ctx context.Context, target PRTarget, token string, commentID int64, body string) (PRComment, error) {
	return replyToReviewComment(ctx, target.Owner, target.Repo, target.Number, token, commentID, body)
}

func (g *GitHub) MergeStatus(ctx context.Context, target PRTarget, token string) (PRMergeStatus, error) {
	return fetchMergeStatus(ctx, target.Owner, target.Repo, target.Number, token)
}

func (g *GitHub) Merge(ctx context.Context, target PRTarget, token string, req PRMergeRequest) (PRMergeResult, error) {
	return mergePR(ctx, target.Owner, target.Repo, target.Number, token, req)
}

func githubAPI(token string) api {
	a := api{
		name:    "github",
		base:    githubAPIBase,
		accept:  "application/vnd.github+json",
		headers: map[string]string{"X-GitHub-Api-Version": "2022-11-28"},
	}
	if token != "" {
		a.auth = "Bearer " + token
	}
	return a
}

// githubRequest issues an authenticated (if token != "") GitHub REST call.
func githubRequest(ctx context.Context, method, path, token string, body any) (*http.Response, error) {
	return githubAPI(token).request(ctx, method, path, body)
}

// checkPushAccess reports whether token has push access to owner/repo. Fails
// closed: any transport error, non-200, or missing field yields false, never
// true, so a broken check can only ever hide the write UI, not expose it.
func checkPushAccess(ctx context.Context, owner, repo, token string) bool {
	if token == "" {
		return false
	}
	resp, err := githubRequest(ctx, http.MethodGet, "/repos/"+owner+"/"+repo, token, nil)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var out struct {
		Permissions struct {
			Push bool `json:"push"`
		} `json:"permissions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return false
	}
	return out.Permissions.Push
}

func fetchPRMeta(ctx context.Context, owner, repo string, num int, token string) (PRMeta, error) {
	resp, err := githubRequest(ctx, http.MethodGet, fmt.Sprintf("/repos/%s/%s/pulls/%d", owner, repo, num), token, nil)
	if err != nil {
		return PRMeta{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		bodyMsg := strings.TrimSpace(string(b))
		if token == "" && (resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized) {
			return PRMeta{}, fmt.Errorf("github: fetch PR #%d: %s (no GitHub token found; for private repos or rate limits, set GITHUB_TOKEN or run 'gh auth login'): %s", num, resp.Status, bodyMsg)
		}
		return PRMeta{}, fmt.Errorf("github: fetch PR #%d: %s: %s", num, resp.Status, bodyMsg)
	}
	var out struct {
		Number   int    `json:"number"`
		Title    string `json:"title"`
		State    string `json:"state"`
		Merged   bool   `json:"merged"`
		MergedAt string `json:"merged_at"`
		Draft    bool   `json:"draft"`
		User     struct {
			Login string `json:"login"`
		} `json:"user"`
		Base struct {
			Ref string `json:"ref"`
		} `json:"base"`
		Head struct {
			Ref  string `json:"ref"`
			SHA  string `json:"sha"`
			Repo struct {
				CloneURL string `json:"clone_url"`
				FullName string `json:"full_name"`
			} `json:"repo"`
		} `json:"head"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return PRMeta{}, err
	}
	m := PRMeta{
		Number:           out.Number,
		Title:            out.Title,
		Author:           out.User.Login,
		State:            out.State,
		Merged:           out.Merged || out.MergedAt != "",
		MergedAt:         out.MergedAt,
		Draft:            out.Draft,
		BaseRef:          out.Base.Ref,
		HeadRef:          out.Head.Ref,
		HeadSHA:          out.Head.SHA,
		HeadRepoCloneURL: out.Head.Repo.CloneURL,
	}
	m.HeadIsFork = out.Head.Repo.FullName != "" && !strings.EqualFold(out.Head.Repo.FullName, owner+"/"+repo)
	return m, nil
}

// submitReview posts one review carrying every draft comment plus an overall
// verdict in a single call, mirroring GitHub's own draft-then-submit model
// so faah never needs a per-comment endpoint.
func submitReview(ctx context.Context, owner, repo string, num int, token, commitID string, comments []DraftComment, event, body string) error {
	type reviewComment struct {
		Path string `json:"path"`
		Line int    `json:"line"`
		Side string `json:"side"`
		Body string `json:"body"`
	}
	payload := struct {
		CommitID string          `json:"commit_id,omitempty"`
		Body     string          `json:"body,omitempty"`
		Event    string          `json:"event"`
		Comments []reviewComment `json:"comments,omitempty"`
	}{CommitID: commitID, Body: body, Event: event}
	for _, c := range comments {
		payload.Comments = append(payload.Comments, reviewComment{Path: c.Path, Line: c.Line, Side: c.Side, Body: c.Body})
	}
	resp, err := githubRequest(ctx, http.MethodPost, fmt.Sprintf("/repos/%s/%s/pulls/%d/reviews", owner, repo, num), token, payload)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("github: submit review: %s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	return nil
}

type ghUser struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
}

type ghIssueComment struct {
	ID        int64  `json:"id"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
	HTMLURL   string `json:"html_url"`
	User      ghUser `json:"user"`
}

func (c ghIssueComment) toPRComment() PRComment {
	return PRComment{
		ID: c.ID, Kind: "issue", Author: c.User.Login, AvatarURL: c.User.AvatarURL,
		Body: c.Body, CreatedAt: c.CreatedAt, URL: c.HTMLURL,
	}
}

type ghReviewComment struct {
	ID           int64  `json:"id"`
	Body         string `json:"body"`
	Path         string `json:"path"`
	Line         int    `json:"line"`
	OriginalLine int    `json:"original_line"`
	Side         string `json:"side"`
	InReplyToID  int64  `json:"in_reply_to_id"`
	CreatedAt    string `json:"created_at"`
	HTMLURL      string `json:"html_url"`
	User         ghUser `json:"user"`
}

func (c ghReviewComment) toPRComment() PRComment {
	// An outdated review comment (its line since edited elsewhere in the
	// diff) has line == null; original_line still says where it was.
	line := c.Line
	if line == 0 {
		line = c.OriginalLine
	}
	return PRComment{
		ID: c.ID, Kind: "review", Path: c.Path, Line: line, Side: c.Side, InReplyTo: c.InReplyToID,
		Author: c.User.Login, AvatarURL: c.User.AvatarURL, Body: c.Body, CreatedAt: c.CreatedAt, URL: c.HTMLURL,
	}
}

// fetchComments returns every comment already posted on the PR: top-level
// ("issue") comments from the issues API, and inline ("review") comments
// (which may be replies, linked via InReplyTo) from the pulls API.
func fetchComments(ctx context.Context, owner, repo string, num int, token string) (issue, review []PRComment, err error) {
	a := githubAPI(token)
	issueRaw, err := a.linkPages(ctx, fmt.Sprintf("/repos/%s/%s/issues/%d/comments?per_page=100", owner, repo, num))
	if err != nil {
		return nil, nil, err
	}
	reviewRaw, err := a.linkPages(ctx, fmt.Sprintf("/repos/%s/%s/pulls/%d/comments?per_page=100", owner, repo, num))
	if err != nil {
		return nil, nil, err
	}
	issue = make([]PRComment, 0, len(issueRaw))
	for _, raw := range issueRaw {
		var c ghIssueComment
		if err := json.Unmarshal(raw, &c); err == nil {
			issue = append(issue, c.toPRComment())
		}
	}
	review = make([]PRComment, 0, len(reviewRaw))
	for _, raw := range reviewRaw {
		var c ghReviewComment
		if err := json.Unmarshal(raw, &c); err == nil {
			review = append(review, c.toPRComment())
		}
	}
	return issue, review, nil
}

// postIssueComment posts a new top-level PR conversation comment. GitHub's
// issue comments have no reply/threading concept, so this is also how a
// "reply" to one is implemented: just a new comment.
func postIssueComment(ctx context.Context, owner, repo string, num int, token, body string) (PRComment, error) {
	resp, err := githubRequest(ctx, http.MethodPost, fmt.Sprintf("/repos/%s/%s/issues/%d/comments", owner, repo, num), token, map[string]string{"body": body})
	if err != nil {
		return PRComment{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return PRComment{}, fmt.Errorf("github: post comment: %s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	var c ghIssueComment
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		return PRComment{}, err
	}
	return c.toPRComment(), nil
}

// replyToReviewComment posts an immediate, properly threaded reply to an
// existing inline review comment via GitHub's dedicated replies endpoint.
func replyToReviewComment(ctx context.Context, owner, repo string, num int, token string, commentID int64, body string) (PRComment, error) {
	resp, err := githubRequest(ctx, http.MethodPost, fmt.Sprintf("/repos/%s/%s/pulls/%d/comments/%d/replies", owner, repo, num, commentID), token, map[string]string{"body": body})
	if err != nil {
		return PRComment{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return PRComment{}, fmt.Errorf("github: reply to review comment: %s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	var c ghReviewComment
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		return PRComment{}, err
	}
	return c.toPRComment(), nil
}

// fetchMergeStatus combines the PR's mergeability (computed lazily by GitHub:
// the first read after a push often says null/"unknown") with the
// repository's allowed merge methods and the token's push rights.
func fetchMergeStatus(ctx context.Context, owner, repo string, num int, token string) (PRMergeStatus, error) {
	resp, err := githubRequest(ctx, http.MethodGet, fmt.Sprintf("/repos/%s/%s/pulls/%d", owner, repo, num), token, nil)
	if err != nil {
		return PRMergeStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return PRMergeStatus{}, fmt.Errorf("github: fetch PR #%d: %s: %s", num, resp.Status, strings.TrimSpace(string(b)))
	}
	var pr struct {
		State          string `json:"state"`
		Merged         bool   `json:"merged"`
		Draft          bool   `json:"draft"`
		Mergeable      *bool  `json:"mergeable"`
		MergeableState string `json:"mergeable_state"`
		Base           struct {
			Ref string `json:"ref"`
		} `json:"base"`
		Head struct {
			SHA string `json:"sha"`
		} `json:"head"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return PRMergeStatus{}, err
	}
	st := PRMergeStatus{HeadSHA: pr.Head.SHA, Methods: []string{}}
	st.State, st.Reason = githubMergeState(pr.Merged, pr.State, pr.Draft, pr.Mergeable, pr.MergeableState, pr.Base.Ref)

	if token == "" {
		return st, nil
	}
	rresp, err := githubRequest(ctx, http.MethodGet, "/repos/"+owner+"/"+repo, token, nil)
	if err != nil {
		return st, nil // the state alone is still worth showing
	}
	defer rresp.Body.Close()
	if rresp.StatusCode != http.StatusOK {
		return st, nil
	}
	var r struct {
		AllowMergeCommit *bool `json:"allow_merge_commit"`
		AllowSquashMerge *bool `json:"allow_squash_merge"`
		AllowRebaseMerge *bool `json:"allow_rebase_merge"`
		Permissions      struct {
			Push bool `json:"push"`
		} `json:"permissions"`
	}
	if err := json.NewDecoder(rresp.Body).Decode(&r); err != nil {
		return st, nil
	}
	// The allow_* fields are only returned to tokens with admin or push
	// rights; absent means "not ours to know", so nothing is offered.
	for _, m := range []struct {
		allowed *bool
		method  string
	}{{r.AllowMergeCommit, MergeMethodMerge}, {r.AllowSquashMerge, MergeMethodSquash}, {r.AllowRebaseMerge, MergeMethodRebase}} {
		if m.allowed != nil && *m.allowed {
			st.Methods = append(st.Methods, m.method)
		}
	}
	st.CanMerge = r.Permissions.Push
	return st, nil
}

// githubMergeState maps GitHub's mergeable/mergeable_state pair onto the
// forge-neutral mergeState* values.
func githubMergeState(merged bool, state string, draft bool, mergeable *bool, mergeableState, base string) (string, string) {
	switch {
	case merged:
		return mergeStateMerged, ""
	case state == "closed":
		return mergeStateClosed, ""
	case draft || mergeableState == "draft":
		return mergeStateDraft, "this PR is still a draft"
	}
	switch mergeableState {
	case "dirty":
		return mergeStateConflicts, "this branch has conflicts with " + base
	case "behind":
		return mergeStateBehind, "this branch is out of date with " + base
	case "blocked":
		return mergeStateBlocked, "branch protection requires approving reviews or passing checks"
	case "unstable":
		return mergeStateUnstable, "some checks are failing or still running"
	case "clean", "has_hooks":
		return mergeStateClean, ""
	}
	if mergeable != nil && !*mergeable {
		return mergeStateConflicts, "this branch has conflicts with " + base
	}
	return mergeStateUnknown, ""
}

// mergePR merges via PUT /pulls/{n}/merge. The sha guard makes GitHub itself
// refuse (409) a head that moved after the reviewer looked at it.
func mergePR(ctx context.Context, owner, repo string, num int, token string, req PRMergeRequest) (PRMergeResult, error) {
	payload := map[string]string{"merge_method": req.Method}
	if req.HeadSHA != "" {
		payload["sha"] = req.HeadSHA
	}
	if req.Method != MergeMethodRebase {
		if req.Title != "" {
			payload["commit_title"] = req.Title
		}
		if req.Message != "" {
			payload["commit_message"] = req.Message
		}
	}
	resp, err := githubRequest(ctx, http.MethodPut, fmt.Sprintf("/repos/%s/%s/pulls/%d/merge", owner, repo, num), token, payload)
	if err != nil {
		return PRMergeResult{}, err
	}
	defer resp.Body.Close()
	var out struct {
		SHA     string `json:"sha"`
		Merged  bool   `json:"merged"`
		Message string `json:"message"`
	}
	b, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(b, &out)
	switch resp.StatusCode {
	case http.StatusOK:
		return PRMergeResult{SHA: out.SHA, Message: out.Message}, nil
	case http.StatusConflict:
		return PRMergeResult{}, fmt.Errorf("github: %w: %s", ErrPRHeadMoved, out.Message)
	case http.StatusMethodNotAllowed, http.StatusUnprocessableEntity:
		msg := out.Message
		if msg == "" {
			msg = strings.TrimSpace(string(b))
		}
		return PRMergeResult{}, fmt.Errorf("github: %w: %s", ErrPRNotMergeable, msg)
	}
	return PRMergeResult{}, fmt.Errorf("github: merge PR #%d: %s: %s", num, resp.Status, strings.TrimSpace(string(b)))
}
