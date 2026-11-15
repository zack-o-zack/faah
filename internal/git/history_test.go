package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/git/gittest"
)

func TestGitUnpushedCommits(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.UnpushedRepo(t)

	upstream, commits := UnpushedCommits(root, 0)
	if upstream != "origin/main" {
		t.Fatalf("expected upstream origin/main, got %q", upstream)
	}
	if len(commits) != 2 {
		t.Fatalf("expected 2 unpushed commits, got %d: %+v", len(commits), commits)
	}
	// Newest first, and the pushed commit must not be in the list.
	if commits[0].Subject != "local two" || commits[1].Subject != "local one" {
		t.Fatalf("expected [local two, local one], got %q, %q", commits[0].Subject, commits[1].Subject)
	}
	if len(commits[0].Hash) != 40 || commits[0].Short == "" || commits[0].Author != "T" || commits[0].Date == "" {
		t.Fatalf("incomplete commit record: %+v", commits[0])
	}

	// Pushing empties the list without touching the upstream name.
	gittest.Run(t, root, "push", "-q")
	upstream, commits = UnpushedCommits(root, 0)
	if upstream != "origin/main" || len(commits) != 0 {
		t.Fatalf("expected an empty list after push, got upstream=%q, %d commits", upstream, len(commits))
	}
}

func TestGitUnpushedNoUpstream(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	// A repo with commits but no tracking branch: no list, and no guess at one.
	dir := t.TempDir()
	gittest.Run(t, dir, "init", "-b", "main")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, dir, "config", cfg[0], cfg[1])
	}
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, dir, "add", "-A")
	gittest.Run(t, dir, "commit", "-qm", "only commit")

	if ref := upstreamRef(dir); ref != "" {
		t.Fatalf("expected no upstream ref, got %q", ref)
	}
	upstream, commits := UnpushedCommits(dir, 0)
	if upstream != "" || commits != nil {
		t.Fatalf("expected nothing without an upstream, got %q / %+v", upstream, commits)
	}
}

func TestGitCommitFilesAndDetail(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.UnpushedRepo(t)
	_, commits := UnpushedCommits(root, 0)
	first := commits[1] // "local one": modify + delete + add

	files := CommitFiles(root, first.Hash)
	got := map[string]string{}
	for _, f := range files {
		got[f.Path] = f.Status
	}
	want := map[string]string{"a.txt": "M", "added.txt": "A", "gone.txt": "D"}
	for path, status := range want {
		if got[path] != status {
			t.Fatalf("expected %s to be %q in the commit, got %q (all: %+v)", path, status, got[path], got)
		}
	}
	if len(files) != len(want) {
		t.Fatalf("expected exactly %d files, got %d: %+v", len(want), len(files), files)
	}

	d, ok := ReadCommitDetail(root, first.Hash)
	if !ok {
		t.Fatal("expected commit detail for a known SHA")
	}
	if d.Subject != "local one" {
		t.Fatalf("expected subject %q, got %q", "local one", d.Subject)
	}
	if !strings.Contains(d.Message, "Body of the first local commit.") {
		t.Fatalf("expected the full message to carry the body, got %q", d.Message)
	}
	if d.Author != "T" || d.Email != "t@example.com" {
		t.Fatalf("expected author T <t@example.com>, got %q <%q>", d.Author, d.Email)
	}
	if d.Files != 3 {
		t.Fatalf("expected 3 files in the diffstat, got %d", d.Files)
	}
	// a.txt: +1/-1, added.txt: +1, gone.txt: -1
	if d.Insertions != 2 || d.Deletions != 2 {
		t.Fatalf("expected +2/-2, got +%d/-%d", d.Insertions, d.Deletions)
	}
	if d.DateISO == "" || d.Date == "" || d.Short == "" {
		t.Fatalf("incomplete detail record: %+v", d)
	}

	// An unknown or malformed SHA is refused rather than handed to git.
	if _, ok := ReadCommitDetail(root, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"); ok {
		t.Fatal("expected no detail for an unknown SHA")
	}
	if _, ok := ReadCommitDetail(root, "--upload-pack=touch /tmp/pwn"); ok {
		t.Fatal("expected a non-hex revision to be refused")
	}
	if files := CommitFiles(root, "HEAD~1"); files != nil {
		t.Fatalf("expected only hex SHAs to be accepted, got %+v", files)
	}
}

