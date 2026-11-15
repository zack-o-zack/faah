package threads_test

import (
	"strings"
	"testing"

	"faah/internal/forge"
	"faah/internal/git"
	"faah/internal/threads"
)

func TestMergeMessagePrompt(t *testing.T) {
	meta := forge.PRMeta{Number: 3, Title: "Fix race", BaseRef: "main", HeadRef: "fix"}
	p := threads.MergeMessagePrompt(forge.MergeMethodSquash, meta, []git.UnpushedCommit{{Subject: "fixup"}, {Subject: "fix the race"}}, "a.go | 2 +-", "diff --git", "Fix race (#3)", []string{"Follow Conventional Commits", "Mention ticket PX-9"})
	for _, want := range []string{"squash-merging pull request #3", "Follow Conventional Commits", "Mention ticket PX-9", "rewriting", "Fix race (#3)", "- fix the race\n- fixup", "Output ONLY"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q:\n%s", want, p)
		}
	}
}

func TestGitSyncPromptPR(t *testing.T) {
	st := git.SyncState{PR: 9, Branch: "feat", Upstream: "main", Ahead: 2, Behind: 5, OntoRef: "refs/faah/base/9"}
	p := threads.SyncPrompt("rebase", st)
	for _, want := range []string{"Pull request #9", "git rebase refs/faah/base/9", "do not run git fetch", "do not push"} {
		if !strings.Contains(p, want) {
			t.Errorf("rebase prompt missing %q:\n%s", want, p)
		}
	}
	if strings.Contains(p, "git fetch refs") {
		t.Errorf("prompt asks the harness to fetch:\n%s", p)
	}
	if p := threads.SyncPrompt("merge", st); !strings.Contains(p, `Merge branch 'main' into feat`) || !strings.Contains(p, "refs/faah/base/9") {
		t.Errorf("merge prompt:\n%s", p)
	}
}
