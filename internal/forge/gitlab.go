package forge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"faah/internal/git"
)

// gitlabAPIBase is the API root for a host; a variable so tests can point it
// at a fake server.
var gitlabAPIBase = func(host string) string { return "https://" + host + "/api/v4" }

// https://gitlab.com/group/sub/project/-/merge_requests/12: the /-/ path
// segment is GitLab's own, so any host using it is taken to be GitLab.
var gitlabMRURLRe = regexp.MustCompile(`^(?:https?://)?([^/\s]+)/(.+)/([^/\s]+?)/-/merge_requests/(\d+)`)

// gitlab implements Provider for GitLab.
type gitlab struct{}

func (g *gitlab) Name() string { return "gitlab" }

func (g *gitlab) Info() Info {
	return Info{
		Name: "gitlab", Label: "GitLab", TokenKey: "gitlab.token", TokenCategory: "GitLab",
		TokenHint: "set GITLAB_TOKEN or run `glab auth login`",
	}
}

func (g *gitlab) TokenSetup(host string) TokenSetup {
	if host == "" {
		host = "gitlab.com"
	}
	return TokenSetup{
		URL: "https://" + host + "/-/user_settings/personal_access_tokens",
		Steps: []string{
			"Select Add new token, name it (e.g. faah) and pick an expiration date.",
			"Under Select scopes, check api.",
			"Create the token and copy it.",
		},
		CLI:      "glab auth login",
		Env:      "GITLAB_TOKEN",
		HostKey:  "gitlab.host",
		Readonly: "Public projects open and diff without a token; posting comments, approving, pushing and merging need one.",
	}
}

func (g *gitlab) MatchURL(rawURL string) bool {
	return gitlabMRURLRe.MatchString(strings.TrimSpace(rawURL))
}

func (g *gitlab) ParseURL(rawURL string) (PRTarget, error) {
	m := gitlabMRURLRe.FindStringSubmatch(strings.TrimSpace(rawURL))
	if m == nil {
		return PRTarget{}, fmt.Errorf("invalid GitLab merge request URL: %q (expected format https://gitlab.com/group/project/-/merge_requests/12)", rawURL)
	}
	n, _ := strconv.Atoi(m[4])
	return PRTarget{
		Provider: "gitlab",
		Host:     strings.ToLower(m[1]),
		Owner:    m[2],
		Repo:     strings.TrimSuffix(m[3], ".git"),
		Number:   n,
		URL:      rawURL,
	}, nil
}

func (g *gitlab) MatchRemote(remoteURL string) bool {
	host := RemoteHost(remoteURL)
	return host != "" && (host == gitlabTokenHost() || strings.Contains(host, "gitlab"))
}

func (g *gitlab) CloneURL(target PRTarget) string {
	return fmt.Sprintf("https://%s/%s/%s.git", target.Host, target.Owner, target.Repo)
}

func (g *gitlab) PRHeadRef(target PRTarget) string {
	return fmt.Sprintf("refs/merge-requests/%d/head", target.Number)
}

// GitLab takes any username with a token as the password; "oauth2" is the
// one it documents, and it works for personal access tokens too.
func (g *gitlab) GitAuth(target PRTarget, token string) git.Auth {
	return basicGitAuth(target.Host, "oauth2", token)
}

// gitlabProject is the project path as the API addresses it.
func gitlabProject(t PRTarget) string { return url.PathEscape(t.Owner + "/" + t.Repo) }

func gitlabMRPath(t PRTarget) string {
	return fmt.Sprintf("/projects/%s/merge_requests/%d", gitlabProject(t), t.Number)
}

func gitlabAPI(t PRTarget, token string) api {
	a := api{name: "gitlab", base: gitlabAPIBase(t.Host), message: gitlabMessage}
	if token != "" {
		// Bearer covers both personal access tokens and glab's OAuth tokens.
		a.auth = "Bearer " + token
	}
	return a
}

// gitlabDo runs one request and decodes a 2xx reply into out (if non-nil).
// Anything else becomes an error carrying GitLab's message.
func gitlabDo(ctx context.Context, method string, t PRTarget, path, token string, body, out any) (int, error) {
	return gitlabAPI(t, token).do(ctx, method, path, body, out)
}

