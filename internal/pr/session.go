package pr

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"faah/internal/forge"
	"faah/internal/git"
	"faah/internal/settings"
)

// pr.go handles git forge pull/merge request reviews: checking out a PR's
// source tree into a throwaway git worktree, diffing it against the merge-base
// with its target branch instead of HEAD, and letting the reviewer leave draft
// comments and submit reviews or batch apply them with AI agents.
//
// Nothing persists past the process. The worktree lives in a system temp dir
// and is removed in Session.Close.

// Session is one checked-out PR review. Draft comments live only in
// memory (mu-guarded), same lifetime as an agentJob -- never written to
// disk, never surviving a restart.
type Session struct {
	mu sync.Mutex

	provider        forge.Provider
	target          forge.PRTarget
	meta            forge.PRMeta
	token           string
	tokenSource     string // where token came from: settings, env, gh, glab, session ("" with no token)
	writeAccess     bool
	diffBase        string // merge-base(head, base branch), or "HEAD" if the base couldn't be resolved
	diffBaseWarning string // set when diffBase fell back to "HEAD"; surfaced in the UI so an empty diff doesn't read as "no changes"

	worktree  string // temp checkout, removed in Close
	srcRepo   string // the repo the worktree was registered against ("" for a plain clone)
	srcRemote string // srcRepo's remote that points at the PR's repository

	// pushedSHA is what the PR's branch holds on the remote after this session
	// pushed to it ("" until the first push: the head the PR was checked out
	// at). It bounds "unpushed", and nothing else. meta.HeadSHA deliberately
	// stays at the head the review started from, so a push moves your commits
	// out of "Unpushed" without folding them into "PR changes".
	pushedSHA string

	scopeDir string // temp dir holding the diff files handed to threads; removed in Close

	comments []forge.DraftComment
	nextID   int64
}

// remoteHead returns the commit the PR's branch is at on the remote, as far as
// this session knows. Callers hold p.mu.
func (p *Session) remoteHead() string {
	if p.pushedSHA != "" {
		return p.pushedSHA
	}
	return p.meta.HeadSHA
}

// errMergedCancelled is returned when opening an already-merged PR is cancelled.
var errMergedCancelled = errors.New("PR is already merged; opening cancelled")

// computeDiffBase fetches the PR's base branch into worktree and returns a
// merge-base with HEAD to diff against, so review diffs show exactly what
// the PR changes rather than the head's full HEAD diff. Best-effort: if it
// can't be resolved (e.g. the base branch was force-pushed away, or the
// fetch itself failed), diffBase falls back to "HEAD" -- which diffs the
// checkout against its own HEAD and looks empty -- with a warning explaining
// why, so callers can surface it and a blank diff never reads as "no
// changes". Shared by Checkout (initial checkout) and Session.Pull
// (re-sync after new commits land on the PR).
func computeDiffBase(worktree, srcRepo, srcRemote string, fg forgeGit, baseRef string, num int, onProgress func(string)) (diffBase, diffBaseWarning string) {
	if onProgress != nil {
		onProgress(fmt.Sprintf("Computing merge base with %s...", baseRef))
	}
	diffBase = "HEAD"
	if srcRemote == "" {
		srcRemote = "origin"
	}
	fetchErr := fetchPRBase(worktree, srcRepo, srcRemote, fg, baseRef, num)
	if fetchErr == "" {
		if mb := git.MergeBase(worktree, "HEAD", BaseRef(num)); mb != "" {
			diffBase = mb
		}
	}
	if diffBase == "HEAD" && srcRepo != "" {
		if mb := git.MergeBase(worktree, "HEAD", srcRemote+"/"+baseRef); mb != "" {
			diffBase = mb
			fetchErr = "" // recovered via the local clone's own remote-tracking ref
		}
	}
	if diffBase == "HEAD" {
		diffBaseWarning = fmt.Sprintf("could not resolve a merge-base with %s; diff will show no changes", baseRef)
		if fetchErr != "" {
			diffBaseWarning = fmt.Sprintf("%s (%s)", diffBaseWarning, fetchErr)
		}
		fmt.Fprintln(os.Stderr, "faah: warning:", diffBaseWarning)
		if onProgress != nil {
			onProgress("Warning: " + diffBaseWarning)
		}
	}
	return diffBase, diffBaseWarning
}

