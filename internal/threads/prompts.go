package threads

import (
	"fmt"
	"path/filepath"
	"strings"

	"faah/internal/explain"
	"faah/internal/explain/notes"
	"faah/internal/forge"
	"faah/internal/git"
)

// CommitMessagePrompt asks the harness to write a commit message for the
// staged changes. instruction is the user's git.commitMessageInstruction
// setting (empty when unset), appended verbatim so it can refine or override
// the base convention below.
func CommitMessagePrompt(files []string, stat, diff, instruction string) string {
	var b strings.Builder
	b.WriteString("Write a git commit message for the staged changes below.\n")
	b.WriteString("Rules: imperative mood, a concise summary line under 72 characters, a blank line before an optional body, and explain why rather than just what changed.\n")
	b.WriteString("Output ONLY the commit message text -- no markdown code fences, no preamble, no explanation afterwards, and do not edit any files.\n")
	if instruction != "" {
		fmt.Fprintf(&b, "\nAdditional instructions from the user: %s\n", instruction)
	}
	if len(files) > 0 {
		fmt.Fprintf(&b, "\nChanged files (%d):\n", len(files))
		maxFiles := 100
		for i, f := range files {
			if i >= maxFiles {
				fmt.Fprintf(&b, "... and %d more files\n", len(files)-maxFiles)
				break
			}
			fmt.Fprintf(&b, "- %s\n", f)
		}
	}
	if strings.TrimSpace(stat) != "" {
		b.WriteString("\nSummary of changes (diffstat):\n")
		b.WriteString(stat)
		b.WriteString("\n")
	}
	if strings.TrimSpace(diff) != "" {
		b.WriteString("\nStaged diff:\n")
		b.WriteString(diff)
		b.WriteString("\n")
	}
	return b.String()
}

// SyncPrompt asks the harness to rebase (or merge) the current branch
// onto its upstream after a fast-forward-only pull was refused, or to finish
// one a previous attempt left half-done. It may run git and edit conflicted
// files, but must never push: what reaches the remote stays the user's call.
func SyncPrompt(strategy string, st git.SyncState) string {
	// A PR's base is fetched by faah itself, with the forge token, into a ref
	// of its own; the harness works against that ref and must not fetch.
	onto, prefetched := st.Upstream, st.OntoRef != ""
	if prefetched {
		onto = st.OntoRef
	}
	remote, _, _ := strings.Cut(st.Upstream, "/")
	var b strings.Builder
	switch {
	case st.InProgress != "":
		fmt.Fprintf(&b, "A git %s of branch %s onto %s is in progress and stopped, most likely on conflicts. Finish it.\n\n", strategy, st.Branch, onto)
	case st.PR > 0:
		fmt.Fprintf(&b, "Pull request #%d (branch %s, checked out here as a detached HEAD) is out of date with its base branch %s: %d commit(s) on the PR, %d new on %s since it branched. Bring it up to date by running %s against %s, which holds %s's latest commits.\n\n", st.PR, st.Branch, st.Upstream, st.Ahead, st.Behind, st.Upstream, strategy, onto, st.Upstream)
	default:
		fmt.Fprintf(&b, "git pull is failing on branch %s: it can't fast-forward onto %s (%d local commit(s) not upstream, %d incoming). Run %s.\n\n", st.Branch, st.Upstream, st.Ahead, st.Behind, strategy)
	}
	b.WriteString("Steps:\n")
	if strategy == "rebase" {
		switch {
		case st.InProgress != "":
			b.WriteString("1. Run git status to see where the rebase stopped.\n")
		case prefetched:
			fmt.Fprintf(&b, "1. git rebase %s (already fetched: do not run git fetch or git pull).\n", onto)
		default:
			fmt.Fprintf(&b, "1. git fetch %s, then git rebase %s.\n", remote, st.Upstream)
		}
		b.WriteString("2. For each conflict, read both sides and resolve it so the intent of both the local and the incoming change survives. Remove every conflict marker, git add the files, and run GIT_EDITOR=true git rebase --continue. Repeat until the rebase completes.\n")
		b.WriteString("3. Never use git rebase --skip: it silently drops a local commit.\n")
	} else {
		switch {
		case st.InProgress != "":
			b.WriteString("1. Run git status to see which files are still conflicted.\n")
		case prefetched:
			fmt.Fprintf(&b, "1. git merge --no-edit -m \"Merge branch '%s' into %s\" %s (already fetched: do not run git fetch or git pull).\n", st.Upstream, st.Branch, onto)
		default:
			fmt.Fprintf(&b, "1. git fetch %s, then git merge --no-edit %s.\n", remote, st.Upstream)
		}
		b.WriteString("2. For each conflict, read both sides and resolve it so the intent of both the local and the incoming change survives. Remove every conflict marker, git add the files, and run git commit --no-edit to conclude the merge.\n")
	}
	fmt.Fprintf(&b, "\nRules: do not push or force-push. Do not reset, amend, or rewrite commits beyond what the %s itself does. Do not touch files that are not part of a conflict.\n", strategy)
	fmt.Fprintf(&b, "If a conflict cannot be resolved with confidence, run git %s --abort so the branch is back where it started, and say which files and why.\n", strategy)
	b.WriteString("Finish with a short summary: the conflicts you resolved (file and how), or that there were none.\n")
	return b.String()
}

