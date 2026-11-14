package forge

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"faah/internal/git"
	"faah/internal/settings"
)

var bitbucketAPIBase = "https://api.bitbucket.org/2.0"

var bitbucketPRURLRe = regexp.MustCompile(`^(?:https?://)?(?:www\.)?bitbucket\.org/([^/\s]+)/([^/\s]+?)/pull-requests/(\d+)`)

// bitbucket implements Provider for Bitbucket Cloud.
type bitbucket struct{}

func (b *bitbucket) Name() string { return "bitbucket" }

func (b *bitbucket) Info() Info {
	return Info{
		Name: "bitbucket", Label: "Bitbucket", TokenKey: "bitbucket.token", TokenCategory: "Bitbucket",
		TokenHint: "set BITBUCKET_TOKEN (an access token, or an API token with BITBUCKET_EMAIL)",
	}
}

func (b *bitbucket) TokenSetup(host string) TokenSetup {
	return TokenSetup{
		URL: "https://id.atlassian.com/manage-profile/security/api-tokens",
		Steps: []string{
			"Select Create API token with scopes, name it (e.g. faah) and pick an expiry.",
			"Choose Bitbucket as the app.",
			"Grant read and write access to repositories and pull requests, and read access to your account (faah uses it to check push access).",
			"Create the token, copy it, and enter your Atlassian account email below.",
		},
		Env: "BITBUCKET_TOKEN",
		Extra: &TokenField{
			Key: "bitbucket.email", Label: "Atlassian account email", Placeholder: "you@example.com",
			Hint: "Leave empty for a repository, project or workspace access token. Approve and Merge need an API token with an email.",
		},
		Readonly: "Public repositories open and diff without a token; posting comments, reviewing, pushing and merging need one.",
	}
}

func (b *bitbucket) MatchURL(rawURL string) bool {
	return bitbucketPRURLRe.MatchString(strings.TrimSpace(rawURL))
}

func (b *bitbucket) ParseURL(rawURL string) (PRTarget, error) {
	m := bitbucketPRURLRe.FindStringSubmatch(strings.TrimSpace(rawURL))
	if m == nil {
		return PRTarget{}, fmt.Errorf("invalid Bitbucket pull request URL: %q (expected format https://bitbucket.org/workspace/repo/pull-requests/12)", rawURL)
	}
	n, _ := strconv.Atoi(m[3])
	return PRTarget{
		Provider: "bitbucket",
		Host:     "bitbucket.org",
		Owner:    m[1],
		Repo:     strings.TrimSuffix(m[2], ".git"),
		Number:   n,
		URL:      rawURL,
	}, nil
}

func (b *bitbucket) MatchRemote(remoteURL string) bool {
	return RemoteHost(remoteURL) == "bitbucket.org"
}

func (b *bitbucket) CloneURL(t PRTarget) string {
	return fmt.Sprintf("https://bitbucket.org/%s/%s.git", t.Owner, t.Repo)
}

// PRHeadRef is empty: Bitbucket publishes no ref for a PR head.
func (b *bitbucket) PRHeadRef(t PRTarget) string { return "" }

// Access tokens authenticate git as "x-token-auth"; API tokens as the fixed
// name Atlassian documents for them.
func (b *bitbucket) GitAuth(t PRTarget, token string) git.Auth {
	if bitbucketEmail(settings.Read()) != "" {
		return basicGitAuth("bitbucket.org", "x-bitbucket-api-token-auth", token)
	}
	return basicGitAuth("bitbucket.org", "x-token-auth", token)
}

func bitbucketAPI(token string) api {
	a := api{name: "bitbucket", base: bitbucketAPIBase, message: bitbucketMessage}
	if token != "" {
		if email := bitbucketEmail(settings.Read()); email != "" {
			a.auth = "Basic " + base64.StdEncoding.EncodeToString([]byte(email+":"+token))
		} else {
			a.auth = "Bearer " + token
		}
	}
	return a
}