// forgeGit is how plain git reaches the PR's repository on its forge.
type forgeGit struct {
	CloneURL string   // https clone URL of the base repository
	HeadRef  string   // the forge's ref for the PR head, "" if it has none
	Auth     git.Auth // empty without a token
}

func newForgeGit(provider forge.Provider, target forge.PRTarget, token string) forgeGit {
	if provider == nil {
		provider = &forge.GitHub{}
	}
	return forgeGit{CloneURL: provider.CloneURL(target), HeadRef: provider.PRHeadRef(target), Auth: provider.GitAuth(target, token)}
}

// git is newForgeGit for this session. Callers hold no lock.
func (p *Session) git() forgeGit {
	p.mu.Lock()
	defer p.mu.Unlock()
	t := p.target
	if t.Number == 0 {
		t.Number = p.meta.Number
	}
	return newForgeGit(p.provider, t, p.token)
}

// BaseRef is where a session keeps its fetched copy of the PR's base
// branch: the ref diffs are measured from and an agent rebase targets.
func BaseRef(num int) string { return fmt.Sprintf("refs/faah/base/%d", num) }

// fetchPRBase force-updates BaseRef(num) from the PR's base branch,
// returning git's error text ("" on success). Forced, so a base branch that
// was itself rewritten is followed rather than refused.
func fetchPRBase(worktree, srcRepo, srcRemote string, fg forgeGit, baseRef string, num int) string {
	baseRemote := srcRemote
	if srcRepo == "" {
		baseRemote = fg.CloneURL
	}
	refspec := fmt.Sprintf("+refs/heads/%s:%s", baseRef, BaseRef(num))
	out, err := git.AuthCmd(fg.Auth, "-C", worktree, "fetch", "--no-tags", baseRemote, refspec).CombinedOutput()
	if err == nil {
		return ""
	}
	if msg := fg.Auth.Redact(strings.TrimSpace(string(out))); msg != "" {
		return msg
	}
	return err.Error()
}

// Checkout fetches a PR's head ref and checks it out into a system temp
// directory: a git worktree of cwd's origin when cwd is already a clone of
// the same repo (the common case -- opened inside the repo), or a shallow
// single-branch clone of the PR head otherwise (a bare URL opened from an
// unrelated directory).
func Checkout(ctx context.Context, provider forge.Provider, target forge.PRTarget, cwd string, onProgress func(string)) (*Session, error) {
	cfg := settings.Read()
	token, tokenSource := provider.ResolveToken(cfg, target)

	if onProgress != nil {
		onProgress(fmt.Sprintf("Fetching PR #%d metadata from %s...", target.Number, provider.Name()))
	}
	meta, err := provider.FetchPR(ctx, target, token)
	if err != nil {
		return nil, err
	}

	tmp, err := os.MkdirTemp("", "faah-pr-*")
	if err != nil {
		return nil, err
	}
	// macOS TempDir lives under /var -> /private/var; git rev-parse
	// --show-toplevel reports the resolved path, so leaving tmp unresolved
	// makes git.StatusAgainst's toplevel-relative prefix check fail for every
	// file, silently emptying the PR's diff/status view.
	if resolved, err := filepath.EvalSymlinks(tmp); err == nil {
		tmp = resolved
	}
	cleanup := func() { os.RemoveAll(tmp) }

	srcRepo, srcRemote := FindRemote(cwd, target.Owner, target.Repo)
	fg := newForgeGit(provider, target, token)

	num := target.Number
	if srcRepo != "" && fg.HeadRef != "" {
		if onProgress != nil {
			onProgress(fmt.Sprintf("Fetching PR #%d head and preparing worktree...", num))
		}
		headRefspec := fmt.Sprintf("%s:refs/faah/pr/%d", fg.HeadRef, num)
		if out, err := git.LocalThenToken(fg.Auth, "-C", srcRepo, "fetch", "--no-tags", srcRemote, headRefspec); err != nil {
			cleanup()
			return nil, fmt.Errorf("git fetch PR head: %w: %s", err, fg.Auth.Redact(strings.TrimSpace(string(out))))
		}
		// A partial clone (the workbench's own) fetches file contents here.
		if out, err := git.LocalThenToken(fg.Auth, "-C", srcRepo, "worktree", "add", "--detach", tmp, fmt.Sprintf("refs/faah/pr/%d", num)); err != nil {
			cleanup()
			return nil, fmt.Errorf("git worktree add: %w: %s", err, fg.Auth.Redact(strings.TrimSpace(string(out))))
		}
	} else {
		// No local clone, or a forge with no PR head ref: clone the head
		// branch itself, from wherever it lives (a fork included).
		srcRepo, srcRemote = "", ""
		if onProgress != nil {
			onProgress(fmt.Sprintf("Cloning PR #%d (%s)...", num, meta.HeadRef))
		}
		cloneURL := meta.HeadRepoCloneURL
		if cloneURL == "" {
			cloneURL = fg.CloneURL
		}
		if out, err := git.AuthCmd(fg.Auth, "clone", "--filter=blob:none", "--branch", meta.HeadRef, "--single-branch", cloneURL, tmp).CombinedOutput(); err != nil {
			cleanup()
			return nil, fmt.Errorf("git clone PR head: %w: %s", err, fg.Auth.Redact(strings.TrimSpace(string(out))))
		}
	}

	diffBase, diffBaseWarning := computeDiffBase(tmp, srcRepo, srcRemote, fg, meta.BaseRef, num, onProgress)

	writeAccess := provider.CheckPushAccess(ctx, target, token)

	p := New(provider, target, meta, tmp, diffBase)
	p.token, p.tokenSource, p.writeAccess = token, tokenSource, writeAccess
	p.diffBaseWarning, p.srcRepo, p.srcRemote = diffBaseWarning, srcRepo, srcRemote
	return p, nil
}

