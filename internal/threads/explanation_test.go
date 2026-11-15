package threads

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"faah/internal/codeintel"
	"faah/internal/explain"
	"faah/internal/explain/notes"
)

const testExplainKeep = 200

func TestExplainPruneKeepsFollowUps(t *testing.T) {
	isolateSettings(t)
	root := t.TempDir()
	m, err := testJobs(root, ""), error(nil)
	if err != nil {
		t.Fatal(err)
	}
	tm := testManager(m, root)
	add := func(id string, created int64, turns int) {
		th := &Thread{ID: id, Kind: "explain", Created: created}
		for i := 0; i < turns; i++ {
			th.Turns = append(th.Turns, &Turn{ID: i + 1})
		}
		tm.threads[id] = th
		tm.writeExplainPacket(id, "packet")
	}
	add("old-followed", 1, 2)
	add("old-single", 2, 1)
	for i := 0; i < testExplainKeep; i++ {
		add("new"+codeintel.LineRef(i, i), int64(100+i), 1)
	}
	tm.mu.Lock()
	tm.pruneExplainLocked(testExplainKeep)
	tm.mu.Unlock()
	if tm.threads["old-single"] != nil {
		t.Fatal("an old explanation without follow-ups should be pruned")
	}
	if tm.threads["old-followed"] == nil {
		t.Fatal("an old explanation with follow-ups should stay")
	}
	if _, err := os.Stat(tm.explainPacketPath("old-single")); !os.IsNotExist(err) {
		t.Fatalf("pruned packet should be removed, stat err = %v", err)
	}
}

func TestExplainPromptNamesTheTools(t *testing.T) {
	th := &Thread{Kind: "explain", ExplainKind: explain.KindBlock}
	if p := threadPrompt(th, nil, "Explain main.go:1-2", false, "", false); !strings.Contains(p, "two tools, annotate and walkthrough") {
		t.Fatalf("MCP prompt = %s", p)
	}
	if p := threadPrompt(&Thread{}, nil, "hi", false, "", false); strings.Contains(p, "annotate") {
		t.Fatal("only explanations are told about the tools")
	}
}

// Saved threads keep their explanation key under the name they always had.
func TestExplainKeySavedName(t *testing.T) {
	b, _ := json.Marshal(&Thread{ExplainKey: "k"})
	if !strings.Contains(string(b), `"explainKey":"k"`) {
		t.Fatalf("thread JSON = %s", b)
	}
}

func TestExplainReplayCarriesWhatWasShown(t *testing.T) {
	th := &Thread{Kind: "explain", ExplainKind: explain.KindBlock}
	prior := []*Turn{{Prompt: "Explain", Reply: "See the notes.",
		Notes:        []notes.Note{{Kind: "line", Path: "main.go", L1: 4, L2: 4, Summary: "Calls helper."}},
		Walkthroughs: []notes.Walkthrough{{Title: "Flow", Steps: []notes.Step{{Path: "main.go", L1: 3, L2: 5, Title: "Main", Body: "Starts."}, {Path: "main.go", L1: 7, L2: 7, Title: "Helper", Body: "Ends."}}}},
	}}
	p := threadPrompt(th, prior, "expand step 2", true, "", false)
	for _, want := range []string{"- line main.go:4: Calls helper.", `(walkthrough shown, "Flow":`, "2. main.go:7 Helper: Ends."} {
		if !strings.Contains(p, want) {
			t.Fatalf("replay lacks %q:\n%s", want, p)
		}
	}
}
