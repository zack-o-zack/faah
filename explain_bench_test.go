//go:build harness

package main

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// Times real explanations of fixed selections in this repository, once per
// harness and model named in FAAH_EXPLAIN_BENCH ("claude:haiku,claude:,agy:").
// It makes real model calls, so it only runs when that variable is set.
//
//	FAAH_EXPLAIN_BENCH=claude:haiku,agy: go test -tags harness -run TestExplainBenchmark -timeout 20m -v .
func TestExplainBenchmark(t *testing.T) {
	spec := os.Getenv("FAAH_EXPLAIN_BENCH")
	if spec == "" {
		t.Skip("FAAH_EXPLAIN_BENCH is not set")
	}
	verifyHarnesses(t, "claude", "codex", "cursor-agent", "agy")
	isolateSettings(t)
	root, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	selections := []struct{ label, path, find, text string }{
		{"symbol", "main.go", "ix := NewIndex(root)", "NewIndex"},
		{"block", "explain_refs.go", "func explainLabelName(label string) string {", ""},
	}

	var mu sync.Mutex
	var rows []string
	var wg sync.WaitGroup
	for _, cfg := range strings.Split(spec, ",") {
		name, model, _ := strings.Cut(strings.TrimSpace(cfg), ":")
		wg.Add(1)
		go func() {
			defer wg.Done()
			m, err := newAgentManager(root, "", nil)
			if err != nil {
				t.Error(err)
				return
			}
			if n, args, chosen, err := resolveAgentSpec(name, model); err != nil {
				t.Errorf("%s: %v", cfg, err)
				return
			} else {
				m.selected, m.args, m.pinned = n, args, true
				m.models[n] = chosen
			}
			ix := NewIndex(root)
			ix.Build()
			s := NewServer(ix, newLSPManager(root, true))
			s.SetAgent(m)
			s.threads.file = ""
			defer func() {
				if s.gitWatcher != nil {
					s.gitWatcher.Stop()
				}
				s.lsp.Close()
			}()
			for _, sel := range selections {
				lines, err := explainReadLines(root + "/" + sel.path)
				if err != nil {
					t.Error(err)
					return
				}
				req := map[string]any{"path": sel.path}
				for i, l := range lines {
					if !strings.Contains(l, sel.find) {
						continue
					}
					if sel.text != "" {
						c := utf16Len(l[:strings.Index(l, sel.text)])
						req["l1"], req["l2"], req["c1"], req["c2"], req["text"] = i+1, i+1, c, c+len(sel.text), sel.text
					} else {
						end := i
						for end < len(lines) && lines[end] != "}" {
							end++
						}
						req["l1"], req["l2"], req["text"] = i+1, end+1, strings.Join(lines[i:end+1], "\n")
					}
					break
				}
				started := time.Now()
				code, res := agentPostJSON(t, s, "/api/explain", req)
				if code != 200 {
					t.Errorf("%s %s: explain = %d %v", cfg, sel.label, code, res)
					continue
				}
				gather := time.Since(started)
				th := waitHarnessIdle(t, s, res["thread"].(map[string]any)["id"].(string))
				turn := th.Turns[0]
				mu.Lock()
				rows = append(rows, fmt.Sprintf("%-22s %-7s evidence %5.1fs  first words %6.1fs  total %6.1fs  steps %2d  refs %d  %s  err=%q",
					cfg, sel.label, gather.Seconds(), float64(turn.FirstMs)/1000, float64(turn.Ms)/1000, len(turn.Tools), len(turn.Refs), th.Evidence.Source, turn.Error))
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	for _, r := range rows {
		t.Log(r)
	}
}