func (p *Session) Root() string { return p.worktree }

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
	case forge.RemoteHost(u) != "":
		_, u, _ = strings.Cut(u, ":")
	default:
		local = true
	}
	u = strings.TrimSuffix(strings.Trim(u, "/"), ".git")
	return u == want || (local && strings.HasSuffix(u, "/"+want))
}

// Close removes the worktree registration (if any), cleans up temporary
// references, and deletes the temp checkout. Safe on a nil receiver.
func (p *Session) Close() {
	if p == nil {
		return
	}
	if p.scopeDir != "" {
		os.RemoveAll(p.scopeDir)
	}
	if p.srcRepo != "" {
		exec.Command("git", "-C", p.srcRepo, "worktree", "remove", "--force", p.worktree).Run()
		exec.Command("git", "-C", p.srcRepo, "update-ref", "-d", fmt.Sprintf("refs/faah/pr/%d", p.meta.Number)).Run()
		exec.Command("git", "-C", p.srcRepo, "update-ref", "-d", fmt.Sprintf("refs/faah/base/%d", p.meta.Number)).Run()
	}
	os.RemoveAll(p.worktree)
}

// httpsRemoteURL rewrites an ssh-style remote (git@github.com:o/r.git,
// ssh://git@github.com/o/r.git) to its https form; anything else is returned as is.
func httpsRemoteURL(raw string) string {
	switch {
	case strings.HasPrefix(raw, "ssh://"):
		rest := strings.TrimPrefix(raw, "ssh://")
		if i := strings.IndexByte(rest, '@'); i >= 0 {
			rest = rest[i+1:]
		}
		if i := strings.IndexByte(rest, '/'); i >= 0 {
			host := rest[:i]
			if j := strings.IndexByte(host, ':'); j >= 0 { // ssh port means nothing to https
				host = host[:j]
			}
			return "https://" + host + rest[i:]
		}
	case strings.Contains(raw, "@") && !strings.Contains(raw, "://"):
		if at := strings.IndexByte(raw, '@'); at >= 0 {
			if host, path, ok := strings.Cut(raw[at+1:], ":"); ok {
				return "https://" + host + "/" + strings.TrimPrefix(path, "/")
			}
		}
	}
	return raw
}

// WriteScopeFile puts content in a per-session temp dir (outside the worktree, so
// it never shows up as an untracked change) and returns its path, or "" if it
// could not be written.
func (p *Session) WriteScopeFile(name, content string) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.scopeDir == "" {
		dir, err := os.MkdirTemp("", "faah-prdiff-*")
		if err != nil {
			return ""
		}
		p.scopeDir = dir
	}
	path := filepath.Join(p.scopeDir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return ""
	}
	return path
}

// ErrDiverged is returned by Pull when the checkout can't be fast-forwarded
// onto the PR's current head -- local commits, or a force-pushed head, that
// don't share a straight-line history with what was fetched. Resolving that
// is not supported: Pull never invokes git's merge machinery, only a reset
// --hard onto an ancestor-verified fast-forward.
var ErrDiverged = errors.New("local checkout has diverged from the PR head; resolve manually")

