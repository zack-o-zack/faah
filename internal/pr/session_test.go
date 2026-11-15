package pr

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/forge"
	"faah/internal/git"
	"faah/internal/git/gittest"
)

func TestPRSessionCloseRefCleanup(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping in short mode")
	}
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	run := func(args ...string) { gittest.Run(t, root, args...) }
	run("init")
	run("config", "user.name", "test")
	run("config", "user.email", "test@test.local")
	run("commit", "--allow-empty", "-m", "initial")

	run("update-ref", "refs/faah/pr/99", "HEAD")
	run("update-ref", "refs/faah/base/99", "HEAD")

	tmpWT := t.TempDir()
	p := &Session{
		srcRepo:  root,
		worktree: tmpWT,
		meta:     forge.PRMeta{Number: 99},
	}
	p.Close()

	checkRef := gittest.Command(t, root, "rev-parse", "--verify", "refs/faah/pr/99")
	if err := checkRef.Run(); err == nil {
		t.Errorf("refs/faah/pr/99 was not deleted on Close")
	}
	checkBase := gittest.Command(t, root, "rev-parse", "--verify", "refs/faah/base/99")
	if err := checkBase.Run(); err == nil {
		t.Errorf("refs/faah/base/99 was not deleted on Close")
	}
}

// TestPRSessionPullFastForwardAndDiverge exercises Session.Pull against a
// fake "upstream" (a bare repo standing in for GitHub) with a srcRepo/
// worktree pair set up exactly like Checkout's worktree case. A clean
// fast-forward onto a new PR commit must succeed and update meta.HeadSHA; a
// local commit in the worktree that then diverges from a further PR push
// must be refused with ErrDiverged, leaving the worktree untouched.
func TestPRSessionPullFastForwardAndDiverge(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	base := t.TempDir()
	if r, err := filepath.EvalSymlinks(base); err == nil {
		base = r
	}
	upstream := filepath.Join(base, "upstream.git")
	srcRepo := filepath.Join(base, "src")

	if err := os.MkdirAll(upstream, 0o755); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, upstream, "init", "--bare", "-b", "main")

	gittest.Run(t, base, "clone", upstream, "src")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, srcRepo, "config", cfg[0], cfg[1])
	}
	if err := os.WriteFile(filepath.Join(srcRepo, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, srcRepo, "add", "base.txt")
	gittest.Run(t, srcRepo, "commit", "-qm", "base commit")
	gittest.Run(t, srcRepo, "push", "origin", "main")

	// A "PR branch" pushed to upstream as refs/pull/99/head, the way GitHub does.
	gittest.Run(t, srcRepo, "checkout", "-qb", "feature")
	if err := os.WriteFile(filepath.Join(srcRepo, "feature.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, srcRepo, "add", "feature.txt")
	gittest.Run(t, srcRepo, "commit", "-qm", "pr commit 1")
	gittest.Run(t, srcRepo, "push", "origin", "feature:refs/pull/99/head")
	gittest.Run(t, srcRepo, "checkout", "-q", "main")

	// Check out the PR into a worktree, same as Checkout does.
	gittest.Run(t, srcRepo, "fetch", "--no-tags", "origin", "refs/pull/99/head:refs/faah/pr/99")
	worktree := filepath.Join(base, "wt")
	gittest.Run(t, srcRepo, "worktree", "add", "--detach", worktree, "refs/faah/pr/99")

	p := &Session{
		worktree: worktree,
		srcRepo:  srcRepo,
		target:   forge.PRTarget{Owner: "o", Repo: "r"},
		meta:     forge.PRMeta{Number: 99, BaseRef: "main", HeadRef: "feature"},
	}

	// Someone pushes a second commit to the PR head -- Pull should fast-forward cleanly.
	gittest.Run(t, srcRepo, "checkout", "-q", "feature")
	if err := os.WriteFile(filepath.Join(srcRepo, "feature.txt"), []byte("two\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, srcRepo, "commit", "-aqm", "pr commit 2")
	gittest.Run(t, srcRepo, "push", "origin", "feature:refs/pull/99/head")
	gittest.Run(t, srcRepo, "checkout", "-q", "main")

	info, err := p.Pull()
	if err != nil {
		t.Fatalf("expected a clean fast-forward Pull, got %v", err)
	}
	if info == "" {
		t.Error("expected a non-empty info message")
	}
	if got, err := os.ReadFile(filepath.Join(worktree, "feature.txt")); err != nil || string(got) != "two\n" {
		t.Fatalf("expected worktree to fast-forward to %q, got %q, err=%v", "two\n", got, err)
	}
	if p.Snapshot().Meta.HeadSHA == "" {
		t.Error("expected Pull to record the new HeadSHA")
	}

	// A local commit in the worktree (as if the reviewer committed a fix)
	// that then diverges from a further PR push must be refused, not merged.
	if err := os.WriteFile(filepath.Join(worktree, "feature.txt"), []byte("local edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, worktree, "commit", "-aqm", "reviewer's local commit")

	gittest.Run(t, srcRepo, "checkout", "-q", "feature")
	if err := os.WriteFile(filepath.Join(srcRepo, "feature.txt"), []byte("three\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, srcRepo, "commit", "-aqm", "pr commit 3")
	gittest.Run(t, srcRepo, "push", "origin", "feature:refs/pull/99/head")
	gittest.Run(t, srcRepo, "checkout", "-q", "main")

	if _, err := p.Pull(); !errors.Is(err, ErrDiverged) {
		t.Fatalf("expected errPRDiverged, got %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(worktree, "feature.txt")); err != nil || string(got) != "local edit\n" {
		t.Fatalf("expected worktree untouched by the refused pull, got %q, err=%v", got, err)
	}
}

// TestPRSessionPush confirms Push sends the worktree's HEAD to the PR's
// actual head branch (meta.HeadRepoCloneURL/HeadRef), not wherever the
// worktree happens to be checked out from.
func TestPRSessionPush(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	base := t.TempDir()
	if r, err := filepath.EvalSymlinks(base); err == nil {
		base = r
	}
	upstream := filepath.Join(base, "upstream.git")
	if err := os.MkdirAll(upstream, 0o755); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, upstream, "init", "--bare", "-b", "main")

	worktree := filepath.Join(base, "wt")
	if err := os.MkdirAll(worktree, 0o755); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, worktree, "init", "-q", "-b", "feature")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, worktree, "config", cfg[0], cfg[1])
	}
	if err := os.WriteFile(filepath.Join(worktree, "f.txt"), []byte("pushed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, worktree, "add", "f.txt")
	gittest.Run(t, worktree, "commit", "-qm", "reviewer commit")

	p := &Session{
		worktree: worktree,
		target:   forge.PRTarget{Owner: "o", Repo: "r"},
		meta:     forge.PRMeta{Number: 1, HeadRef: "feature", HeadRepoCloneURL: upstream},
	}
	if err := p.Push(false); err != nil {
		t.Fatalf("Push failed: %v", err)
	}

	out := gittest.Run(t, upstream, "log", "--oneline", "-1", "refs/heads/feature")
	if !strings.Contains(out, "reviewer commit") {
		t.Fatalf("expected upstream's refs/heads/feature to carry the pushed commit, got %q", out)
	}
	pushed := strings.TrimSpace(gittest.Run(t, worktree, "rev-parse", "HEAD"))
	if p.Snapshot().Meta.HeadSHA != pushed {
		t.Fatalf("Push should move the PR head (meta.HeadSHA) to %s, got %q", pushed, p.Snapshot().Meta.HeadSHA)
	}
	if p.remoteHead() != pushed {
		t.Fatalf("remoteHead = %q, want %s", p.remoteHead(), pushed)
	}
}

func TestHTTPSRemoteURL(t *testing.T) {
	for in, want := range map[string]string{
		"git@github.com:o/r.git":          "https://github.com/o/r.git",
		"ssh://git@github.com/o/r.git":    "https://github.com/o/r.git",
		"ssh://git@github.com:22/o/r.git": "https://github.com/o/r.git",
		"https://github.com/o/r.git":      "https://github.com/o/r.git",
		"/tmp/some/local/upstream.git":    "/tmp/some/local/upstream.git",
	} {
		if got := httpsRemoteURL(in); got != want {
			t.Errorf("httpsRemoteURL(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestPRSessionPullFollowsForcePush: a PR branch rewritten upstream is not a
// fast-forward, but with nothing of the reviewer's in the checkout Pull follows
// it instead of leaving stale content behind; with local commits it still refuses.
func TestPRSessionPullFollowsForcePush(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	base := t.TempDir()
	if r, err := filepath.EvalSymlinks(base); err == nil {
		base = r
	}
	upstream := filepath.Join(base, "upstream.git")
	os.MkdirAll(upstream, 0o755)
	gittest.Run(t, upstream, "init", "--bare", "-b", "feature")

	work := filepath.Join(base, "work")
	os.MkdirAll(work, 0o755)
	gittest.Run(t, work, "init", "-q", "-b", "feature")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, work, "config", cfg[0], cfg[1])
	}
	os.WriteFile(filepath.Join(work, "f.txt"), []byte("one\n"), 0o644)
	gittest.Run(t, work, "add", ".")
	gittest.Run(t, work, "commit", "-qm", "one")
	gittest.Run(t, work, "push", "-q", upstream, "feature")

	wt := filepath.Join(base, "wt")
	gittest.Run(t, base, "clone", "-q", upstream, "wt")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, wt, "config", cfg[0], cfg[1])
	}
	head := strings.TrimSpace(gittest.Run(t, wt, "rev-parse", "HEAD"))
	p := &Session{
		worktree: wt,
		target:   forge.PRTarget{Owner: "o", Repo: "r"},
		meta:     forge.PRMeta{Number: 1, BaseRef: "main", HeadRef: "feature", HeadRepoCloneURL: upstream, HeadSHA: head},
	}

	// Rewrite the PR branch: amend and force-push.
	os.WriteFile(filepath.Join(work, "f.txt"), []byte("rewritten\n"), 0o644)
	gittest.Run(t, work, "commit", "-aqm", "one (amended)", "--amend")
	gittest.Run(t, work, "push", "-qf", upstream, "feature")

	if _, err := p.Pull(); err != nil {
		t.Fatalf("Pull should follow a force-push when nothing local is at stake: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(wt, "f.txt")); string(got) != "rewritten\n" {
		t.Fatalf("worktree still has stale content: %q", got)
	}
	if p.Snapshot().Meta.HeadSHA == head {
		t.Fatal("HeadSHA should have moved to the rewritten head")
	}

	// With a local commit in the way, the same situation is refused.
	os.WriteFile(filepath.Join(wt, "f.txt"), []byte("mine\n"), 0o644)
	gittest.Run(t, wt, "commit", "-aqm", "mine")
	os.WriteFile(filepath.Join(work, "f.txt"), []byte("rewritten again\n"), 0o644)
	gittest.Run(t, work, "commit", "-aqm", "again", "--amend")
	gittest.Run(t, work, "push", "-qf", upstream, "feature")
	if _, err := p.Pull(); !errors.Is(err, ErrDiverged) {
		t.Fatalf("expected errPRDiverged with a local commit, got %v", err)
	}
}

// connectProvider is a GitLab provider whose API answers are canned: one
// token is accepted and has push access, everything else is rejected.
// TestPRForcePushAfterRebase covers the PR rebase flow's last step: the
// rebased checkout is detected as rewritten, a plain push is refused, and a
// force-push with lease replaces the PR branch -- unless someone else pushed
// to it meanwhile, in which case the lease refuses and their commit survives.
func TestPRForcePushAfterRebase(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	base := t.TempDir()
	if r, err := filepath.EvalSymlinks(base); err == nil {
		base = r
	}
	cfg := func(dir string) {
		for _, c := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
			gittest.Run(t, dir, "config", c[0], c[1])
		}
	}
	upstream := filepath.Join(base, "upstream.git")
	os.MkdirAll(upstream, 0o755)
	gittest.Run(t, upstream, "init", "-q", "--bare", "-b", "main")

	work := filepath.Join(base, "work")
	os.MkdirAll(work, 0o755)
	gittest.Run(t, work, "init", "-q", "-b", "main")
	cfg(work)
	os.WriteFile(filepath.Join(work, "a.txt"), []byte("a\n"), 0o644)
	gittest.Run(t, work, "add", ".")
	gittest.Run(t, work, "commit", "-qm", "base")
	gittest.Run(t, work, "push", "-q", upstream, "main")
	gittest.Run(t, work, "checkout", "-qb", "feature")
	os.WriteFile(filepath.Join(work, "f.txt"), []byte("f\n"), 0o644)
	gittest.Run(t, work, "add", ".")
	gittest.Run(t, work, "commit", "-qm", "feature")
	gittest.Run(t, work, "push", "-q", upstream, "feature")
	head := strings.TrimSpace(gittest.Run(t, work, "rev-parse", "HEAD"))
	gittest.Run(t, work, "checkout", "-q", "main")
	os.WriteFile(filepath.Join(work, "b.txt"), []byte("b\n"), 0o644)
	gittest.Run(t, work, "add", ".")
	gittest.Run(t, work, "commit", "-qm", "main moves on")
	gittest.Run(t, work, "push", "-q", upstream, "main")

	wt := filepath.Join(base, "wt")
	gittest.Run(t, base, "clone", "-q", "-b", "feature", upstream, "wt")
	cfg(wt)
	gittest.Run(t, wt, "fetch", "-q", upstream, "+refs/heads/main:"+BaseRef(1))
	p := &Session{
		worktree: wt,
		target:   forge.PRTarget{Owner: "o", Repo: "r"},
		meta:     forge.PRMeta{Number: 1, BaseRef: "main", HeadRef: "feature", HeadRepoCloneURL: upstream, HeadSHA: head},
	}
	if p.Rewritten() {
		t.Fatal("fresh checkout reported as rewritten")
	}
	if a, b := git.AheadBehindRef(wt, BaseRef(1)); a != 1 || b != 1 {
		t.Fatalf("ahead/behind base = %d/%d, want 1/1", a, b)
	}

	gittest.Run(t, wt, "rebase", "-q", BaseRef(1))
	if !p.Rewritten() {
		t.Fatal("rebased checkout not reported as rewritten")
	}
	if err := p.Push(false); err == nil {
		t.Fatal("a plain push of a rebased branch should be refused")
	}

	// Someone else pushes to the PR branch: the lease must refuse.
	other := filepath.Join(base, "other")
	gittest.Run(t, base, "clone", "-q", "-b", "feature", upstream, "other")
	cfg(other)
	os.WriteFile(filepath.Join(other, "o.txt"), []byte("o\n"), 0o644)
	gittest.Run(t, other, "add", ".")
	gittest.Run(t, other, "commit", "-qm", "theirs")
	gittest.Run(t, other, "push", "-q", "origin", "feature")
	theirs := strings.TrimSpace(gittest.Run(t, other, "rev-parse", "HEAD"))
	if err := p.Push(true); err == nil {
		t.Fatal("force-push should be refused by the lease after someone else pushed")
	}
	if got := strings.TrimSpace(gittest.Run(t, upstream, "rev-parse", "refs/heads/feature")); got != theirs {
		t.Fatalf("their commit was overwritten: feature = %s, want %s", got, theirs)
	}

	// Lease on what is actually there (as a pull would): the force-push lands.
	gittest.Run(t, upstream, "update-ref", "refs/heads/feature", head)
	if err := p.Push(true); err != nil {
		t.Fatalf("force-push with a valid lease: %v", err)
	}
	rebased := strings.TrimSpace(gittest.Run(t, wt, "rev-parse", "HEAD"))
	if got := strings.TrimSpace(gittest.Run(t, upstream, "rev-parse", "refs/heads/feature")); got != rebased {
		t.Fatalf("feature = %s, want the rebased head %s", got, rebased)
	}
	if p.Rewritten() || p.Snapshot().Meta.HeadSHA != rebased {
		t.Fatalf("after push: rewritten=%v head=%s", p.Rewritten(), p.Snapshot().Meta.HeadSHA)
	}
	mainTip := strings.TrimSpace(gittest.Run(t, wt, "rev-parse", BaseRef(1)))
	if p.Snapshot().DiffBase != mainTip {
		t.Fatalf("diffBase = %q, want the new merge-base %s", p.Snapshot().DiffBase, mainTip)
	}
}
