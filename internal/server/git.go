package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"faah/internal/git"
	"faah/internal/httpx"
	prpkg "faah/internal/pr"
	"faah/internal/render"
	"faah/internal/settings"
	"faah/internal/threads"
)

// handleGitRefresh triggers an immediate git status check and returns the latest git summary.
func (s *Server) handleGitRefresh(w http.ResponseWriter, r *http.Request) {
	if s.gitWatcher != nil {
		payload := s.gitWatcher.Refresh()
		httpx.WriteJSON(w, payload)
		return
	}
	count, files := s.ix.GitChanges()
	httpx.WriteJSON(w, map[string]any{
		"git":        git.Available(s.ix.Root()),
		"gitChanges": count,
		"gitFiles":   files,
		"statuses":   s.ix.GitStatusMap(),
	})
}

func (s *Server) decodeGitPath(w http.ResponseWriter, r *http.Request) (rel string, ok bool) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil || body.Path == "" {
		httpx.Fail(w, http.StatusBadRequest, "path is required")
		return "", false
	}
	_, rel, ok = s.safePath(body.Path)
	if !ok {
		httpx.Fail(w, http.StatusBadRequest, "bad path")
		return "", false
	}
	return rel, true
}

// handleGitStage adds a file to the index (POST {path}).
func (s *Server) handleGitStage(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	rel, ok := s.decodeGitPath(w, r)
	if !ok {
		return
	}
	if err := git.Stage(s.ix.Root(), rel); err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	if s.gitWatcher != nil {
		payload := s.gitWatcher.Refresh()
		httpx.WriteJSON(w, payload)
		return
	}
	s.ix.UpdateGitStatus()
	httpx.WriteJSON(w, map[string]any{"ok": true})
}

// handleGitUnstage removes a file from the index without touching the
// working tree (POST {path}).
func (s *Server) handleGitUnstage(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	rel, ok := s.decodeGitPath(w, r)
	if !ok {
		return
	}
	if err := git.Unstage(s.ix.Root(), rel); err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	if s.gitWatcher != nil {
		payload := s.gitWatcher.Refresh()
		httpx.WriteJSON(w, payload)
		return
	}
	s.ix.UpdateGitStatus()
	httpx.WriteJSON(w, map[string]any{"ok": true})
}

