package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"faah/internal/forge"
	"faah/internal/git"
	"faah/internal/httpx"
	"faah/internal/render"
	"faah/internal/session"
	"faah/internal/settings"
	"faah/internal/threads"
)

func (s *Server) prOrFail(w http.ResponseWriter) bool {
	if s.pr == nil {
		httpx.Fail(w, http.StatusNotFound, "not a PR review session")
		return false
	}
	return true
}

func (s *Server) handlePRMeta(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	httpx.WriteJSON(w, s.pr.MetaMap(s.ix.PRFiles()))
}

// handlePRExistingComments fetches every comment already posted on the PR
// (top-level and inline) directly from the forge -- always live, never
// cached, since another reviewer may have commented since the page loaded.
func (s *Server) handlePRExistingComments(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	p := s.pr
	provider, target, token := p.Credentials()
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	issue, review, err := provider.FetchComments(ctx, target, token)
	if err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	if issue == nil {
		issue = []forge.PRComment{}
	}
	if review == nil {
		review = []forge.PRComment{}
	}
	renderCommentBodies(issue)
	renderCommentBodies(review)
	httpx.WriteJSON(w, map[string]any{"issueComments": issue, "reviewComments": review})
}

// renderCommentBodies renders each body the way the forge shows it. Bots post
// raw HTML (<details>, <picture>), so the result is unsafe until the page
// sanitizes it, the same as a Markdown preview.
func renderCommentBodies(cs []forge.PRComment) {
	for i := range cs {
		if h, err := render.RenderMarkdown([]byte(cs[i].Body)); err == nil {
			cs[i].BodyHTML = h
		}
	}
}

