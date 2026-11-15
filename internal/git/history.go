package git

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// RecentCommits returns up to count recent commits from HEAD.
func RecentCommits(root string, count int) []LogCommit {
	if count <= 0 {
		count = 5
	}
	out, err := exec.Command("git", "-C", root, "log", fmt.Sprintf("-n%d", count), "--format=%h%x1f%s%x1f%an%x1f%cr%x1f%H").Output()
	if err != nil {
		return []LogCommit{}
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	commits := make([]LogCommit, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\x1f")
		c := LogCommit{
			Hash: parts[0],
		}
		if len(parts) > 1 {
			c.Subject = parts[1]
		}
		if len(parts) > 2 {
			c.Author = parts[2]
		}
		if len(parts) > 3 {
			c.Date = parts[3]
		}
		if len(parts) > 4 {
			c.Full = parts[4]
		}
		commits = append(commits, c)
	}
	return commits
}

/* ---------- unpushed commits (@{u}..HEAD) ----------

   Everything below reads commits that exist locally but not on the tracking
   branch, so they can be reviewed in faah before they are pushed. All of it is
   strictly read-only and fails quiet: no upstream, no git, or a bad SHA all
   yield an empty result rather than an error, and the sidebar section simply
   doesn't appear. */

// UnpushedCommit is one commit in @{u}..HEAD, newest first.
type UnpushedCommit struct {
	Hash    string `json:"hash"`    // full SHA, what every follow-up call passes back
	Short   string `json:"short"`   // abbreviated SHA for display
	Subject string `json:"subject"` // first line of the message
	Author  string `json:"author"`
	Date    string `json:"date"` // relative ("2 hours ago")
}

// CommitFile is one path a commit touched, with git's name-status letter
// (M/A/D/R/C/T) -- the same alphabet the file tree badges working-tree changes
// with, so the commit's file list reads identically.
type CommitFile struct {
	Path   string `json:"path"`
	Status string `json:"status"`
	From   string `json:"from,omitempty"` // previous path, for R/C only
	Add    int    `json:"add"`
	Del    int    `json:"del"`
	Binary bool   `json:"binary,omitempty"` // numstat reports "-" for its line counts
}

// CommitDetail is everything the commit hover card shows: who wrote it, the
// full message, and its diffstat.
type CommitDetail struct {
	Hash       string `json:"hash"`
	Short      string `json:"short"`
	Subject    string `json:"subject"`
	Message    string `json:"message"` // full message, subject line included
	Author     string `json:"author"`
	Email      string `json:"email"`
	Date       string `json:"date"`    // relative
	DateISO    string `json:"dateIso"` // exact, for the title attribute
	Files      int    `json:"files"`
	Insertions int    `json:"insertions"`
	Deletions  int    `json:"deletions"`
	AuthorURL  string `json:"authorUrl,omitempty"` // best-effort GitHub profile/search link
	CommitURL  string `json:"commitUrl,omitempty"`
}

// shaRe bounds what reaches git as a revision. Every SHA the frontend sends
// came from a list faah itself produced, so anything else is a bug or a probe;
// refusing it keeps a crafted "--upload-pack=..." out of an exec argument.
var shaRe = regexp.MustCompile(`^[0-9a-fA-F]{4,40}$`)

func ValidSHA(sha string) bool { return shaRe.MatchString(sha) }

// upstreamRef returns the tracking branch HEAD is configured to push to, as
// git names it ("origin/master"), or "" when none is configured. Unlike
// AheadBehind there is no origin/<branch> fallback: an unpushed list is
// only meaningful against a branch git itself considers upstream, and guessing
// one would quietly measure against the wrong ref.
func upstreamRef(root string) string {
	if !Available(root) {
		return ""
	}
	out, err := exec.Command("git", "-C", root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// UnpushedCommits lists the commits in @{u}..HEAD, newest first, along with
// the upstream ref they are measured against. Both are empty when no upstream
// is configured or nothing is ahead.
func UnpushedCommits(root string, limit int) (upstream string, commits []UnpushedCommit) {
	upstream = upstreamRef(root)
	if upstream == "" {
		return "", nil
	}
	return upstream, CommitsInRange(root, "@{u}..HEAD", limit)
}

// CommitsSince lists the commits in base..HEAD, newest first. PR review
// checkouts sit on a detached HEAD with no upstream, so the PR head they were
// checked out at (or last pushed to) stands in as the boundary.
func CommitsSince(root, base string, limit int) []UnpushedCommit {
	if !ValidSHA(base) {
		return nil
	}
	return CommitsInRange(root, base+"..HEAD", limit)
}

// CountSince returns how many commits HEAD has that base does not.
func CountSince(root, base string) int {
	if !ValidSHA(base) {
		return 0
	}
	out, err := exec.Command("git", "-C", root, "rev-list", "--count", base+"..HEAD").Output()
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(out)))
	return n
}

func CommitsInRange(root, rng string, limit int) (commits []UnpushedCommit) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	out, err := exec.Command("git", "-C", root, "log", fmt.Sprintf("-n%d", limit),
		"--format=%H%x1f%h%x1f%s%x1f%an%x1f%cr", rng).Output()
	if err != nil {
		return nil
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x1f")
		c := UnpushedCommit{Hash: f[0]}
		if len(f) > 1 {
			c.Short = f[1]
		}
		if len(f) > 2 {
			c.Subject = f[2]
		}
		if len(f) > 3 {
			c.Author = f[3]
		}
		if len(f) > 4 {
			c.Date = f[4]
		}
		commits = append(commits, c)
	}
	return commits
}