// handleGitHunk stages, unstages, or discards a single unified diff hunk
// (POST {path, hunk, action}).
func (s *Server) handleGitHunk(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	var body struct {
		Path   string `json:"path"`
		Hunk   string `json:"hunk"`
		Action string `json:"action"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil || body.Path == "" || body.Hunk == "" || body.Action == "" {
		httpx.Fail(w, http.StatusBadRequest, "path, hunk, and action are required")
		return
	}
	abs, rel, ok := s.safePath(body.Path)
	if !ok || rel == "" {
		httpx.Fail(w, http.StatusBadRequest, "bad path")
		return
	}
	if err := git.ApplyHunk(s.ix.Root(), rel, body.Hunk, body.Action); err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	if body.Action == "discard" {
		render.Evict(abs)
		if s.lsp != nil {
			s.lsp.CloseDoc(abs, rel)
			s.lsp.RefreshOpenDocs()
		}
		s.ix.TouchPath(rel)
	}
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}
	httpx.WriteJSON(w, map[string]any{"ok": true, "path": rel, "action": body.Action})
}

// handleGitCommit commits whatever is currently staged (POST {message}).
func (s *Server) handleGitCommit(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil || strings.TrimSpace(body.Message) == "" {
		httpx.Fail(w, http.StatusBadRequest, "message is required")
		return
	}
	root := s.ix.Root()
	if len(git.StagedPaths(root)) == 0 && git.HasUncommittedChanges(root) {
		_ = git.Stage(root, ".")
	}
	if err := git.Commit(root, strings.TrimSpace(body.Message)); err != nil {
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}
	s.tel.Track("git_commit", nil)
	httpx.WriteJSON(w, map[string]any{"ok": true})
}

// handleGitCommitMessage dispatches the selected coding harness to write a
// commit message for the currently staged diff, honoring the
// git.commitMessageInstruction setting. Returns an agent job the frontend
// polls via the existing /api/agent/job, the same as an inline edit.
func (s *Server) handleGitCommitMessage(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	if !s.agentOrFail(w) {
		return
	}
	root := s.ix.Root()
	files := git.StagedFiles(root)
	if len(files) == 0 {
		// Auto-stage all uncommitted changes if nothing is staged
		if git.HasUncommittedChanges(root) {
			_ = git.Stage(root, ".")
			files = git.StagedFiles(root)
			if s.gitWatcher != nil {
				s.gitWatcher.Trigger()
			}
		}
	}
	if len(files) == 0 {
		httpx.Fail(w, http.StatusBadRequest, "nothing staged to generate a message for")
		return
	}
	stat := git.StagedStat(root)
	diff := git.StagedDiff(root)
	instruction := ""
	if cfg := settings.Read(); cfg.GitCommitMessageInstruction != nil {
		instruction = strings.TrimSpace(*cfg.GitCommitMessageInstruction)
	}
	job, err := s.agent.StartPrompt("commit message", threads.CommitMessagePrompt(files, stat, diff, instruction))
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

// handleGitPush pushes the current branch to its remote -- or, in a PR
// review session, pushes the worktree's HEAD to the PR's actual head branch
// (possibly a fork), which may itself be a fresh branch with no upstream.
func (s *Server) handleGitPush(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	if s.pr != nil {
		// force is only sent after the reviewer confirmed pushing a rebased
		// PR branch; it is a lease, never a blind overwrite (pr.Session.Push).
		var body struct {
			Force bool `json:"force"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body)
		if op := git.OpInProgress(s.ix.Root()); op != "" {
			httpx.Fail(w, http.StatusConflict, "a "+op+" is in progress; finish or abort it before pushing")
			return
		}
		if err := s.pr.Push(body.Force); err != nil {
			httpx.Fail(w, http.StatusBadGateway, err.Error())
			return
		}
		// Pushed commits are part of the PR now: move the PR-head boundary so
		// they stop being "yours" (and the PR's file set picks them up).
		s.syncPRRefs()
		httpx.WriteJSON(w, map[string]any{"ok": true})
		return
	}
	root := s.ix.Root()
	out, err := git.Push(root)
	if err != nil && strings.Contains(out, "has no upstream branch") {
		if branch := git.CurrentBranch(root); branch != "" && branch != "HEAD" {
			out, err = git.PushSetUpstream(root, "origin", branch)
		}
	}
	if err != nil {
		httpx.Fail(w, http.StatusBadGateway, out)
		return
	}
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}
	httpx.WriteJSON(w, map[string]any{"ok": true})
}

// handleGitPull fast-forwards onto the latest remote -- or, in a PR review
// session, the PR's current head. Never merges: a non-fast-forward is
// refused outright (409), since resolving a real conflict isn't supported.
func (s *Server) handleGitPull(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	if s.pr != nil {
		if op := git.OpInProgress(s.ix.Root()); op != "" {
			st, _ := s.prSyncState(false)
			failSync(w, st, "a "+op+" is already in progress")
			return
		}
		info, err := s.pr.Pull()
		if err != nil {
			status := http.StatusBadGateway
			if errors.Is(err, prpkg.ErrDiverged) {
				status = http.StatusConflict
			}
			httpx.Fail(w, status, err.Error())
			return
		}
		s.syncPRRefs()
		httpx.WriteJSON(w, map[string]any{"ok": true, "message": info})
		return
	}

	root := s.ix.Root()
	if op := git.OpInProgress(root); op != "" {
		failSync(w, s.gitSyncState(root), "a "+op+" is already in progress")
		return
	}
	if git.HasUncommittedChanges(root) {
		httpx.Fail(w, http.StatusConflict, "commit or discard your local changes before pulling")
		return
	}
	branch := git.CurrentBranch(root)
	if branch == "" || branch == "HEAD" {
		httpx.Fail(w, http.StatusBadRequest, "not on a branch")
		return
	}
	remote, remoteBranch, ok := git.Upstream(root, branch)
	if !ok {
		httpx.Fail(w, http.StatusBadRequest, "no upstream branch configured for "+branch)
		return
	}
	if err := git.FFOnlyPull(root, remote, remoteBranch); err != nil {
		if errors.Is(err, git.ErrNotFastForward) {
			// The fetch already landed, so the counts reflect the remote as
			// it is now. The panel offers a rebase or merge from here.
			st := s.gitSyncState(root)
			st.Code = "diverged"
			failSync(w, st, fmt.Sprintf("can't fast-forward: %s has diverged from %s", branch, st.Upstream))
			return
		}
		httpx.Fail(w, http.StatusBadGateway, err.Error())
		return
	}
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}
	httpx.WriteJSON(w, map[string]any{"ok": true, "message": "pulled the latest changes"})
}