// gitlabMessage pulls the human-readable part out of an error body, whose
// "message" may be a string, a list, or a map of field errors.
func gitlabMessage(b []byte) string {
	var e struct {
		Message any    `json:"message"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(b, &e) == nil {
		switch m := e.Message.(type) {
		case string:
			return m
		case nil:
			if e.Error != "" {
				return e.Error
			}
		default:
			if j, err := json.Marshal(m); err == nil {
				return string(j)
			}
		}
	}
	return strings.TrimSpace(string(b))
}

// glMR is the subset of a merge request faah reads.
type glMR struct {
	IID                 int    `json:"iid"`
	Title               string `json:"title"`
	State               string `json:"state"` // opened, closed, locked, merged
	MergedAt            string `json:"merged_at"`
	Draft               bool   `json:"draft"`
	WorkInProgress      bool   `json:"work_in_progress"` // pre-15.x name for draft
	SHA                 string `json:"sha"`
	SourceBranch        string `json:"source_branch"`
	TargetBranch        string `json:"target_branch"`
	SourceProjectID     int64  `json:"source_project_id"`
	TargetProjectID     int64  `json:"target_project_id"`
	DetailedMergeStatus string `json:"detailed_merge_status"`
	MergeStatus         string `json:"merge_status"`
	HasConflicts        bool   `json:"has_conflicts"`
	WebURL              string `json:"web_url"`
	Author              struct {
		Username string `json:"username"`
	} `json:"author"`
	User struct {
		CanMerge bool `json:"can_merge"`
	} `json:"user"`
	DiffRefs struct {
		BaseSHA  string `json:"base_sha"`
		HeadSHA  string `json:"head_sha"`
		StartSHA string `json:"start_sha"`
	} `json:"diff_refs"`
}

func (g *gitlab) fetchMR(ctx context.Context, t PRTarget, token string) (glMR, error) {
	var mr glMR
	code, err := gitlabDo(ctx, http.MethodGet, t, gitlabMRPath(t), token, nil, &mr)
	if err != nil && token == "" && (code == http.StatusNotFound || code == http.StatusUnauthorized || code == http.StatusForbidden) {
		return mr, fmt.Errorf("%w (no GitLab token found; for private projects, %s)", err, g.Info().TokenHint)
	}
	return mr, err
}

func (g *gitlab) FetchPR(ctx context.Context, t PRTarget, token string) (PRMeta, error) {
	mr, err := g.fetchMR(ctx, t, token)
	if err != nil {
		return PRMeta{}, err
	}
	m := PRMeta{
		Number:   mr.IID,
		Title:    mr.Title,
		Author:   mr.Author.Username,
		State:    "open",
		Merged:   mr.State == "merged",
		MergedAt: mr.MergedAt,
		Draft:    mr.Draft || mr.WorkInProgress,
		BaseRef:  mr.TargetBranch,
		HeadRef:  mr.SourceBranch,
		HeadSHA:  mr.SHA,
	}
	if mr.State != "opened" {
		m.State = "closed"
	}
	// A fork's commits live in its own project; faah pushes there.
	if mr.SourceProjectID != 0 && mr.SourceProjectID != mr.TargetProjectID {
		m.HeadIsFork = true
		var src struct {
			HTTPURL string `json:"http_url_to_repo"`
		}
		if _, err := gitlabDo(ctx, http.MethodGet, t, fmt.Sprintf("/projects/%d", mr.SourceProjectID), token, nil, &src); err == nil {
			m.HeadRepoCloneURL = src.HTTPURL
		}
	}
	if m.HeadRepoCloneURL == "" {
		m.HeadRepoCloneURL = g.CloneURL(t)
	}
	return m, nil
}

type glProject struct {
	MergeMethod  string `json:"merge_method"`  // merge, rebase_merge, ff
	SquashOption string `json:"squash_option"` // never, always, default_on, default_off
	Permissions  struct {
		ProjectAccess *struct {
			AccessLevel int `json:"access_level"`
		} `json:"project_access"`
		GroupAccess *struct {
			AccessLevel int `json:"access_level"`
		} `json:"group_access"`
	} `json:"permissions"`
}

// gitlabDeveloper is GitLab's Developer access level: enough to push to the
// project, approve, and (branch protection permitting) merge.
const gitlabDeveloper = 30

// CheckPushAccess fails closed, like checkPushAccess for GitHub.
func (g *gitlab) CheckPushAccess(ctx context.Context, t PRTarget, token string) bool {
	if token == "" {
		return false
	}
	var p glProject
	if _, err := gitlabDo(ctx, http.MethodGet, t, "/projects/"+gitlabProject(t), token, nil, &p); err != nil {
		return false
	}
	level := 0
	if a := p.Permissions.ProjectAccess; a != nil && a.AccessLevel > level {
		level = a.AccessLevel
	}
	if a := p.Permissions.GroupAccess; a != nil && a.AccessLevel > level {
		level = a.AccessLevel
	}
	return level >= gitlabDeveloper
}

// SubmitReview maps faah's one-shot review onto GitLab's separate calls: each
// draft becomes a diff discussion (or, where GitLab can't anchor it -- an
// unchanged context line needs both old and new line numbers, which faah's
// drafts don't carry -- a note naming path:line), the body a note, and the
// verdict an approval or, for REQUEST_CHANGES, a withdrawn approval.
func (g *gitlab) SubmitReview(ctx context.Context, t PRTarget, token, headSHA string, comments []DraftComment, event, body string) error {
	if len(comments) > 0 {
		mr, err := g.fetchMR(ctx, t, token)
		if err != nil {
			return err
		}
		for _, c := range comments {
			pos := map[string]any{
				"position_type": "text",
				"base_sha":      mr.DiffRefs.BaseSHA,
				"start_sha":     mr.DiffRefs.StartSHA,
				"head_sha":      mr.DiffRefs.HeadSHA,
				"old_path":      c.Path,
				"new_path":      c.Path,
			}
			if c.Side == "LEFT" {
				pos["old_line"] = c.Line
			} else {
				pos["new_line"] = c.Line
			}
			_, err := gitlabDo(ctx, http.MethodPost, t, gitlabMRPath(t)+"/discussions", token, map[string]any{"body": c.Body, "position": pos}, nil)
			if err != nil {
				loc := fmt.Sprintf("`%s:%d`", c.Path, c.Line)
				if c.Side == "LEFT" {
					loc += " (base)"
				}
				if _, err := gitlabDo(ctx, http.MethodPost, t, gitlabMRPath(t)+"/notes", token, map[string]string{"body": loc + "\n\n" + c.Body}, nil); err != nil {
					return err
				}
			}
		}
	}
	note := strings.TrimSpace(body)
	if event == "REQUEST_CHANGES" {
		note = strings.TrimSpace("**Changes requested**\n\n" + note)
	}
	if note != "" {
		if _, err := gitlabDo(ctx, http.MethodPost, t, gitlabMRPath(t)+"/notes", token, map[string]string{"body": note}, nil); err != nil {
			return err
		}
	}
	switch event {
	case "APPROVE":
		payload := map[string]string{}
		if headSHA != "" {
			payload["sha"] = headSHA // GitLab refuses if the MR moved past what was reviewed
		}
		if code, err := gitlabDo(ctx, http.MethodPost, t, gitlabMRPath(t)+"/approve", token, payload, nil); err != nil {
			if code == http.StatusUnauthorized {
				return fmt.Errorf("gitlab: you can't approve this merge request (already approved, or not an eligible approver): %w", err)
			}
			return err
		}
	case "REQUEST_CHANGES":
		// Withdraw an earlier approval so the verdict isn't contradicted.
		// Not having approved is the common case and not an error.
		gitlabDo(ctx, http.MethodPost, t, gitlabMRPath(t)+"/unapprove", token, nil, nil)
	}
	return nil
}

type glNote struct {
	ID        int64  `json:"id"`
	Body      string `json:"body"`
	System    bool   `json:"system"`
	CreatedAt string `json:"created_at"`
	Author    struct {
		Username  string `json:"username"`
		AvatarURL string `json:"avatar_url"`
	} `json:"author"`
	Position *struct {
		PositionType string `json:"position_type"`
		NewPath      string `json:"new_path"`
		OldPath      string `json:"old_path"`
		NewLine      int    `json:"new_line"`
		OldLine      int    `json:"old_line"`
	} `json:"position"`
}

type glDiscussion struct {
	ID    string   `json:"id"`
	Notes []glNote `json:"notes"`
}

func (n glNote) toPRComment(kind, mrURL string) PRComment {
	c := PRComment{
		ID: n.ID, Kind: kind, Author: n.Author.Username, AvatarURL: n.Author.AvatarURL,
		Body: n.Body, CreatedAt: n.CreatedAt,
	}
	if mrURL != "" {
		c.URL = fmt.Sprintf("%s#note_%d", mrURL, n.ID)
	}
	if p := n.Position; p != nil {
		c.Path, c.Line, c.Side = p.NewPath, p.NewLine, "RIGHT"
		if p.NewLine == 0 {
			c.Path, c.Line, c.Side = p.OldPath, p.OldLine, "LEFT"
		}
	}
	return c
}

func (g *gitlab) discussions(ctx context.Context, t PRTarget, token string) ([]glDiscussion, error) {
	raw, err := gitlabAPI(t, token).linkPages(ctx, gitlabMRPath(t)+"/discussions?per_page=100")
	if err != nil {
		return nil, err
	}
	out := make([]glDiscussion, 0, len(raw))
	for _, r := range raw {
		var d glDiscussion
		if json.Unmarshal(r, &d) == nil {
			out = append(out, d)
		}
	}
	return out, nil
}

// FetchComments flattens discussions: one anchored to a diff line is a
// review thread (its replies point at the first note), anything else --
// including a threaded general discussion, which faah shows flat -- is a list
// of top-level comments. GitLab's system notes ("added 2 commits") are skipped.
func (g *gitlab) FetchComments(ctx context.Context, t PRTarget, token string) (issue, review []PRComment, err error) {
	ds, err := g.discussions(ctx, t, token)
	if err != nil {
		return nil, nil, err
	}
	mrURL := strings.TrimSuffix(t.URL, "/")
	if i := strings.Index(mrURL, "/-/merge_requests/"); i >= 0 {
		mrURL = fmt.Sprintf("%s/-/merge_requests/%d", mrURL[:i], t.Number)
	}
	issue, review = []PRComment{}, []PRComment{}
	for _, d := range ds {
		var notes []glNote
		for _, n := range d.Notes {
			if !n.System {
				notes = append(notes, n)
			}
		}
		if len(notes) == 0 {
			continue
		}
		if notes[0].Position == nil || notes[0].Position.PositionType != "text" {
			for _, n := range notes {
				issue = append(issue, n.toPRComment("issue", mrURL))
			}
			continue
		}
		root := notes[0].toPRComment("review", mrURL)
		review = append(review, root)
		for _, n := range notes[1:] {
			c := n.toPRComment("review", mrURL)
			c.Path, c.Line, c.Side, c.InReplyTo = root.Path, root.Line, root.Side, root.ID
			review = append(review, c)
		}
	}
	return issue, review, nil
}

func (g *gitlab) PostIssueComment(ctx context.Context, t PRTarget, token, body string) (PRComment, error) {
	var n glNote
	if _, err := gitlabDo(ctx, http.MethodPost, t, gitlabMRPath(t)+"/notes", token, map[string]string{"body": body}, &n); err != nil {
		return PRComment{}, err
	}
	return n.toPRComment("issue", ""), nil
}

// ReplyToReviewComment replies within the discussion the note belongs to.
// GitLab addresses replies by discussion, not note, so the discussion is
// looked up first.
func (g *gitlab) ReplyToReviewComment(ctx context.Context, t PRTarget, token string, commentID int64, body string) (PRComment, error) {
	ds, err := g.discussions(ctx, t, token)
	if err != nil {
		return PRComment{}, err
	}
	for _, d := range ds {
		for _, n := range d.Notes {
			if n.ID != commentID {
				continue
			}
			root := d.Notes[0].toPRComment("review", "")
			var reply glNote
			if _, err := gitlabDo(ctx, http.MethodPost, t, gitlabMRPath(t)+"/discussions/"+url.PathEscape(d.ID)+"/notes", token, map[string]string{"body": body}, &reply); err != nil {
				return PRComment{}, err
			}
			c := reply.toPRComment("review", "")
			c.Path, c.Line, c.Side, c.InReplyTo = root.Path, root.Line, root.Side, root.ID
			return c, nil
		}
	}
	return PRComment{}, fmt.Errorf("gitlab: comment %d not found on merge request !%d", commentID, t.Number)
}

// gitlabMergeState maps GitLab's detailed_merge_status (15.6+), or the older
// merge_status/has_conflicts pair, onto the forge-neutral mergeState* values.
func gitlabMergeState(mr glMR) (string, string) {
	switch {
	case mr.State == "merged":
		return mergeStateMerged, ""
	case mr.State != "opened":
		return mergeStateClosed, ""
	case mr.Draft || mr.WorkInProgress:
		return mergeStateDraft, "this merge request is still a draft"
	}
	base := mr.TargetBranch
	switch mr.DetailedMergeStatus {
	case "mergeable":
		return mergeStateClean, ""
	case "conflict":
		return mergeStateConflicts, "this branch has conflicts with " + base
	case "need_rebase":
		return mergeStateBehind, "the project requires this branch to be rebased onto " + base
	case "draft_status":
		return mergeStateDraft, "this merge request is still a draft"
	case "checking", "unchecked", "preparing", "approvals_syncing":
		return mergeStateUnknown, ""
	case "not_open":
		return mergeStateClosed, ""
	case "ci_must_pass":
		return mergeStateBlocked, "the pipeline must succeed first"
	case "ci_still_running":
		return mergeStateBlocked, "the pipeline is still running"
	case "not_approved":
		return mergeStateBlocked, "required approvals are missing"
	case "discussions_not_resolved":
		return mergeStateBlocked, "all threads must be resolved first"
	case "requested_changes":
		return mergeStateBlocked, "a reviewer requested changes"
	case "blocked_status":
		return mergeStateBlocked, "blocked by another merge request"
	case "":
		// Older GitLab: fall back to merge_status below.
	default:
		return mergeStateBlocked, strings.ReplaceAll(mr.DetailedMergeStatus, "_", " ")
	}
	switch {
	case mr.HasConflicts, mr.MergeStatus == "cannot_be_merged", mr.MergeStatus == "cannot_be_merged_recheck":
		return mergeStateConflicts, "this branch has conflicts with " + base
	case mr.MergeStatus == "can_be_merged":
		return mergeStateClean, ""
	}
	return mergeStateUnknown, ""
}

// gitlabMergeMethods derives the methods a merge can use from the project's
// merge method (merge commit, semi-linear merge commit, or fast-forward)
// and squash setting. Fast-forward is offered as MergeMethodRebase: the
// branch's commits land as they are, with no merge commit -- though unlike
// GitHub, GitLab won't rebase them itself (that is "need_rebase", which the
// UI turns into Update branch).
func gitlabMergeMethods(p glProject) []string {
	plain := MergeMethodMerge
	if p.MergeMethod == "ff" {
		plain = MergeMethodRebase
	}
	methods := []string{}
	if p.SquashOption != "always" && plain == MergeMethodMerge {
		methods = append(methods, MergeMethodMerge)
	}
	if p.SquashOption != "never" {
		methods = append(methods, MergeMethodSquash)
	}
	if p.SquashOption != "always" && plain == MergeMethodRebase {
		methods = append(methods, MergeMethodRebase)
	}
	return methods
}

func (g *gitlab) MergeStatus(ctx context.Context, t PRTarget, token string) (PRMergeStatus, error) {
	mr, err := g.fetchMR(ctx, t, token)
	if err != nil {
		return PRMergeStatus{}, err
	}
	st := PRMergeStatus{HeadSHA: mr.SHA, Methods: []string{}, CanMerge: mr.User.CanMerge}
	st.State, st.Reason = gitlabMergeState(mr)
	if token == "" {
		return st, nil
	}
	var p glProject
	if _, err := gitlabDo(ctx, http.MethodGet, t, "/projects/"+gitlabProject(t), token, nil, &p); err == nil {
		st.Methods = gitlabMergeMethods(p)
	}
	return st, nil
}

// Merge accepts the merge request. GitLab takes one commit message, so the
// title and body are joined; with squash, the merge commit (if the project
// makes one) keeps GitLab's own default message.
func (g *gitlab) Merge(ctx context.Context, t PRTarget, token string, req PRMergeRequest) (PRMergeResult, error) {
	payload := map[string]any{"squash": req.Method == MergeMethodSquash}
	if req.HeadSHA != "" {
		payload["sha"] = req.HeadSHA
	}
	msg := strings.TrimSpace(req.Title)
	if b := strings.TrimSpace(req.Message); b != "" && msg != "" {
		msg += "\n\n" + b
	}
	if msg != "" {
		switch req.Method {
		case MergeMethodSquash:
			payload["squash_commit_message"] = msg
		case MergeMethodMerge:
			payload["merge_commit_message"] = msg
		}
	}
	var out struct {
		MergeCommitSHA  string `json:"merge_commit_sha"`
		SquashCommitSHA string `json:"squash_commit_sha"`
		SHA             string `json:"sha"`
	}
	code, err := gitlabDo(ctx, http.MethodPut, t, gitlabMRPath(t)+"/merge", token, payload, &out)
	if err != nil {
		switch code {
		case http.StatusConflict:
			return PRMergeResult{}, fmt.Errorf("%w: %v", ErrPRHeadMoved, err)
		case http.StatusMethodNotAllowed, http.StatusNotAcceptable, http.StatusUnprocessableEntity:
			return PRMergeResult{}, fmt.Errorf("%w: %v", ErrPRNotMergeable, err)
		}
		return PRMergeResult{}, err
	}
	sha := out.MergeCommitSHA
	if sha == "" {
		sha = out.SquashCommitSHA
	}
	if sha == "" {
		sha = out.SHA // fast-forward: the head itself
	}
	return PRMergeResult{SHA: sha}, nil
}
