package server

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"faah/internal/forge"
	"faah/internal/git"
	prpkg "faah/internal/pr"
	"faah/internal/render"
	"faah/internal/review"
	"faah/internal/session"
	"faah/internal/threads"
)

// setAgent makes editing through a coding harness available. Unavailable
// unless main wires it; available still means nothing runs until a harness is
// picked, in the UI or with -agent.
func (s *Server) setAgent(a *agentManager) {
	if s.threads != nil {
		s.threads.Close()
		s.threads = nil
	}
	s.agent = a
	if a != nil {
		s.threads = newThreadManager(a, s.ix.Root())
		s.threads.symbolHash = s.symbolHash
		a.SetHooks(threads.Hooks{PRContext: s.prThreadContext, AfterEdit: func(changed []string) {
			for _, rel := range changed {
				abs := filepath.Join(s.ix.Root(), filepath.FromSlash(rel))
				render.Evict(abs)
				if s.lsp != nil {
					s.lsp.CloseDoc(abs, rel)
				}
			}
			if len(changed) == 0 {
				return
			}
			if s.gitWatcher != nil {
				s.gitWatcher.Trigger()
			}
		}})
	}
	if s.reviewFlow != nil {
		var source review.Threads
		if s.threads != nil {
			source = s.threads.Manager
		}
		s.reviewFlow.SetThreads(source)
	}
}

// diffFileMax caps the diff file handed to a thread; past it the harness is
// pointed at the git command instead.
const diffFileMax = 2 << 20

// prThreadContext tells a coding harness what a PR-review thread is about. A PR
// checkout is a plain worktree whose recent history is the PR's commits followed
// by the reviewer's own, so a harness asked about "the PR" left to itself looks
// at the last commit. Each scope names an exact range instead, and gets the
// matching diff as a file so a big change doesn't have to be re-derived:
//
//	pr        the whole pull request: merge-base..PR head
//	mine      the reviewer's own work on top: PR head..working tree
//	selection just the anchored code; the PR is background
//
// An unset scope means the whole PR. Empty outside PR review.
func (s *Server) prThreadContext(scope string) string {
	p := s.pr
	if p == nil {
		return ""
	}
	snap := p.Snapshot()
	num, title, base, head := snap.Meta.Number, snap.Meta.Title, snap.Meta.BaseRef, snap.Meta.HeadRef
	mb, headSHA, url := snap.DiffBase, snap.Meta.HeadSHA, snap.Target.URL
	root := s.ix.Root()
	short := func(x string) string { return x[:min(12, len(x))] }
	haveRange := mb != "" && mb != "HEAD" && headSHA != ""
	if scope == "" {
		scope = "pr"
	}

	var b strings.Builder
	fmt.Fprintf(&b, "This workspace is a checkout of pull request #%d %q (%s ← %s)", num, title, base, head)
	if url != "" {
		fmt.Fprintf(&b, ", %s", url)
	}
	b.WriteString(". ")

	prRange := ""
	if haveRange {
		prRange = fmt.Sprintf("`git diff %s %s` (merge-base with %s to the PR head %s)", mb, headSHA, base, short(headSHA))
	}
	switch scope {
	case "mine":
		fmt.Fprintf(&b, "The user is asking about their OWN changes on top of the PR, not the PR itself. ")
		if headSHA == "" {
			b.WriteString("Look at `git status` and `git log` for them.")
			break
		}
		fmt.Fprintf(&b, "Those are exactly `git diff %s` (working tree against the PR head, staged and unstaged) and `git log --stat %s..HEAD` (their commits)", headSHA, headSHA)
		if un := git.Untracked(root); len(un) > 0 {
			if len(un) > 40 {
				un = append(un[:40], fmt.Sprintf("(+%d more)", len(un)-40))
			}
			fmt.Fprintf(&b, ", plus untracked files: %s", strings.Join(un, ", "))
		}
		b.WriteString(". ")
		if f := p.WriteScopeFile("your-changes.diff", git.DiffFull(root, diffFileMax, headSHA)); f != "" {
			fmt.Fprintf(&b, "That diff is also saved at %s. ", f)
		}
		if prRange != "" {
			fmt.Fprintf(&b, "The PR's own change (%s) is background only; do not review it unless asked.", prRange)
		}
	case "selection":
		b.WriteString("The user is asking about the code they anchored this conversation to; the rest of the PR is background")
		if prRange != "" {
			fmt.Fprintf(&b, " (%s shows it if you need it)", prRange)
		}
		b.WriteString(".")
	default: // "pr"
		b.WriteString("When the user says \"the PR\" or \"this PR\", they mean the entire pull request, not the latest commit or the file they are looking at.")
		if !haveRange {
			break
		}
		fmt.Fprintf(&b, " The PR is exactly %s: read it with that and `git log --stat %s..%s`; do not review from `git show HEAD` or `git diff HEAD~1`.", prRange, mb, headSHA)
		if f := p.WriteScopeFile("pr.diff", git.DiffFull(root, diffFileMax, mb, headSHA)); f != "" {
			fmt.Fprintf(&b, " The full diff is also saved at %s.", f)
		}
		if files := s.ix.PRFiles(); len(files) > 0 {
			names := make([]string, 0, len(files))
			for f, st := range files {
				names = append(names, st+" "+f)
			}
			sort.Strings(names)
			more := ""
			if len(names) > 60 {
				more = fmt.Sprintf(" (+%d more)", len(names)-60)
				names = names[:60]
			}
			fmt.Fprintf(&b, " Files it changes (%d)%s: %s.", len(files), more, strings.Join(names, ", "))
		}
		fmt.Fprintf(&b, " Anything after %s (`git diff %s`, or commits above it) is the reviewer's own work on top of the PR, not part of it.", short(headSHA), headSHA)
	}
	return b.String()
}