// MergeMessagePrompt asks the harness for the commit message a squash (or a
// merge commit) of a PR lands on its base branch with. Like
// CommitMessagePrompt it only writes text: no files, no git. draft is the
// message as it stands in the merge dialog, rewritten rather than ignored.
// commits is newest first.
func MergeMessagePrompt(method string, meta forge.PRMeta, commits []git.UnpushedCommit, stat, diff, draft string, instructions []string) string {
	var b strings.Builder
	if method == forge.MergeMethodSquash {
		fmt.Fprintf(&b, "Write the commit message for squash-merging pull request #%d (%q) into %s: its %d commit(s) become this one commit.\n", meta.Number, meta.Title, meta.BaseRef, len(commits))
		b.WriteString("Rules: imperative mood, a concise summary line under 72 characters, a blank line, then a body explaining why the change was made and what it does overall. Describe the end result, not the PR's history: leave out fixups, review rounds and reverted attempts.\n")
	} else {
		fmt.Fprintf(&b, "Write the merge commit message for merging pull request #%d (%q) from %s into %s.\n", meta.Number, meta.Title, meta.HeadRef, meta.BaseRef)
		b.WriteString("Rules: a concise summary line under 72 characters naming what the merge brings in, a blank line, then a short body summarizing the change.\n")
	}
	b.WriteString("Output ONLY the commit message text -- no markdown code fences, no preamble, no explanation afterwards, and do not edit any files or run git.\n")
	for _, in := range instructions {
		fmt.Fprintf(&b, "\nAdditional instructions from the user: %s\n", in)
	}
	if draft != "" {
		b.WriteString("\nThe current message, which you are rewriting (keep what is accurate and useful):\n")
		b.WriteString(draft)
		b.WriteString("\n")
	}
	if len(commits) > 0 {
		fmt.Fprintf(&b, "\nCommits on the PR (%d, oldest first):\n", len(commits))
		for i := len(commits) - 1; i >= 0; i-- {
			fmt.Fprintf(&b, "- %s\n", commits[i].Subject)
		}
	}
	if strings.TrimSpace(stat) != "" {
		b.WriteString("\nSummary of changes (diffstat):\n")
		b.WriteString(stat)
		b.WriteString("\n")
	}
	if strings.TrimSpace(diff) != "" {
		b.WriteString("\nDiff:\n")
		b.WriteString(diff)
		b.WriteString("\n")
	}
	return b.String()
}

// threadPrompt composes what the harness is told for one turn. The anchor and
// ground rules go in only when the harness has no memory of them: the first
// turn, or recovery in a new native session.
func threadPrompt(t *Thread, prior []*Turn, message string, replay bool, prCtx string, scopeChanged bool) string {
	var b strings.Builder
	if len(prior) == 0 || replay {
		if t.Kind == "explain" {
			b.WriteString(explain.Instructions(t.ExplainKind, t.ExplainReader))
			b.WriteString(notes.Prompt())
		} else if t.Kind == "edit" || t.Kind == "batch" {
			b.WriteString("Carry out the edit request below by editing files in place. ")
			b.WriteString("Change only what it asks for; you may touch other files if the change needs it. ")
			b.WriteString("When done, reply in a sentence or two saying what you changed and in which files. ")
			b.WriteString("The user may follow up in this conversation.\n\n")
		} else {
			b.WriteString("You are helping with a long-running conversation about the code in this workspace. ")
			b.WriteString("You may read any file and edit any file needed to carry out what is asked; make edits directly. ")
			b.WriteString("When you finish a request, reply with a concise summary: what you found or changed, and in which files.\n\n")
		}
		if prCtx != "" {
			b.WriteString(prCtx)
			b.WriteString("\n\n")
		}
		if t.Kind == "explain" {
			b.WriteString(t.packet)
			b.WriteString("\n\n")
		} else if t.Path != "" && t.Kind != "batch" { // a batch carries its own snippets
			ext := strings.TrimPrefix(filepath.Ext(t.Path), ".")
			lineStr := fmt.Sprintf("lines %d-%d", t.L1, t.L2)
			if t.L1 == t.L2 {
				lineStr = fmt.Sprintf("line %d", t.L1)
			}
			fmt.Fprintf(&b, "The conversation started at @%s %s (the file may have changed since):\n```%s\n%s\n```\n\n", t.Path, lineStr, ext, t.Snippet)
		}
	}
	if replay && len(prior) > 0 {
		var h strings.Builder
		for _, tr := range prior {
			fmt.Fprintf(&h, "User: %s\n\nAssistant: %s\n\n", tr.Prompt, strings.TrimSpace(tr.Reply))
			if shown := notes.History(tr.Notes, tr.Walkthroughs); shown != "" {
				h.WriteString(shown + "\n")
			}
			if len(tr.Changed) > 0 {
				fmt.Fprintf(&h, "(files changed in that turn: %s)\n\n", strings.Join(tr.Changed, ", "))
			}
		}
		hist := h.String()
		if len(hist) > threadReplayMax {
			hist = "…" + hist[len(hist)-threadReplayMax:]
		}
		b.WriteString("### Earlier in this conversation\n")
		b.WriteString(hist)
		b.WriteString("### Current request\n")
	}
	if scopeChanged && prCtx != "" && len(prior) > 0 && !replay {
		b.WriteString("The user has changed what this conversation is about. ")
		b.WriteString(prCtx)
		b.WriteString("\n\n")
	}
	if t.Kind == "edit" && len(prior) == 0 {
		b.WriteString("### Instruction\n")
	}
	b.WriteString(message)
	return b.String()
}

func anchorSnippet(abs string, l1, l2 int) string {
	snip, err := readLineRange(abs, l1, l2)
	if err != nil {
		return ""
	}
	if len(snip) > threadSnippetMax {
		snip = snip[:threadSnippetMax] + "\n…"
	}
	return snip
}