// Pull re-fetches the PR's current head and, if it's a clean fast-forward,
// resets the worktree onto it and refreshes meta.HeadSHA/diffBase to match.
// Refuses outright when the worktree has uncommitted changes (nothing here
// stashes) or when the fast-forward check fails, in which case the caller
// should surface ErrDiverged as "not supported, resolve manually".
func (p *Session) Pull() (info string, err error) {
	p.mu.Lock()
	worktree, srcRepo, srcRemote, num := p.worktree, p.srcRepo, p.srcRemote, p.meta.Number
	if srcRemote == "" {
		srcRemote = "origin"
	}
	target, baseRef := p.target, p.meta.BaseRef
	headRepoCloneURL, headRef := p.meta.HeadRepoCloneURL, p.meta.HeadRef
	token := p.token
	p.mu.Unlock()
	fg := p.git()

	if git.HasUncommittedChanges(worktree) {
		return "", errors.New("commit or discard your local changes before pulling")
	}

	// Fetch the PR branch itself, forced: it is the source of truth for the
	// PR's head (the forge's PR head ref can lag behind a fresh push), and a
	// force-pushed branch must not be refused as a non-fast-forward ref update.
	// A local clone with no token keeps using its own remote instead, which is
	// the remote that clone can already authenticate to.
	newRef := "FETCH_HEAD"
	if srcRepo != "" && token == "" && fg.HeadRef != "" {
		newRef = fmt.Sprintf("refs/faah/pr/%d", num)
		headRefspec := fmt.Sprintf("+%s:%s", fg.HeadRef, newRef)
		if out, err := exec.Command("git", "-C", srcRepo, "fetch", "--no-tags", srcRemote, headRefspec).CombinedOutput(); err != nil {
			return "", fmt.Errorf("git fetch PR head: %w: %s", err, strings.TrimSpace(string(out)))
		}
	} else {
		cloneURL := headRepoCloneURL
		if cloneURL == "" {
			cloneURL = fg.CloneURL
		}
		if out, err := git.AuthCmd(fg.Auth, "-C", worktree, "fetch", "--no-tags", cloneURL, "+refs/heads/"+headRef).CombinedOutput(); err != nil {
			return "", fmt.Errorf("git fetch PR head: %w: %s", err, fg.Auth.Redact(strings.TrimSpace(string(out))))
		}
	}

	headOut, err := exec.Command("git", "-C", worktree, "rev-parse", "HEAD").Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD: %w", err)
	}
	head := strings.TrimSpace(string(headOut))
	p.mu.Lock()
	knownHead := p.meta.HeadSHA
	p.mu.Unlock()
	nothingOfMine := head == knownHead // no local commits past the PR head we checked out

	info = "pulled the latest changes"
	upToDate := exec.Command("git", "-C", worktree, "merge-base", "--is-ancestor", newRef, "HEAD").Run() == nil
	switch {
	case upToDate:
		info = "already up to date"
	case exec.Command("git", "-C", worktree, "merge-base", "--is-ancestor", "HEAD", newRef).Run() == nil:
		// plain fast-forward
	case nothingOfMine:
		// The PR branch was rewritten (force-push or rebase) and there is
		// nothing of yours to lose: follow it.
		info = "pulled the latest changes (the PR branch was force-pushed)"
	default:
		return "", ErrDiverged
	}
	if !upToDate {
		if out, err := exec.Command("git", "-C", worktree, "reset", "--hard", newRef).CombinedOutput(); err != nil {
			return "", fmt.Errorf("git reset: %w: %s", err, strings.TrimSpace(string(out)))
		}
		shaOut, err := exec.Command("git", "-C", worktree, "rev-parse", "HEAD").Output()
		if err != nil {
			return "", fmt.Errorf("git rev-parse HEAD: %w", err)
		}
		p.mu.Lock()
		p.meta.HeadSHA = strings.TrimSpace(string(shaOut))
		p.pushedSHA = ""
		p.mu.Unlock()
	}

	// Title, state, merged, base branch: refresh what the forge says about the PR
	// itself, so the bar doesn't keep showing the state from session start.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if p.provider == nil {
		// nothing to ask
	} else if fresh, err := p.provider.FetchPR(ctx, target, token); err == nil {
		p.mu.Lock()
		p.meta.Title, p.meta.State, p.meta.Merged, p.meta.MergedAt = fresh.Title, fresh.State, fresh.Merged, fresh.MergedAt
		p.meta.Draft, p.meta.BaseRef = fresh.Draft, fresh.BaseRef
		baseRef = p.meta.BaseRef
		p.mu.Unlock()
	}
	diffBase, diffBaseWarning := computeDiffBase(worktree, srcRepo, srcRemote, fg, baseRef, num, nil)
	p.mu.Lock()
	p.diffBase = diffBase
	p.diffBaseWarning = diffBaseWarning
	p.mu.Unlock()

	return info, nil
}