// syncPRRefs copies the PR session's head and merge-base into the server and
// index after anything moved them (push, pull), so diffs, the file tree and
// the ahead count all measure from the new boundary.
func (s *Server) syncPRRefs() {
	snap := s.pr.Snapshot()
	s.diffBase = snap.DiffBase
	s.prHeadSHA = snap.Meta.HeadSHA
	if s.ix != nil {
		s.ix.SetDiffBase(s.diffBase)
		s.ix.SetPRHead(s.prHeadSHA)
		s.ix.SetPushedHead(s.prHeadSHA)
	}
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}
}

// prSyncState is git.SyncState for a PR review: the detached checkout
// against the PR's base branch rather than an upstream. With fetch it
// refreshes the base first (a network call), as a rebase must start from
// the base as it is now.
func (s *Server) prSyncState(fetch bool) (git.SyncState, error) {
	p := s.pr
	root := s.ix.Root()
	snap := p.Snapshot()
	st := git.SyncState{PR: snap.Meta.Number, Branch: snap.Meta.HeadRef, Upstream: snap.Meta.BaseRef, OntoRef: prpkg.BaseRef(snap.Meta.Number)}
	st.InProgress = git.OpInProgress(root)
	if st.InProgress != "" {
		st.Code = "in-progress"
	}
	var err error
	if fetch && st.InProgress == "" {
		_, err = p.FetchBase()
	}
	st.Ahead, st.Behind = git.AheadBehindRef(root, st.OntoRef)
	st.Rewritten = p.Rewritten()
	st.Dirty = git.HasUncommittedChanges(root)
	return st, err
}

func (s *Server) gitSyncState(root string) git.SyncState {
	st := git.SyncState{Branch: git.CurrentBranch(root), InProgress: git.OpInProgress(root)}
	if st.InProgress != "" {
		st.Code = "in-progress"
	}
	if st.InProgress == "rebase" {
		if b := git.RebasingBranch(root); b != "" {
			st.Branch = b
		}
	}
	if st.Branch != "" && st.Branch != "HEAD" {
		if remote, rb, ok := git.Upstream(root, st.Branch); ok {
			st.Upstream = remote + "/" + rb
		}
	}
	st.Ahead, st.Behind, _ = git.AheadBehind(root)
	st.Dirty = git.HasUncommittedChanges(root)
	return st
}

// failSync is a 409 that carries the sync state alongside the message, so
// the panel can render the next step instead of just the refusal.
func failSync(w http.ResponseWriter, st git.SyncState, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusConflict)
	json.NewEncoder(w).Encode(struct {
		Error string `json:"error"`
		git.SyncState
	}{msg, st})
}

// handleGitSyncState reports the branch's standing against its upstream,
// read after an agent rebase/merge finishes to tell done from half-done.
func (s *Server) handleGitSyncState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.pr != nil {
		st, err := s.prSyncState(r.URL.Query().Get("fetch") == "1")
		if err != nil {
			httpx.Fail(w, http.StatusBadGateway, err.Error())
			return
		}
		httpx.WriteJSON(w, st)
		return
	}
	if !git.Available(s.ix.Root()) {
		httpx.WriteJSON(w, git.SyncState{})
		return
	}
	httpx.WriteJSON(w, s.gitSyncState(s.ix.Root()))
}

