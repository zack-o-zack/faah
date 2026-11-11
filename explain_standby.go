package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/all"
	"faah/internal/settings"
	"faah/internal/ui"

	"github.com/px0-ai/harness"
)

// A harness spends seconds starting before it asks the model anything: about
// 2.5s for claude and 10s for agy here. Explain keeps one started ahead of
// time with the argv its next first turn would run, minus the prompt, and the
// turn hands the prompt over on stdin. claude and agy both read it there.

const (
	explainStandbyIdle  = 10 * time.Minute // unused this long, the standby is stopped
	explainStandbyDelay = 5 * time.Second  // after faah starts, so it does not compete with indexing
	explainStandbyRetry = time.Minute      // after a standby exits on its own
	explainStandbyBuf   = 1 << 20          // output held before a turn takes over
)

// explainStandby holds at most one started harness.
type explainStandby struct {
	mu     sync.Mutex
	cur    *standbyProc
	failed time.Time    // when a standby last exited before it was used
	starts atomic.Int32 // how many were started; read by tests
}

type standbyProc struct {
	key            string // harness and read-only argv a turn would run with
	agent          agents.Warmable
	sessionID      string // claude's, chosen at start; agy reports its own
	cmd            *exec.Cmd
	stdin          io.WriteCloser
	stdout, stderr *handoffWriter
	exited         chan struct{}
	err            error // the exit, set before exited closes
	idle           *time.Timer
}

func standbyKey(name string, argv []string) string {
	return name + "\x00" + strings.Join(argv, "\x00")
}

// warmExplain makes sure a standby is waiting for the explain harness as it is
// configured now, replacing one started for another. Starting one forks a
// process, so callers run this in its own goroutine.
func (tm *threadManager) warmExplain() {
	sb := &tm.standby
	if cfg := settings.Read(); cfg.ExplainWarmup != nil && !*cfg.ExplainWarmup {
		sb.stop()
		return
	}
	name, base, _ := tm.explainHarness()
	w, ok := all.For(name).(agents.Warmable)
	if base == nil || !ok {
		sb.stop()
		return
	}
	ro, _, err := w.ReadOnly(base)
	if err != nil {
		sb.stop()
		return
	}
	key := standbyKey(name, ro)

	sb.mu.Lock()
	defer sb.mu.Unlock()
	if sp := sb.cur; sp != nil {
		if sp.key == key && sp.alive() {
			sp.idle.Reset(explainStandbyIdle)
			return
		}
		sp.kill()
		sb.cur = nil
	}
	if time.Since(sb.failed) < explainStandbyRetry {
		return
	}
	sessionID := w.NewSession(context.Background(), tm.root, ro)
	sp, err := startStandby(tm.root, w, key, sessionID, w.StdinArgv(w.TurnArgv(agents.Turn{Argv: ro, SessionID: sessionID})))
	if err != nil {
		sb.failed = time.Now()
		ui.Status("err", "explain", "could not start "+name+" ahead: "+err.Error(), 0, os.Stdout)
		return
	}
	sb.starts.Add(1)
	sb.cur = sp
	sp.idle = time.AfterFunc(explainStandbyIdle, func() {
		sb.mu.Lock()
		defer sb.mu.Unlock()
		if sb.cur == sp {
			sb.cur = nil
			sp.kill()
		}
	})
	go func() {
		<-sp.exited
		sb.mu.Lock()
		defer sb.mu.Unlock()
		if sb.cur == sp { // exited on its own, unused
			sb.cur = nil
			sb.failed = time.Now()
			ui.Status("err", "explain", fmt.Sprintf("%s started ahead exited: %v", name, sp.err), 0, os.Stdout)
		}
	}()
	if ui.Verbose {
		ui.Status("info", "explain", name+" started ahead for the next explanation", 0, os.Stdout)
	}
}

// take hands over the standby when it was started for key and is still running.
func (sb *explainStandby) take(key string) *standbyProc {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	sp := sb.cur
	if sp == nil || sp.key != key || !sp.alive() {
		return nil
	}
	sb.cur = nil
	sp.idle.Stop()
	return sp
}

func (sb *explainStandby) stop() {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	if sb.cur != nil {
		sb.cur.idle.Stop()
		sb.cur.kill()
		sb.cur = nil
	}
}

func startStandby(dir string, w agents.Warmable, key, sessionID string, argv []string) (*standbyProc, error) {
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.WaitDelay = 2 * time.Second // do not wait forever on output pipes held open by children
	standbyGroup(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	sp := &standbyProc{
		key: key, agent: w, sessionID: sessionID, cmd: cmd, stdin: stdin,
		stdout: &handoffWriter{}, stderr: &handoffWriter{}, exited: make(chan struct{}),
	}
	cmd.Stdout, cmd.Stderr = sp.stdout, sp.stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	go func() {
		sp.err = cmd.Wait()
		close(sp.exited)
	}()
	return sp, nil
}

func (sp *standbyProc) alive() bool {
	select {
	case <-sp.exited:
		return false
	default:
		return true
	}
}

func (sp *standbyProc) kill() {
	if sp.alive() {
		standbyKill(sp.cmd)
	}
}

// run gives the standby its prompt and waits for the turn to end, reporting
// the end the way harness.Run does.
func (sp *standbyProc) run(ctx context.Context, prompt string, stdout, stderr io.Writer, timeout time.Duration) error {
	sp.stdout.attach(stdout)
	sp.stderr.attach(stderr)
	go func() { // a harness that stops reading must not hold the turn here
		sp.stdin.Write(sp.agent.StdinMessage(prompt))
		sp.stdin.Close()
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-sp.exited:
		return sp.err
	case <-ctx.Done():
		sp.kill()
		<-sp.exited
		return harness.ErrCancelled
	case <-timer.C:
		sp.kill()
		<-sp.exited
		return fmt.Errorf("gave up after %s", timeout)
	}
}

// handoffWriter holds a standby's output until a turn takes it over, then
// passes the held output, and everything after it, to the turn.
type handoffWriter struct {
	mu  sync.Mutex
	buf []byte
	w   io.Writer
}

func (h *handoffWriter) Write(p []byte) (int, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.w != nil {
		return h.w.Write(p)
	}
	if len(h.buf)+len(p) <= explainStandbyBuf {
		h.buf = append(h.buf, p...)
	}
	return len(p), nil
}

func (h *handoffWriter) attach(w io.Writer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.buf) > 0 {
		w.Write(h.buf)
		h.buf = nil
	}
	h.w = w
}