// handlePRIssueCommentPost posts a new top-level PR comment immediately (not
// part of the draft-then-submit review flow below, since GitHub's issue
// comments aren't tied to a review). Used both for starting a new top-level
// comment and for "replying" to one, since GitHub doesn't thread these.
func (s *Server) handlePRIssueCommentPost(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	if !httpx.LocalPost(w, r) {
		return
	}
	p := s.pr
	provider, target, token := p.Credentials()
	if token == "" {
		httpx.Fail(w, http.StatusForbidden, "no auth token configured; posting comments requires a "+provider.Info().Label+" token")
		return
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil || strings.TrimSpace(body.Body) == "" {
		httpx.Fail(w, http.StatusBadRequest, "body is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	c, err := provider.PostIssueComment(ctx, target, token, strings.TrimSpace(body.Body))
	if err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	cs := []forge.PRComment{c}
	renderCommentBodies(cs)
	httpx.WriteJSON(w, cs[0])
}

// handlePRReviewCommentReply posts an immediate, threaded reply to an
// existing inline review comment (not a new draft: this bypasses the
// draft-then-submit review flow, matching GitHub's own dedicated reply
// endpoint, which posts right away).
func (s *Server) handlePRReviewCommentReply(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	if !httpx.LocalPost(w, r) {
		return
	}
	p := s.pr
	provider, target, token := p.Credentials()
	if token == "" {
		httpx.Fail(w, http.StatusForbidden, "no auth token configured; posting comments requires a "+provider.Info().Label+" token")
		return
	}
	var body struct {
		CommentID int64  `json:"commentId"`
		Body      string `json:"body"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil || body.CommentID <= 0 || strings.TrimSpace(body.Body) == "" {
		httpx.Fail(w, http.StatusBadRequest, "commentId and body are required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	c, err := provider.ReplyToReviewComment(ctx, target, token, body.CommentID, strings.TrimSpace(body.Body))
	if err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	cs := []forge.PRComment{c}
	renderCommentBodies(cs)
	httpx.WriteJSON(w, cs[0])
}

func (s *Server) handlePRComments(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	p := s.pr
	switch r.Method {
	case http.MethodGet:
		p.WithDrafts(func(drafts *[]forge.DraftComment, nextID *int64) {
			comments := *drafts
			if comments == nil {
				comments = []forge.DraftComment{}
			}
			httpx.WriteJSON(w, map[string]any{"comments": comments})
		})
	case http.MethodPost:
		if !httpx.LocalPost(w, r) {
			return
		}
		var body struct {
			Path string `json:"path"`
			Line int    `json:"line"`
			Side string `json:"side"`
			Body string `json:"body"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil ||
			body.Path == "" || body.Line <= 0 || strings.TrimSpace(body.Body) == "" {
			httpx.Fail(w, http.StatusBadRequest, "path, line, and body are required")
			return
		}
		side := strings.ToUpper(body.Side)
		if side != "LEFT" {
			side = "RIGHT"
		}
		c := p.AddComment(forge.DraftComment{Path: body.Path, Line: body.Line, Side: side, Body: strings.TrimSpace(body.Body)}, s.persistPRDrafts)
		httpx.WriteJSON(w, c)
	default:
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handlePRCommentDelete(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	if !httpx.LocalPost(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	p := s.pr
	p.DeleteComment(id, func(drafts []forge.DraftComment) {
		s.persistPRDrafts(drafts)
		httpx.WriteJSON(w, map[string]any{"ok": true})
	})
}

func (s *Server) handlePRSubmit(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	if !httpx.LocalPost(w, r) {
		return
	}
	p := s.pr
	provider, target, token := p.Credentials()
	if token == "" {
		httpx.Fail(w, http.StatusForbidden, "no auth token configured; review submission is read-only")
		return
	}
	var body struct {
		Event string `json:"event"`
		Body  string `json:"body"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil {
		httpx.Fail(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	event := strings.ToUpper(body.Event)
	if event != "APPROVE" && event != "REQUEST_CHANGES" && event != "COMMENT" {
		httpx.Fail(w, http.StatusBadRequest, "event must be APPROVE, REQUEST_CHANGES, or COMMENT")
		return
	}
	if (event == "APPROVE" || event == "REQUEST_CHANGES") && !p.Snapshot().WriteAccess {
		httpx.Fail(w, http.StatusForbidden, "no push access on this repository; only Comment reviews are allowed")
		return
	}
	var comments []forge.DraftComment
	p.WithDrafts(func(drafts *[]forge.DraftComment, nextID *int64) {
		comments = append([]forge.DraftComment(nil), (*drafts)...)
	})

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := provider.SubmitReview(ctx, target, token, p.Snapshot().Meta.HeadSHA, comments, event, body.Body); err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	p.ClearComments(s.persistPRDrafts)
	httpx.WriteJSON(w, map[string]any{"ok": true})
}

// prMergeMessage is a commit title and body, as prefilled in the merge dialog.
type prMergeMessage struct {
	Title   string `json:"title"`
	Message string `json:"message"`
}

// prMergeDefaults are the forge-neutral starting points the merge dialog
// prefills for each method that writes a commit: the conventions GitHub,
// GitLab and Gitea all default to. Rebase writes no commit of its own.
// commits is newest first, as git log lists them.
func prMergeDefaults(meta forge.PRMeta, commits []git.UnpushedCommit) map[string]prMergeMessage {
	var body strings.Builder
	for i := len(commits) - 1; i >= 0; i-- {
		fmt.Fprintf(&body, "* %s\n", commits[i].Subject)
	}
	return map[string]prMergeMessage{
		forge.MergeMethodMerge:  {Title: fmt.Sprintf("Merge pull request #%d from %s", meta.Number, meta.HeadRef), Message: meta.Title},
		forge.MergeMethodSquash: {Title: fmt.Sprintf("%s (#%d)", meta.Title, meta.Number), Message: strings.TrimSpace(body.String())},
	}
}

// prCommits lists the PR's own commits (merge-base..PR head), newest first.
func (s *Server) prCommits() []git.UnpushedCommit {
	p := s.pr
	snap := p.Snapshot()
	from, to := snap.DiffBase, snap.Meta.HeadSHA
	if !git.ValidSHA(from) || !git.ValidSHA(to) {
		return nil
	}
	return git.CommitsInRange(s.ix.Root(), from+".."+to, 200)
}

func validMergeMethod(m string) bool {
	return m == forge.MergeMethodMerge || m == forge.MergeMethodSquash || m == forge.MergeMethodRebase
}

// handlePRMergeStatus reports whether the PR can merge and how, plus what the
// merge dialog needs to prefill: per-method default messages and the PR's
// commits. Always live from the forge; mergeability changes under you.
func (s *Server) handlePRMergeStatus(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	p := s.pr
	provider, target, token := p.Credentials()
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	st, err := provider.MergeStatus(ctx, target, token)
	if err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	commits := s.prCommits()
	if commits == nil {
		commits = []git.UnpushedCommit{}
	}
	snap := p.Snapshot()
	meta, writeAccess := snap.Meta, p.Snapshot().WriteAccess
	root := s.ix.Root()
	hasInstruction := false
	if cfg := settings.Read(); cfg.GitCommitMessageInstruction != nil {
		hasInstruction = strings.TrimSpace(*cfg.GitCommitMessageInstruction) != ""
	}
	httpx.WriteJSON(w, map[string]any{
		"status":   st,
		"canMerge": st.CanMerge && writeAccess && token != "",
		// The forge holds commits this checkout hasn't seen: merging now
		// would land code nobody here reviewed. Pull first.
		"stale":          st.HeadSHA != "" && st.HeadSHA != meta.HeadSHA,
		"rewritten":      p.Rewritten(),
		"inProgress":     git.OpInProgress(root),
		"unpushed":       git.CountSince(root, meta.HeadSHA),
		"defaults":       prMergeDefaults(meta, commits),
		"commits":        commits,
		"base":           meta.BaseRef,
		"hasInstruction": hasInstruction,
	})
}

// handlePRMerge merges the PR on the forge, exactly as confirmed in the
// dialog. The forge is told the head the reviewer saw, so a PR that moved
// since is refused there rather than merged unseen.
func (s *Server) handlePRMerge(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	if !httpx.LocalPost(w, r) {
		return
	}
	p := s.pr
	provider, target, token := p.Credentials()
	if token == "" {
		httpx.Fail(w, http.StatusForbidden, "no auth token configured; merging requires a token")
		return
	}
	if !p.Snapshot().WriteAccess {
		httpx.Fail(w, http.StatusForbidden, "no push access on this repository; merging is not allowed")
		return
	}
	var body struct {
		Method  string `json:"method"`
		Title   string `json:"title"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil || !validMergeMethod(body.Method) {
		httpx.Fail(w, http.StatusBadRequest, "method must be merge, squash, or rebase")
		return
	}
	if op := git.OpInProgress(s.ix.Root()); op != "" {
		httpx.Fail(w, http.StatusConflict, "a "+op+" is in progress in this checkout; finish or abort it first")
		return
	}
	if p.Rewritten() {
		httpx.Fail(w, http.StatusConflict, "this checkout was rebased but not pushed; force-push it first, or the forge merges the old commits")
		return
	}
	snap := p.Snapshot()
	head := snap.Meta.HeadSHA
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res, err := provider.Merge(ctx, target, token, forge.PRMergeRequest{
		Method:  body.Method,
		Title:   strings.TrimSpace(body.Title),
		Message: strings.TrimSpace(body.Message),
		HeadSHA: head,
	})
	if err != nil {
		switch {
		case errors.Is(err, forge.ErrPRHeadMoved):
			httpx.Fail(w, http.StatusConflict, "the PR has new commits since this checkout; pull and review them, then merge")
		case errors.Is(err, forge.ErrPRNotMergeable):
			httpx.Fail(w, http.StatusConflict, err.Error())
		default:
			httpx.Fail(w, http.StatusBadGateway, err.Error())
		}
		return
	}
	// The bar flips to Merged from the forge's own account of it.
	if fresh, err := provider.FetchPR(ctx, target, token); err == nil {
		p.UpdateMergeState(&fresh)
	} else {
		p.UpdateMergeState(nil)
	}
	httpx.WriteJSON(w, map[string]any{"ok": true, "sha": res.SHA, "message": res.Message})
}

// handlePRMergeMessage has the harness write (or rewrite) the commit message
// a squash or merge commit lands with, from the PR's commits and diff, the
// user's commit message instructions in Settings, and any one-off
// instruction typed in the dialog. It only writes text: faah shows it in the
// dialog, where it can still be edited before anything is merged.
func (s *Server) handlePRMergeMessage(w http.ResponseWriter, r *http.Request) {
	if !s.prOrFail(w) {
		return
	}
	if !httpx.LocalPost(w, r) {
		return
	}
	if !s.agentOrFail(w) {
		return
	}
	var body struct {
		Method      string `json:"method"`
		Instruction string `json:"instruction"`
		Title       string `json:"title"`
		Message     string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil || (body.Method != forge.MergeMethodSquash && body.Method != forge.MergeMethodMerge) {
		httpx.Fail(w, http.StatusBadRequest, "method must be squash or merge")
		return
	}
	p := s.pr
	snap := p.Snapshot()
	meta, from := snap.Meta, snap.DiffBase
	if !git.ValidSHA(from) {
		httpx.Fail(w, http.StatusConflict, "the PR's merge base is unresolved, so there is no diff to describe")
		return
	}
	root := s.ix.Root()
	instructions := []string{}
	if cfg := settings.Read(); cfg.GitCommitMessageInstruction != nil {
		if t := strings.TrimSpace(*cfg.GitCommitMessageInstruction); t != "" {
			instructions = append(instructions, t)
		}
	}
	if t := strings.TrimSpace(body.Instruction); t != "" {
		instructions = append(instructions, t)
	}
	draft := strings.TrimSpace(strings.TrimSpace(body.Title) + "\n\n" + strings.TrimSpace(body.Message))
	prompt := threads.MergeMessagePrompt(body.Method, meta, s.prCommits(),
		git.RangeStat(root, from, meta.HeadSHA), git.RangeDiff(root, from, meta.HeadSHA), draft, instructions)
	job, err := s.agent.StartPrompt(body.Method+" message", prompt)
	if err != nil {
		code := http.StatusBadGateway
		if errors.Is(err, errAgentNone) {
			code = http.StatusBadRequest
		}
		httpx.Fail(w, code, err.Error())
		return
	}
	httpx.WriteJSON(w, job)
}

// handleLaunchPR lets an already-running faah open another PR without
// disturbing its own session: it re-execs itself as a brand new process on
// a new port with "faah -y <url>". The call returns as soon as the child starts.
func (s *Server) handleLaunchPR(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	var body struct {
		Target string `json:"target"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil || strings.TrimSpace(body.Target) == "" {
		httpx.Fail(w, http.StatusBadRequest, "target is required")
		return
	}
	targetURL := strings.TrimSpace(body.Target)
	if _, _, ok := forge.DetectPRURL(targetURL); !ok {
		httpx.Fail(w, http.StatusBadRequest, "target must be a valid pull or merge request URL (e.g. "+forge.PRURLExamples+")")
		return
	}
	exe, err := os.Executable()
	if err != nil {
		httpx.Fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	cmd := exec.Command(exe, "-y", targetURL)
	cmd.Dir = s.ix.Root()
	if err := cmd.Start(); err != nil {
		httpx.Fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	go cmd.Wait() // reap without blocking the handler
	httpx.WriteJSON(w, map[string]any{"ok": true})
}

// ---------------------------------------------------------------- forge connect

// forgeTarget is the forge this workspace talks to: the PR's in a review
// session, otherwise the one the branch's remote points at. A plain
// workspace's target has only Provider and Host.
func (s *Server) forgeTarget() (forge.Provider, forge.PRTarget, bool) {
	if s.pr != nil {
		provider, target, _ := s.pr.Credentials()
		return provider, target, provider != nil
	}
	root := s.ix.Root()
	if !git.Available(root) {
		return nil, forge.PRTarget{}, false
	}
	remote := git.RemoteURL(root, git.CurrentBranch(root))
	p := forge.ForRemote(remote)
	if p == nil {
		return nil, forge.PRTarget{}, false
	}
	return p, forge.PRTarget{Provider: p.Name(), Host: forge.RemoteHost(remote)}, true
}

// forgeMeta names the forge, whether faah has a token for it (and from
// where), and how to get one. nil when the workspace has no forge faah knows.
func (s *Server) forgeMeta() map[string]any {
	p, target, ok := s.forgeTarget()
	if !ok {
		return nil
	}
	source := ""
	if s.pr != nil {
		source = s.pr.TokenSource()
	} else {
		_, source = p.ResolveToken(settings.Read(), target)
	}
	return map[string]any{
		"info":     p.Info(),
		"host":     target.Host,
		"hasToken": source != "",
		"source":   source, // settings, env, gh, glab, session
		"setup":    p.TokenSetup(target.Host),
	}
}

// handleForgeConnect takes a token from the Connect dialog. In a PR review it
// is checked by reading the PR with it; one the forge rejects is never kept.
// It is saved to settings unless that would replace a token saved for
// another host of the same forge, in which case it is used for this session
// only. Either way a running review starts using it immediately.
func (s *Server) handleForgeConnect(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	var body struct {
		Token string `json:"token"`
		Extra string `json:"extra"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&body); err != nil || strings.TrimSpace(body.Token) == "" {
		httpx.Fail(w, http.StatusBadRequest, "paste a token first")
		return
	}
	token, extra := strings.TrimSpace(body.Token), strings.TrimSpace(body.Extra)
	provider, target, ok := s.forgeTarget()
	if !ok {
		httpx.Fail(w, http.StatusBadRequest, "this workspace's remote isn't on a forge faah knows")
		return
	}
	info, setup := provider.Info(), provider.TokenSetup(target.Host)

	updates := map[string]any{info.TokenKey: token}
	if setup.Extra != nil {
		updates[setup.Extra.Key] = nilIfEmpty(extra)
	}
	persist := true
	if setup.HostKey != "" {
		// A token is already saved: keep it unless it is this host's own.
		if saved, _ := settings.ReadRawMap()[info.TokenKey].(string); strings.TrimSpace(saved) != "" {
			if _, src := provider.ResolveToken(settings.Read(), target); src != "settings" {
				persist = false
			}
		}
		updates[setup.HostKey] = target.Host
	}

	var prev map[string]any
	if persist {
		raw := settings.ReadRawMap()
		prev = map[string]any{}
		for k := range updates {
			prev[k] = raw[k] // nil deletes on restore
		}
		if err := settings.UpdateMap(updates); err != nil {
			httpx.Fail(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	validated, writeAccess := false, false
	if s.pr != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		if _, err := provider.FetchPR(ctx, target, token); err != nil {
			if persist {
				settings.UpdateMap(prev)
			}
			httpx.Fail(w, http.StatusBadRequest, info.Label+" didn't accept this token: "+git.RedactToken(err.Error(), token))
			return
		}
		validated = true
		writeAccess = provider.CheckPushAccess(ctx, target, token)
		source := "settings"
		if !persist {
			source = "session"
		}
		s.pr.ReplaceCredentials(token, source, writeAccess)
	}
	httpx.WriteJSON(w, map[string]any{"ok": true, "saved": persist, "validated": validated, "writeAccess": writeAccess})
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// persistPRDrafts mirrors draft changes while the PR session holds its lock.
func (s *Server) persistPRDrafts(drafts []forge.DraftComment) {
	if s.session != nil {
		s.session.Update(func(ws *session.Workspace) { ws.Drafts = drafts })
	}
}