// commitDiffArgs are the diff-tree flags every per-commit read shares: the
// commit's own change against its first parent (--root so the very first
// commit still has one to show), one entry per path rather than per tree.
var commitDiffArgs = []string{"--no-commit-id", "-r", "-m", "--first-parent", "--root"}

// CommitFiles lists the paths a commit touched, relative to the served
// root. Paths outside root's subtree are dropped, the same way StatusAgainst
// drops them, so a repo served from a subdirectory lists only what it can open.
func CommitFiles(root, sha string) []CommitFile {
	info := Probe(root)
	if !info.ok || !ValidSHA(sha) {
		return nil
	}
	args := append([]string{"-C", root, "diff-tree", "--name-status", "-z", "--find-renames"}, commitDiffArgs...)
	out, err := exec.Command("git", append(args, sha)...).Output()
	if err != nil {
		return nil
	}
	stats := commitNumstat(root, sha)
	key := repoRelKey(info, root)
	relativeStats := make(map[string]numstat, len(stats))
	for path, stat := range stats {
		if rel, ok := key(path); ok {
			relativeStats[rel] = stat
		}
	}
	files := parseChangedFiles(out, key)
	for i := range files {
		ns := relativeStats[files[i].Path]
		files[i].Add, files[i].Del, files[i].Binary = ns.add, ns.del, ns.binary
	}
	return files
}

type numstat struct {
	add, del int
	binary   bool
}

// commitNumstat returns each path's line counts in a commit, keyed by the
// repo-relative path git reports (the new path for a rename). In -z form a
// rename is "add\tdel\t\0old\0new\0"; anything else is "add\tdel\tpath\0".
//
// git show rather than diff-tree: on a 20,000-file commit diff-tree --numstat
// takes ~1.6 s against show's ~90 ms, and on a merge diff-tree -m lists every
// path once per parent, where show -m --first-parent gives the first parent only.
func commitNumstat(root, sha string) map[string]numstat {
	out, err := exec.Command("git", "-C", root, "show", "--numstat", "-z", "--format=",
		"-m", "--first-parent", "--no-color", sha).Output()
	if err != nil {
		return nil
	}
	stats := map[string]numstat{}
	toks := strings.Split(string(out), "\x00")
	for i := 0; i < len(toks); {
		f := strings.SplitN(toks[i], "\t", 3)
		i++
		if len(f) < 3 {
			continue
		}
		path := f[2]
		if path == "" { // rename or copy: old and new follow as their own tokens
			if i+1 >= len(toks) {
				break
			}
			path = toks[i+1]
			i += 2
		}
		st := numstat{binary: f[0] == "-" && f[1] == "-"}
		st.add, _ = strconv.Atoi(f[0])
		st.del, _ = strconv.Atoi(f[1])
		stats[path] = st
	}
	return stats
}