// FetchBase refreshes the session's copy of the PR's base branch and
// returns its ref -- what an agent rebase or merge of the base targets. faah
// fetches it itself, with the forge token, so the harness never needs
// credentials (and never fetches at all).
func (p *Session) FetchBase() (string, error) {
	p.mu.Lock()
	worktree, srcRepo, srcRemote := p.worktree, p.srcRepo, p.srcRemote
	baseRef, num := p.meta.BaseRef, p.meta.Number
	p.mu.Unlock()
	if srcRemote == "" {
		srcRemote = "origin"
	}
	if msg := fetchPRBase(worktree, srcRepo, srcRemote, p.git(), baseRef, num); msg != "" {
		return "", fmt.Errorf("git fetch %s: %s", baseRef, msg)
	}
	return BaseRef(num), nil
}

// refreshDiffBase re-derives diffBase from the base ref already fetched. A
// pushed rebase onto (or merge of) a newer base moves the merge-base, and
// the old one would fold the base's own changes into "PR changes".
func (p *Session) refreshDiffBase() {
	p.mu.Lock()
	worktree, srcRepo, srcRemote, baseRef, num := p.worktree, p.srcRepo, p.srcRemote, p.meta.BaseRef, p.meta.Number
	p.mu.Unlock()
	mb := git.MergeBase(worktree, "HEAD", BaseRef(num))
	if mb == "" && srcRepo != "" && srcRemote != "" {
		mb = git.MergeBase(worktree, "HEAD", srcRemote+"/"+baseRef)
	}
	if mb == "" {
		return
	}
	p.mu.Lock()
	p.diffBase = mb
	p.diffBaseWarning = ""
	p.mu.Unlock()
}

// Rewritten reports whether the checkout's history no longer contains the
// PR head on the remote -- a rebase that hasn't been (force-)pushed yet.
// Until it is, the forge still holds the old commits: approving or merging
// would act on those, not on what is checked out.
func (p *Session) Rewritten() bool {
	p.mu.Lock()
	worktree, head := p.worktree, p.remoteHead()
	p.mu.Unlock()
	return git.ValidSHA(head) && !git.IsAncestor(worktree, head, "HEAD")
}

// Push pushes the worktree's current commit to the PR's actual head branch
// on its head repo (which may be a fork). Without force, a rejection means
// the head moved since this checkout or since the last Pull, and the caller
// should Pull before trying again. With force -- only ever after the
// reviewer confirmed pushing a rebase -- it is --force-with-lease against the
// head this session last saw, so commits someone else pushed in the meantime
// are refused rather than silently discarded.
func (p *Session) Push(force bool) error {
	p.mu.Lock()
	worktree := p.worktree
	cloneURL, headRef := p.meta.HeadRepoCloneURL, p.meta.HeadRef
	token := p.token
	lease := p.remoteHead()
	p.mu.Unlock()
	if force && !git.ValidSHA(lease) {
		return errors.New("can't force-push: the PR head this checkout started from is unknown")
	}
	fg := p.git()

	if cloneURL == "" {
		cloneURL = fg.CloneURL
	}
	// However this checkout was cloned (https or ssh), the push goes over https
	// with the forge token, so it never stops to ask for a password.
	pushURL := cloneURL
	if token != "" {
		pushURL = httpsRemoteURL(cloneURL)
	}
	refspec := fmt.Sprintf("HEAD:refs/heads/%s", headRef)
	args := []string{"-C", worktree, "push"}
	if force {
		args = append(args, fmt.Sprintf("--force-with-lease=refs/heads/%s:%s", headRef, lease))
	}
	out, err := git.AuthCmd(fg.Auth, append(args, pushURL, refspec)...).CombinedOutput()
	if err != nil {
		msg := fg.Auth.Redact(strings.TrimSpace(string(out)))
		if force && strings.Contains(msg, "stale info") {
			return fmt.Errorf("git push: someone else pushed to %s since this checkout; pull their commits and rebase again: %s", headRef, msg)
		}
		return fmt.Errorf("git push: %w: %s", err, msg)
	}
	// What you pushed is now part of the PR: the PR head moves up to it, so
	// those commits leave "Your changes" and join "PR changes".
	if sha, err := exec.Command("git", "-C", worktree, "rev-parse", "HEAD").Output(); err == nil {
		p.mu.Lock()
		p.meta.HeadSHA = strings.TrimSpace(string(sha))
		p.pushedSHA = ""
		p.mu.Unlock()
	}
	p.refreshDiffBase()
	return nil
}