// handleGitSyncAgent dispatches the selected harness to rebase (or merge)
// the current branch onto its upstream after a pull refused to
// fast-forward. Only ever on an explicit click: faah itself still never
// rewrites history, and the harness is told never to push. When a rebase or
// merge is already half-done (the last attempt stopped on a conflict), the
// harness is asked to finish that one instead of starting over.
func (s *Server) handleGitSyncAgent(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	if !s.agentOrFail(w) {
		return
	}
	var body struct {
		Strategy string `json:"strategy"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body)
	if body.Strategy != "rebase" && body.Strategy != "merge" {
		httpx.Fail(w, http.StatusBadRequest, "strategy must be rebase or merge")
		return
	}
	root := s.ix.Root()
	var st git.SyncState
	if s.pr != nil {
		// In a PR review, the branch is brought up to date with the PR's
		// base: fetched here, fresh, so the harness never fetches itself.
		var err error
		if st, err = s.prSyncState(true); err != nil {
			httpx.Fail(w, http.StatusBadGateway, err.Error())
			return
		}
	} else {
		st = s.gitSyncState(root)
	}
	if st.InProgress == "" && st.Dirty {
		httpx.Fail(w, http.StatusConflict, "commit or discard your local changes before a "+body.Strategy)
		return
	}
	if st.InProgress != "" && st.InProgress != body.Strategy {
		httpx.Fail(w, http.StatusConflict, "a "+st.InProgress+" is already in progress; abort it first")
		return
	}
	if st.Upstream == "" {
		httpx.Fail(w, http.StatusBadRequest, "no upstream branch configured for "+st.Branch)
		return
	}
	if st.InProgress == "" && st.PR > 0 && st.Behind == 0 {
		httpx.Fail(w, http.StatusConflict, "the PR already contains everything on "+st.Upstream+"; nothing to "+body.Strategy)
		return
	}
	job, err := s.agent.StartPrompt(body.Strategy+" onto "+st.Upstream, threads.SyncPrompt(body.Strategy, st))
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

// handleGitAbort aborts a rebase or merge left in progress.
func (s *Server) handleGitAbort(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	if err := git.AbortOp(s.ix.Root()); err != nil {
		httpx.Fail(w, http.StatusConflict, err.Error())
		return
	}
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}
	httpx.WriteJSON(w, map[string]any{"ok": true})
}

// handleGitLog returns recent commits from HEAD (default 5).
func (s *Server) handleGitLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := 5
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}
	branch := git.CurrentBranch(s.ix.Root())
	commits := git.RecentCommits(s.ix.Root(), limit)
	commitsURL := git.CommitsWebURL(s.ix.Root(), branch)
	httpx.WriteJSON(w, map[string]any{
		"commits":    commits,
		"commitsUrl": commitsURL,
	})
}

// handleUnpushed lists the commits that exist locally but not on the tracking
// branch (@{u}..HEAD), newest first, plus the name of that tracking branch so
// the sidebar can say what the list is measured against. available is false
// (200, empty list) when git is off, no upstream is configured, or nothing is
// ahead -- there is no guessed fallback branch, since measuring against the
// wrong ref is worse than showing nothing.
func (s *Server) handleUnpushed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			limit = n
		}
	}
	var upstream string
	var commits []git.UnpushedCommit
	if s.pr != nil {
		// Detached PR checkout: your commits are everything past the PR head.
		snap := s.pr.Snapshot()
		head, branch := snap.PushedSHA, snap.Meta.HeadRef
		if head == "" {
			head = snap.Meta.HeadSHA
		}
		commits = git.CommitsSince(s.ix.Root(), head, limit)
		upstream = fmt.Sprintf("PR #%d head (%s)", snap.Meta.Number, branch)
	} else {
		upstream, commits = git.UnpushedCommits(s.ix.Root(), limit)
	}
	if commits == nil {
		commits = []git.UnpushedCommit{}
	}
	httpx.WriteJSON(w, map[string]any{
		"available": upstream != "" && len(commits) > 0,
		"upstream":  upstream,
		"commits":   commits,
	})
}

// handleCommitFiles returns the paths one commit touched, badged with git's
// name-status letter. Unknown SHAs come back as an empty list, not an error:
// the only way to ask for one is from a list faah handed out, and a commit
// that has since been rewritten is a stale click, not a failure worth a toast.
func (s *Server) handleCommitFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	sha := r.URL.Query().Get("sha")
	files := git.CommitFiles(s.ix.Root(), sha)
	if files == nil {
		files = []git.CommitFile{}
	}
	httpx.WriteJSON(w, map[string]any{"sha": sha, "files": files})
}

// handleCommitDetail returns one commit's author, full message and diffstat
// for the hover card.
func (s *Server) handleCommitDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	sha := r.URL.Query().Get("sha")
	d, ok := git.ReadCommitDetail(s.ix.Root(), sha)
	if !ok {
		httpx.Fail(w, http.StatusNotFound, "unknown commit")
		return
	}
	httpx.WriteJSON(w, d)
}
