package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"faah/internal/explain"
	"faah/internal/settings"
	"faah/internal/ui"
)

// How long prepared evidence stays usable. Short, because other files can
// change under it without the selection's own file changing.
const explainPreparedTTL = 30 * time.Second

// explainReader is the explain.reader setting: who is reading, in their words.
func explainReader() string {
	if cfg := settings.Read(); cfg.ExplainReader != nil {
		return strings.TrimSpace(*cfg.ExplainReader)
	}
	return ""
}

// explainHarness picks what runs an explanation: the explain.agent and
// explain.model settings when set, otherwise the harness selected for editing.
// A harness pinned with -agent is fixed for the run and wins over both.
func (tm *threadManager) explainHarness() (string, []string, string) {
	name, base, model := tm.agent.current()
	if tm.agent.Pinned() {
		return name, base, model
	}
	cfg := settings.Read()
	agent, want := "", ""
	if cfg.ExplainAgent != nil {
		agent = strings.TrimSpace(*cfg.ExplainAgent)
	}
	if cfg.ExplainModel != nil {
		want = strings.TrimSpace(*cfg.ExplainModel)
	}
	if agent == "" {
		agent = name
	}
	if agent == "" || (agent == name && want == "") {
		return name, base, model
	}
	if want == "" {
		want = tm.agent.modelFor(agent)
	}
	n, args, chosen, err := resolveAgentSpec(agent, want)
	if err != nil {
		ui.Status("err", "explain", fmt.Sprintf("explain.agent %q is unusable (%s); using %s", agent, err.Error(), name), 0, os.Stdout)
		return name, base, model
	}
	return n, args, chosen
}

// modelFor returns the model remembered for a harness, selected or not.
func (m *agentManager) modelFor(name string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.models[name]
}

// explainPrepared is evidence gathered ahead of the click, for one selection.
type explainPrepared struct {
	key       string
	done      chan struct{}
	cancel    context.CancelFunc
	cancelled bool // set under explainPrefetch.mu when a newer selection replaced it
	ev        explain.Evidence
	at        time.Time
}

// explainPrefetch holds at most one prepared selection. A new one cancels the
// one in flight, so a reader dragging a selection never queues work on the
// language server.
type explainPrefetch struct {
	mu      sync.Mutex
	cur     *explainPrepared
	gathers atomic.Int32 // how many times evidence was gathered; read by tests
}

// explainPrepareKey identifies a selection and the state of its file.
func explainPrepareKey(abs string, req explain.Request) string {
	h := sha256.New()
	col := func(c *int) int {
		if c == nil {
			return -1
		}
		return *c
	}
	fmt.Fprintf(h, "%s|%d|%d|%d|%d|", req.Path, req.L1, col(req.C1), req.L2, col(req.C2))
	if st, err := os.Stat(abs); err == nil {
		fmt.Fprintf(h, "%d|%d|", st.ModTime().UnixNano(), st.Size())
	}
	h.Write([]byte(req.Text))
	return hex.EncodeToString(h.Sum(nil))
}

func (s *Server) gatherExplainEvidence(ctx context.Context, target explain.Target, lines []string) explain.Evidence {
	s.explainPre.gathers.Add(1)
	return explain.Gather(ctx, explainWorkspace{s.lsp, s}, target, lines)
}

// prepareExplain starts gathering evidence in the background and returns at
// once. Asking again for the selection already prepared does nothing.
func (s *Server) prepareExplain(key string, target explain.Target, lines []string) {
	pre := &s.explainPre
	pre.mu.Lock()
	if cur := pre.cur; cur != nil {
		if cur.key == key && !cur.cancelled {
			select {
			case <-cur.done:
				if time.Since(cur.at) < explainPreparedTTL {
					pre.mu.Unlock()
					return
				}
			default:
				pre.mu.Unlock()
				return
			}
		}
		cur.cancelled = true
		cur.cancel()
	}
	ctx, cancel := context.WithTimeout(context.Background(), explain.Budget)
	p := &explainPrepared{key: key, done: make(chan struct{}), cancel: cancel}
	pre.cur = p
	pre.mu.Unlock()

	go func() {
		defer cancel()
		p.ev = s.gatherExplainEvidence(ctx, target, lines)
		p.at = time.Now()
		close(p.done)
	}()
}

// preparedExplain returns evidence prepared for key, waiting for it if it is
// still being gathered. It reports false when there is none worth using.
func (s *Server) preparedExplain(ctx context.Context, key string) (explain.Evidence, bool) {
	pre := &s.explainPre
	pre.mu.Lock()
	p := pre.cur
	pre.mu.Unlock()
	if p == nil || p.key != key {
		return explain.Evidence{}, false
	}
	select {
	case <-p.done:
	case <-ctx.Done():
		return explain.Evidence{}, false
	}
	pre.mu.Lock()
	cancelled := p.cancelled
	pre.mu.Unlock()
	if cancelled || time.Since(p.at) > explainPreparedTTL {
		return explain.Evidence{}, false
	}
	return p.ev, true
}

// handleExplainPrepare serves POST /api/explain/prepare. The client sends it
// when a selection settles, so the evidence is ready by the time the reader
// asks. It never waits on the language server.
func (s *Server) handleExplainPrepare(w http.ResponseWriter, r *http.Request) {
	if !localPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	if cfg := settings.Read(); cfg.ExplainPrefetch != nil && !*cfg.ExplainPrefetch {
		writeJSON(w, map[string]any{"prepared": false})
		return
	}
	var req explain.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, 400, "bad request")
		return
	}
	target, lines, key, _, err := s.explainTarget(&req)
	if err != nil { // nothing to prepare; Explain itself reports why
		writeJSON(w, map[string]any{"prepared": false})
		return
	}
	s.prepareExplain(key, target, lines)
	writeJSON(w, map[string]any{"prepared": true})
}