// ---------------------------------------------------------------- HTTP

func (p *Session) MetaMap(files map[string]string) map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	return map[string]any{
		"number":          p.meta.Number,
		"title":           p.meta.Title,
		"author":          p.meta.Author,
		"base":            p.meta.BaseRef,
		"head":            p.meta.HeadRef,
		"state":           p.meta.State,
		"merged":          p.meta.Merged,
		"mergedAt":        p.meta.MergedAt,
		"draft":           p.meta.Draft,
		"writeAccess":     p.writeAccess,
		"readOnly":        p.token == "",
		"draftCount":      len(p.comments),
		"diffBaseWarning": p.diffBaseWarning,
		"headSHA":         p.meta.HeadSHA,
		"url":             p.target.URL,
		"files":           files,
	}
}

// Snapshot is the review state needed by host adapters.
type Snapshot struct {
	Target                               forge.PRTarget
	Meta                                 forge.PRMeta
	DiffBase, DiffBaseWarning, PushedSHA string
	WriteAccess                          bool
}

// Snapshot reads the review boundaries in one lock hold.
func (p *Session) Snapshot() Snapshot {
	p.mu.Lock()
	defer p.mu.Unlock()
	return Snapshot{p.target, p.meta, p.diffBase, p.diffBaseWarning, p.pushedSHA, p.writeAccess}
}

// New assembles a review session from already resolved checkout state.
func New(provider forge.Provider, target forge.PRTarget, meta forge.PRMeta, root, diffBase string) *Session {
	return &Session{provider: provider, target: target, meta: meta, worktree: root, diffBase: diffBase}
}

// Credentials returns the forge, target and token for one forge call. It reads
// them under the session lock; the call itself runs without it.
func (p *Session) Credentials() (forge.Provider, forge.PRTarget, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.provider, p.target, p.token
}

// ReplaceCredentials updates the token, its source and push access atomically.
func (p *Session) ReplaceCredentials(token, source string, writeAccess bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.token, p.tokenSource, p.writeAccess = token, source, writeAccess
}

// TokenSource reports the active credential source without exposing the token.
func (p *Session) TokenSource() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.token == "" {
		return ""
	}
	if p.tokenSource == "" {
		return "session"
	}
	return p.tokenSource
}

// WithDrafts holds the session lock while the host reads or mutates drafts,
// restores the next ID, and persists the result. The callback must not retain
// the state pointers or call other session methods.
func (p *Session) WithDrafts(fn func(comments *[]forge.DraftComment, nextID *int64)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	fn(&p.comments, &p.nextID)
}

// UpdateMergeState records the forge's account of a completed merge. A nil
// result means the refresh failed after the merge succeeded.
func (p *Session) UpdateMergeState(fresh *forge.PRMeta) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if fresh != nil {
		p.meta.State, p.meta.Merged, p.meta.MergedAt = fresh.State, fresh.Merged, fresh.MergedAt
	} else {
		p.meta.Merged = true
	}
}

// AddComment assigns an ID, appends a draft and persists it in one lock hold.
func (p *Session) AddComment(c forge.DraftComment, persist func([]forge.DraftComment)) forge.DraftComment {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.nextID++
	c.ID = p.nextID
	p.comments = append(p.comments, c)
	persist(p.comments)
	return c
}

// DeleteComment removes a draft and persists the result in one lock hold.
func (p *Session) DeleteComment(id int64, persist func([]forge.DraftComment)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i, c := range p.comments {
		if c.ID == id {
			p.comments = append(p.comments[:i], p.comments[i+1:]...)
			break
		}
	}
	persist(p.comments)
}

// ClearComments clears submitted drafts and persists that state in one lock hold.
func (p *Session) ClearComments(persist func([]forge.DraftComment)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.comments = nil
	persist(nil)
}