// SetPR marks this process as a PR review session: diffs are computed
// against the PR's merge-base instead of HEAD, and the /api/pr/* endpoints
// become live. Unset (nil) for a normal workspace.
func (s *Server) SetPR(p *prpkg.Session) {
	s.pr = p
	if p != nil {
		snap := p.Snapshot()
		s.diffBase = snap.DiffBase
		s.prHeadSHA = snap.Meta.HeadSHA
		if s.ix != nil {
			s.ix.SetDiffBase(snap.DiffBase)
			s.ix.SetPRHead(snap.Meta.HeadSHA)
			s.ix.SetPushedHead(snap.Meta.HeadSHA)
		}
		if s.gitWatcher != nil {
			s.gitWatcher.Trigger()
		}
		if snap.Target.Owner != "" && snap.Target.Repo != "" && snap.Target.Number > 0 {
			// Drafts are keyed on the PR, not the base path. Carry over any
			// drafts an older faah saved under the base-path file.
			prs := session.NewPR(snap.Target)
			if old := s.session; old != nil && len(prs.Get().Drafts) == 0 && len(old.Get().Drafts) > 0 {
				drafts := old.Get().Drafts
				prs.Update(func(ws *session.Workspace) { ws.Drafts = drafts })
				old.Update(func(ws *session.Workspace) { ws.Drafts = nil })
			}
			s.session = prs
		}
		if s.session != nil {
			p.WithDrafts(func(drafts *[]forge.DraftComment, nextID *int64) {
				if len((*drafts)) == 0 && len(s.session.Get().Drafts) > 0 {
					(*drafts) = append([]forge.DraftComment(nil), s.session.Get().Drafts...)
					for _, c := range *drafts {
						if c.ID > (*nextID) {
							(*nextID) = c.ID
						}
					}
				}
			})
		}
	}
}

// SetAgent restores agent selection, pinning it when spec is supplied.
func (s *Server) SetAgent(spec string) error {
	a, err := newAgentManager(s.ix.Root(), spec, s.lsp, s.version)
	if err != nil {
		return err
	}
	s.setAgent(a)
	return nil
}

// DetectedAgents reports installed harness names and their selected models for startup.
func (s *Server) DetectedAgents() []string {
	var found []string
	if s.agent == nil {
		return found
	}
	for _, h := range s.agent.detect() {
		if h.Installed {
			item := h.Name
			if h.Model != "" {
				item = fmt.Sprintf("%s (%s)", h.Name, h.Model)
			}
			found = append(found, item)
		}
	}
	return found
}

// CloseAgent stops edit jobs at the host's agent shutdown step.
func (s *Server) CloseAgent() { s.agent.close() }

// NotifyIndexRefresh asks the watcher to publish the newly built index.
func (s *Server) NotifyIndexRefresh() {
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}
}