// ReadCommitDetail reads a commit's metadata and diffstat for the hover card.
// ok is false for an unknown or malformed SHA.
func ReadCommitDetail(root, sha string) (CommitDetail, bool) {
	if !Available(root) || !ValidSHA(sha) {
		return CommitDetail{}, false
	}
	// %B is last: it spans lines, so everything past the final separator is it.
	out, err := exec.Command("git", "-C", root, "show", "-s",
		"--format=%H%x1f%h%x1f%an%x1f%ae%x1f%cr%x1f%cI%x1f%s%x1f%B", sha).Output()
	if err != nil {
		return CommitDetail{}, false
	}
	f := strings.SplitN(string(out), "\x1f", 8)
	if len(f) < 8 {
		return CommitDetail{}, false
	}
	d := CommitDetail{
		Hash: f[0], Short: f[1], Author: f[2], Email: f[3],
		Date: f[4], DateISO: f[5], Subject: f[6],
		Message: strings.TrimRight(f[7], "\n"),
	}
	d.Files, d.Insertions, d.Deletions = commitStat(root, sha)
	d.AuthorURL = githubAuthorURL(root, d.Email, d.Author)
	d.CommitURL = commitWebURL(root, d.Hash)
	return d, true
}

// commitStat sums a commit's numstat into files/insertions/deletions.
// Binary files count toward files but contribute no line counts, which is what
// git's own "--shortstat" does.
func commitStat(root, sha string) (files, insertions, deletions int) {
	if !ValidSHA(sha) {
		return 0, 0, 0
	}
	args := append([]string{"-C", root, "diff-tree", "--numstat"}, commitDiffArgs...)
	out, err := exec.Command("git", append(args, sha)...).Output()
	if err != nil {
		return 0, 0, 0
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 3 {
			continue
		}
		files++
		if add, err := strconv.Atoi(parts[0]); err == nil { // "-" for binary
			insertions += add
		}
		if del, err := strconv.Atoi(parts[1]); err == nil {
			deletions += del
		}
	}
	return files, insertions, deletions
}

// LogCommit represents a single commit in git log.
type LogCommit struct {
	Hash    string `json:"hash"`
	Full    string `json:"full"` // full SHA, what a pinned tab's ref is
	Subject string `json:"subject"`
	Author  string `json:"author"`
	Date    string `json:"date"`
}

// parseChangedFiles shares the NUL-delimited rename parser across diff readers.
func parseChangedFiles(out []byte, key func(string) (string, bool)) []CommitFile {
	var files []CommitFile
	// -z name-status emits "<status>\0<path>\0", or "<status>\0<src>\0<dst>\0"
	// for a rename or copy, so the field count per record varies.
	fields := strings.Split(string(out), "\x00")
	for i := 0; i < len(fields); i++ {
		st := fields[i]
		if st == "" {
			continue
		}
		letter := st[:1]
		rename := letter == "R" || letter == "C"
		if i+1 >= len(fields) {
			break
		}
		from, to := "", fields[i+1]
		i++
		if rename {
			if i+1 >= len(fields) {
				break
			}
			from, to = to, fields[i+1]
			i++
		}
		path, ok := key(to)
		if !ok {
			continue
		}
		f := CommitFile{Path: path, Status: letter}
		if from != "" {
			if fp, ok := key(from); ok {
				f.From = fp
			}
		}
		files = append(files, f)
	}
	return files
}