func bitbucketMessage(body []byte) string {
	var e struct {
		Error struct {
			Message string `json:"message"`
			Detail  any    `json:"detail"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &e) != nil || e.Error.Message == "" {
		return ""
	}
	if d, ok := e.Error.Detail.(string); ok && d != "" {
		return e.Error.Message + ": " + d
	}
	return e.Error.Message
}

func bitbucketRepoPath(fullName string) string {
	owner, repo, _ := strings.Cut(fullName, "/")
	return "/repositories/" + url.PathEscape(owner) + "/" + url.PathEscape(repo)
}

func bitbucketPRPath(t PRTarget) string {
	return fmt.Sprintf("%s/pullrequests/%d", bitbucketRepoPath(t.Owner+"/"+t.Repo), t.Number)
}

type bbUser struct {
	DisplayName string `json:"display_name"`
	Nickname    string `json:"nickname"`
	Links       struct {
		Avatar struct {
			Href string `json:"href"`
		} `json:"avatar"`
	} `json:"links"`
}

func (u bbUser) name() string {
	if u.Nickname != "" {
		return u.Nickname
	}
	return u.DisplayName
}

type bbEndpoint struct {
	Branch struct {
		Name string `json:"name"`
	} `json:"branch"`
	Commit *struct {
		Hash string `json:"hash"`
	} `json:"commit"`
	Repository *struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
}

type bbPR struct {
	ID          int        `json:"id"`
	Title       string     `json:"title"`
	State       string     `json:"state"` // OPEN, MERGED, DECLINED, SUPERSEDED
	Draft       bool       `json:"draft"`
	Author      bbUser     `json:"author"`
	UpdatedOn   string     `json:"updated_on"`
	Source      bbEndpoint `json:"source"`
	Destination bbEndpoint `json:"destination"`
	MergeCommit *struct {
		Hash string `json:"hash"`
	} `json:"merge_commit"`
}

// sourceRepo is the repository the PR's commits live in: the fork, or the
// target itself.
func (p bbPR) sourceRepo(t PRTarget) string {
	if p.Source.Repository != nil && p.Source.Repository.FullName != "" {
		return p.Source.Repository.FullName
	}
	return t.Owner + "/" + t.Repo
}

func (b *bitbucket) fetchPR(ctx context.Context, t PRTarget, token string) (bbPR, error) {
	var pr bbPR
	code, err := bitbucketAPI(token).do(ctx, http.MethodGet, bitbucketPRPath(t), nil, &pr)
	if err != nil && token == "" && (code == http.StatusNotFound || code == http.StatusUnauthorized || code == http.StatusForbidden) {
		return pr, fmt.Errorf("%w (no Bitbucket token found; for private repositories, %s)", err, b.Info().TokenHint)
	}
	return pr, err
}

// headSHA is the PR head as a full hash. Bitbucket reports 12 characters;
// the commit endpoint gives the rest. The short hash is kept if that fails.
func (b *bitbucket) headSHA(ctx context.Context, t PRTarget, token string, pr bbPR) string {
	if pr.Source.Commit == nil {
		return ""
	}
	short := pr.Source.Commit.Hash
	if len(short) == 40 {
		return short
	}
	var c struct {
		Hash string `json:"hash"`
	}
	if _, err := bitbucketAPI(token).do(ctx, http.MethodGet, bitbucketRepoPath(pr.sourceRepo(t))+"/commit/"+url.PathEscape(short), nil, &c); err == nil && strings.HasPrefix(c.Hash, short) {
		return c.Hash
	}
	return short
}

func (b *bitbucket) FetchPR(ctx context.Context, t PRTarget, token string) (PRMeta, error) {
	pr, err := b.fetchPR(ctx, t, token)
	if err != nil {
		return PRMeta{}, err
	}
	m := PRMeta{
		Number: pr.ID, Title: pr.Title, Author: pr.Author.name(),
		State: "open", Merged: pr.State == "MERGED", Draft: pr.Draft,
		BaseRef: pr.Destination.Branch.Name, HeadRef: pr.Source.Branch.Name,
		HeadSHA: b.headSHA(ctx, t, token, pr),
	}
	if pr.State != "OPEN" {
		m.State = "closed"
	}
	if m.Merged {
		m.MergedAt = pr.UpdatedOn
	}
	src := pr.sourceRepo(t)
	m.HeadIsFork = !strings.EqualFold(src, t.Owner+"/"+t.Repo)
	m.HeadRepoCloneURL = "https://bitbucket.org/" + src + ".git"
	return m, nil
}

// CheckPushAccess asks for the user's permission on the repository. That
// endpoint needs a user (API token); an access token can't ask, and this
// fails closed like every provider's check.
func (b *bitbucket) CheckPushAccess(ctx context.Context, t PRTarget, token string) bool {
	if token == "" {
		return false
	}
	q := url.QueryEscape(fmt.Sprintf(`repository.full_name="%s/%s"`, t.Owner, t.Repo))
	var out struct {
		Values []struct {
			Permission string `json:"permission"`
		} `json:"values"`
	}
	if _, err := bitbucketAPI(token).do(ctx, http.MethodGet, "/user/permissions/repositories?q="+q, nil, &out); err != nil {
		return false
	}
	for _, v := range out.Values {
		if v.Permission == "write" || v.Permission == "admin" {
			return true
		}
	}
	return false
}

type bbComment struct {
	ID      int64 `json:"id"`
	Deleted bool  `json:"deleted"`
	Content struct {
		Raw string `json:"raw"`
	} `json:"content"`
	User      bbUser `json:"user"`
	CreatedOn string `json:"created_on"`
	Inline    *struct {
		Path string `json:"path"`
		From *int   `json:"from"`
		To   *int   `json:"to"`
	} `json:"inline"`
	Parent *struct {
		ID int64 `json:"id"`
	} `json:"parent"`
	Links struct {
		HTML struct {
			Href string `json:"href"`
		} `json:"html"`
	} `json:"links"`
}

func (c bbComment) toPRComment() PRComment {
	pc := PRComment{
		ID: c.ID, Kind: "issue", Author: c.User.name(), AvatarURL: c.User.Links.Avatar.Href,
		Body: c.Content.Raw, CreatedAt: c.CreatedOn, URL: c.Links.HTML.Href,
	}
	if in := c.Inline; in != nil {
		pc.Kind, pc.Path = "review", in.Path
		switch {
		case in.To != nil:
			pc.Line, pc.Side = *in.To, "RIGHT"
		case in.From != nil:
			pc.Line, pc.Side = *in.From, "LEFT"
		}
	}
	return pc
}

func bbInline(path string, line int, side string) map[string]any {
	in := map[string]any{"path": path}
	if side == "LEFT" {
		in["from"] = line
	} else {
		in["to"] = line
	}
	return in
}

func (b *bitbucket) postComment(ctx context.Context, t PRTarget, token string, payload map[string]any) (bbComment, error) {
	var c bbComment
	_, err := bitbucketAPI(token).do(ctx, http.MethodPost, bitbucketPRPath(t)+"/comments", payload, &c)
	return c, err
}

// SubmitReview posts each draft as an inline comment and the body as a
// general one, then records the verdict: Bitbucket has both an approval and
// a "request changes" state of its own.
func (b *bitbucket) SubmitReview(ctx context.Context, t PRTarget, token, headSHA string, comments []DraftComment, event, body string) error {
	for _, c := range comments {
		if _, err := b.postComment(ctx, t, token, map[string]any{"content": map[string]string{"raw": c.Body}, "inline": bbInline(c.Path, c.Line, c.Side)}); err != nil {
			return err
		}
	}
	if strings.TrimSpace(body) != "" {
		if _, err := b.postComment(ctx, t, token, map[string]any{"content": map[string]string{"raw": body}}); err != nil {
			return err
		}
	}
	verdict := map[string]string{"APPROVE": "/approve", "REQUEST_CHANGES": "/request-changes"}[event]
	if verdict == "" {
		return nil
	}
	_, err := bitbucketAPI(token).do(ctx, http.MethodPost, bitbucketPRPath(t)+verdict, nil, nil)
	return err
}

// bitbucketPages follows a paginated list's "next" links.
func bitbucketPages[T any](ctx context.Context, a api, path string) ([]T, error) {
	var all []T
	for next, n := path, 0; next != "" && n < 100; n++ {
		var page struct {
			Values []T    `json:"values"`
			Next   string `json:"next"`
		}
		if _, err := a.do(ctx, http.MethodGet, next, nil, &page); err != nil {
			return nil, err
		}
		all = append(all, page.Values...)
		next = page.Next
	}
	return all, nil
}

// FetchComments splits inline comments (review threads, replies pointed at
// the thread's first comment) from general ones. Bitbucket threads general
// comments too; faah shows those flat.
func (b *bitbucket) FetchComments(ctx context.Context, t PRTarget, token string) (issue, review []PRComment, err error) {
	cs, err := bitbucketPages[bbComment](ctx, bitbucketAPI(token), bitbucketPRPath(t)+"/comments?pagelen=100")
	if err != nil {
		return nil, nil, err
	}
	parent := map[int64]int64{}
	byID := map[int64]bbComment{}
	for _, c := range cs {
		byID[c.ID] = c
		if c.Parent != nil {
			parent[c.ID] = c.Parent.ID
		}
	}
	root := func(id int64) int64 {
		for i := 0; i < 1000; i++ { // a cycle can't happen, but never spin on one
			p, ok := parent[id]
			if !ok {
				break
			}
			id = p
		}
		return id
	}
	issue, review = []PRComment{}, []PRComment{}
	for _, c := range cs {
		if c.Deleted {
			continue
		}
		r := byID[root(c.ID)]
		pc := c.toPRComment()
		if r.Inline == nil {
			pc.Kind = "issue"
			issue = append(issue, pc)
			continue
		}
		rc := r.toPRComment()
		pc.Kind, pc.Path, pc.Line, pc.Side = "review", rc.Path, rc.Line, rc.Side
		if r.ID != c.ID {
			pc.InReplyTo = r.ID
		}
		review = append(review, pc)
	}
	return issue, review, nil
}

func (b *bitbucket) PostIssueComment(ctx context.Context, t PRTarget, token, body string) (PRComment, error) {
	c, err := b.postComment(ctx, t, token, map[string]any{"content": map[string]string{"raw": body}})
	if err != nil {
		return PRComment{}, err
	}
	pc := c.toPRComment()
	pc.Kind = "issue"
	return pc, nil
}

// ReplyToReviewComment uses Bitbucket's own threading: a comment with a parent.
func (b *bitbucket) ReplyToReviewComment(ctx context.Context, t PRTarget, token string, commentID int64, body string) (PRComment, error) {
	_, review, err := b.FetchComments(ctx, t, token)
	if err != nil {
		return PRComment{}, err
	}
	for _, rc := range review {
		if rc.ID != commentID {
			continue
		}
		c, err := b.postComment(ctx, t, token, map[string]any{"content": map[string]string{"raw": body}, "parent": map[string]int64{"id": commentID}})
		if err != nil {
			return PRComment{}, err
		}
		pc := c.toPRComment()
		root := rc.ID
		if rc.InReplyTo != 0 {
			root = rc.InReplyTo
		}
		pc.Kind, pc.Path, pc.Line, pc.Side, pc.InReplyTo = "review", rc.Path, rc.Line, rc.Side, root
		return pc, nil
	}
	return PRComment{}, fmt.Errorf("bitbucket: comment %d not found on pull request #%d", commentID, t.Number)
}

// bitbucketStrategies maps faah's merge methods onto Bitbucket's strategies,
// most faithful first. A rebase merge is "rebase_fast_forward" where the
// branch allows it, else a plain fast-forward.
var bitbucketStrategies = map[string][]string{
	MergeMethodMerge:  {"merge_commit", "rebase_merge"},
	MergeMethodSquash: {"squash", "squash_fast_forward"},
	MergeMethodRebase: {"rebase_fast_forward", "fast_forward"},
}

// bitbucketDefaultStrategies are what a branch allows when Bitbucket doesn't
// say: the three it has always offered.
var bitbucketDefaultStrategies = []string{"merge_commit", "squash", "fast_forward"}

func bitbucketStrategy(method string, allowed []string) string {
	for _, s := range bitbucketStrategies[method] {
		for _, a := range allowed {
			if a == s {
				return s
			}
		}
	}
	return ""
}

// allowedStrategies reads the merge strategies the destination branch allows.
func (b *bitbucket) allowedStrategies(ctx context.Context, t PRTarget, token, branch string) []string {
	var br struct {
		MergeStrategies []string `json:"merge_strategies"`
	}
	path := bitbucketRepoPath(t.Owner+"/"+t.Repo) + "/refs/branches/" + url.PathEscape(branch)
	if _, err := bitbucketAPI(token).do(ctx, http.MethodGet, path, nil, &br); err != nil || len(br.MergeStrategies) == 0 {
		return bitbucketDefaultStrategies
	}
	return br.MergeStrategies
}

// hasConflicts reports whether the PR's diffstat lists any file in conflict.
func (b *bitbucket) hasConflicts(ctx context.Context, t PRTarget, token string) (bool, error) {
	entries, err := bitbucketPages[struct {
		Status string `json:"status"`
	}](ctx, bitbucketAPI(token), bitbucketPRPath(t)+"/diffstat?pagelen=500")
	if err != nil {
		return false, err
	}
	for _, e := range entries {
		if strings.Contains(e.Status, "conflict") {
			return true, nil
		}
	}
	return false, nil
}

func (b *bitbucket) MergeStatus(ctx context.Context, t PRTarget, token string) (PRMergeStatus, error) {
	pr, err := b.fetchPR(ctx, t, token)
	if err != nil {
		return PRMergeStatus{}, err
	}
	st := PRMergeStatus{HeadSHA: b.headSHA(ctx, t, token, pr), Methods: []string{}}
	switch {
	case pr.State == "MERGED":
		st.State = mergeStateMerged
	case pr.State != "OPEN":
		st.State = mergeStateClosed
	case pr.Draft:
		st.State, st.Reason = mergeStateDraft, "this pull request is still a draft"
	default:
		conflicts, err := b.hasConflicts(ctx, t, token)
		switch {
		case err != nil:
			st.State = mergeStateUnknown
		case conflicts:
			st.State, st.Reason = mergeStateConflicts, "this branch has conflicts with "+pr.Destination.Branch.Name
		default:
			st.State = mergeStateClean
		}
	}
	if token == "" {
		return st, nil
	}
	allowed := b.allowedStrategies(ctx, t, token, pr.Destination.Branch.Name)
	for _, m := range []string{MergeMethodMerge, MergeMethodSquash, MergeMethodRebase} {
		if bitbucketStrategy(m, allowed) != "" {
			st.Methods = append(st.Methods, m)
		}
	}
	st.CanMerge = b.CheckPushAccess(ctx, t, token)
	return st, nil
}

// Merge merges with the strategy the branch allows for req.Method. Bitbucket
// takes no head-commit guard, so the head is checked here first; the window
// between the two calls is the only one left.
func (b *bitbucket) Merge(ctx context.Context, t PRTarget, token string, req PRMergeRequest) (PRMergeResult, error) {
	pr, err := b.fetchPR(ctx, t, token)
	if err != nil {
		return PRMergeResult{}, err
	}
	if req.HeadSHA != "" {
		if head := b.headSHA(ctx, t, token, pr); head != "" && !strings.HasPrefix(req.HeadSHA, head) && !strings.HasPrefix(head, req.HeadSHA) {
			return PRMergeResult{}, fmt.Errorf("bitbucket: %w: head is %s, reviewed %s", ErrPRHeadMoved, head, req.HeadSHA)
		}
	}
	strategy := bitbucketStrategy(req.Method, b.allowedStrategies(ctx, t, token, pr.Destination.Branch.Name))
	if strategy == "" {
		return PRMergeResult{}, fmt.Errorf("bitbucket: %w: %s is not allowed on %s", ErrPRNotMergeable, req.Method, pr.Destination.Branch.Name)
	}
	payload := map[string]any{"merge_strategy": strategy, "close_source_branch": false}
	msg := strings.TrimSpace(req.Title)
	if body := strings.TrimSpace(req.Message); body != "" && msg != "" {
		msg += "\n\n" + body
	}
	if msg != "" && req.Method != MergeMethodRebase {
		payload["message"] = msg
	}
	var out bbPR
	code, err := bitbucketAPI(token).do(ctx, http.MethodPost, bitbucketPRPath(t)+"/merge", payload, &out)
	if err != nil {
		if code == http.StatusBadRequest || code == http.StatusConflict {
			return PRMergeResult{}, fmt.Errorf("%w: %v", ErrPRNotMergeable, err)
		}
		return PRMergeResult{}, err
	}
	// 202: Bitbucket is still merging in the background; the bar's next
	// refresh shows the result.
	res := PRMergeResult{}
	if code == http.StatusAccepted {
		res.Message = "Bitbucket is completing the merge"
	}
	if out.MergeCommit != nil {
		res.SHA = out.MergeCommit.Hash
	}
	return res, nil
}