func TestGitCommitFilesLineCounts(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.UnpushedRepo(t)
	_, commits := UnpushedCommits(root, 0)
	counts := map[string][2]int{}
	for _, f := range CommitFiles(root, commits[1].Hash) {
		counts[f.Path] = [2]int{f.Add, f.Del}
	}
	want := map[string][2]int{"a.txt": {1, 1}, "added.txt": {1, 0}, "gone.txt": {0, 1}}
	for path, c := range want {
		if counts[path] != c {
			t.Errorf("%s: got +%d/-%d, want +%d/-%d", path, counts[path][0], counts[path][1], c[0], c[1])
		}
	}

	// A binary file is flagged and carries no line counts.
	dir := t.TempDir()
	if r, err := filepath.EvalSymlinks(dir); err == nil {
		dir = r // macOS TempDir is under /var -> /private/var; git reports the real path
	}
	gittest.Run(t, dir, "init", "-q", "-b", "main")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, dir, "config", cfg[0], cfg[1])
	}
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\ntwo\n"), 0o644)
	gittest.Run(t, dir, "add", "-A")
	gittest.Run(t, dir, "commit", "-qm", "base")
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\nTWO\nthree\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "img.bin"), []byte("\x00\x01\x02binary\x00"), 0o644)
	gittest.Run(t, dir, "add", "-A")
	gittest.Run(t, dir, "commit", "-qm", "modify and binary")
	head := strings.TrimSpace(gittest.Run(t, dir, "rev-parse", "HEAD"))
	byPath := map[string]CommitFile{}
	for _, f := range CommitFiles(dir, head) {
		byPath[f.Path] = f
	}
	if f := byPath["a.txt"]; f.Status != "M" || f.Add != 2 || f.Del != 1 || f.Binary {
		t.Errorf("modify: got %+v, want M with +2/-1", f)
	}
	if f := byPath["img.bin"]; !f.Binary || f.Add != 0 || f.Del != 0 {
		t.Errorf("binary: got %+v, want binary with no line counts", f)
	}

	// A merge counts only what it brought in against its first parent.
	gittest.Run(t, dir, "checkout", "-q", "-b", "side")
	os.WriteFile(filepath.Join(dir, "side.txt"), []byte("a\nb\n"), 0o644)
	gittest.Run(t, dir, "add", "-A")
	gittest.Run(t, dir, "commit", "-qm", "side work")
	gittest.Run(t, dir, "checkout", "-q", "main")
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("changed on main\n"), 0o644)
	gittest.Run(t, dir, "commit", "-qam", "main work")
	gittest.Run(t, dir, "merge", "-q", "--no-ff", "-m", "merge side", "side")
	merge := strings.TrimSpace(gittest.Run(t, dir, "rev-parse", "HEAD"))
	stats := commitNumstat(dir, merge)
	if len(stats) != 1 || stats["side.txt"] != (numstat{add: 2}) {
		t.Errorf("merge numstat: got %+v, want only side.txt +2", stats)
	}
}

func TestGitDiffCommitIsFrozenAgainstTheWorkingTree(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.UnpushedRepo(t)
	_, commits := UnpushedCommits(root, 0)
	first := commits[1] // "local one" changed two -> TWO

	diff := DiffCommit(root, "a.txt", first.Hash)
	if !strings.Contains(diff, "-two") || !strings.Contains(diff, "+TWO") {
		t.Fatalf("expected the commit's own change to a.txt, got:\n%s", diff)
	}
	// The later commit's "four" belongs to that commit, not this one.
	if strings.Contains(diff, "+four") {
		t.Fatalf("commit diff leaked a later commit's change:\n%s", diff)
	}

	added, modified, deleted := HunksCommit(root, "a.txt", first.Hash)
	if len(modified) != 1 || modified[0] != 2 {
		t.Fatalf("expected line 2 modified, got added=%v modified=%v deleted=%v", added, modified, deleted)
	}

	// Editing the working tree must not move a commit's diff.
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("wholly different\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if after := DiffCommit(root, "a.txt", first.Hash); after != diff {
		t.Fatalf("a commit diff changed with the working tree:\nbefore:\n%s\nafter:\n%s", diff, after)
	}

	// A file the commit deleted still has a diff at that commit.
	if d := DiffCommit(root, "gone.txt", first.Hash); !strings.Contains(d, "-bye") {
		t.Fatalf("expected the deletion of gone.txt in the commit diff, got:\n%s", d)
	}
	// A file it never touched has none.
	if d := DiffCommit(root, "a.txt", "notasha"); d != "" {
		t.Fatalf("expected an empty diff for a bad ref, got:\n%s", d)
	}
}

func TestGitDiffCommitRootCommit(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.UnpushedRepo(t)
	first := strings.TrimSpace(gittest.Run(t, root, "rev-list", "--max-parents=0", "HEAD"))
	// The very first commit has no parent, so --root is what makes it diffable.
	if files := CommitFiles(root, first); len(files) != 2 {
		t.Fatalf("expected the root commit's 2 files, got %+v", files)
	}
	if d := DiffCommit(root, "a.txt", first); !strings.Contains(d, "+one") {
		t.Fatalf("expected the root commit to show a.txt as added, got:\n%s", d)
	}
}
