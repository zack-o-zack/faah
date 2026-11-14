package threads

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/px0-ai/harness"

	"faah/internal/agents"
	"faah/internal/git"
	"faah/internal/processio"
	"faah/internal/ui"
)

const (
	jobTimeout  = harness.DefaultTimeout
	jobLogBytes = harness.DefaultLogBytes
)

var ErrNoAgent = errors.New("no coding harness is selected")

type Hooks struct {
	PRContext func(scope string) string
	AfterEdit func(changed []string)
}

// Jobs owns background edit jobs and their shared sequence.
type Jobs struct {
	root         string
	version      string
	current      func() (string, []string, string)
	openAgent    func(string) agents.Agent
	mu           sync.Mutex
	jobs         map[int64]*Job
	seq          int64
	hooks        Hooks
	threadJob    func(int64) *Job
	threadCancel func(int64) bool
}

// NewJobs wires the host's agent selection and file invalidation effects.
func NewJobs(root, version string, current func() (string, []string, string), openAgent func(string) agents.Agent) *Jobs {
	return &Jobs{root: root, version: version, current: current, openAgent: openAgent}
}

// SetHooks supplies the host's file invalidation effects.
func (m *Jobs) SetHooks(hooks Hooks) { m.hooks = hooks }

// BindThreads connects inline edits to the shared job lookup and cancellation.
func (m *Jobs) BindThreads(job func(int64) *Job, cancel func(int64) bool) {
	m.threadJob, m.threadCancel = job, cancel
}

// BatchItem represents one instruction anchored to a file range.
type BatchItem struct {
	Abs         string `json:"-"`
	Path        string `json:"path"`
	L1          int    `json:"l1"`
	L2          int    `json:"l2"`
	Instruction string `json:"instruction"`
}

// Job represents a single background editing task dispatched to an AI coding harness.
// It tracks real-time progress, log outputs, duration, affected files, and cancellation handlers.
type Job struct {
	ID         int64       `json:"id"`                   // Unique monotonic job identifier
	Harness    string      `json:"harness"`              // Name of the harness executing this job
	Path       string      `json:"path"`                 // Relative file path targeted for editing
	Lines      string      `json:"lines"`                // Line range formatted string (e.g. "L12-L30")
	Running    bool        `json:"running"`              // True while harness process is actively executing
	Error      string      `json:"error,omitempty"`      // Error message if the job failed or was aborted
	Log        string      `json:"log"`                  // Tail of merged stdout/stderr log output
	Stdout     string      `json:"stdout,omitempty"`     // Stdout log output tail
	Stderr     string      `json:"stderr,omitempty"`     // Stderr log output tail
	Changed    []string    `json:"changed"`              // Files detected as modified after job execution
	Ms         int64       `json:"ms"`                   // Elapsed runtime in milliseconds
	Tracked    bool        `json:"tracked"`              // Whether telemetry tracking has been recorded
	ThreadID   string      `json:"threadId,omitempty"`   // The thread this edit runs as, when it runs as one
	BatchCount int         `json:"batchCount,omitempty"` // Number of items in batch review edit
	Items      []BatchItem `json:"items,omitempty"`      // Detailed batch items if multi-file edit

	cancel context.CancelFunc
	out    *processio.TailBuffer
	stderr *processio.TailBuffer
	start  time.Time
}

// lineStreamer forwards complete lines to w with a prefix in real time,
// while also storing the raw bytes into a processio.TailBuffer.
type lineStreamer struct {
	mu     sync.Mutex
	buf    *processio.TailBuffer
	prefix string
	line   []byte
	w      io.Writer
}

func newLineStreamer(buf *processio.TailBuffer, prefix string, w io.Writer) *lineStreamer {
	return &lineStreamer{buf: buf, prefix: prefix, w: w}
}

func (s *lineStreamer) Write(p []byte) (int, error) {
	if s.buf != nil {
		s.buf.Write(p)
	}
	if s.w == nil || ui.Quiet {
		return len(p), nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, b := range p {
		if b == '\n' {
			if len(s.line) > 0 {
				fmt.Fprintf(s.w, "  %s %s\n", s.prefix, string(s.line))
				s.line = s.line[:0]
			}
		} else if b != '\r' {
			s.line = append(s.line, b)
		}
	}
	return len(p), nil
}

func (s *lineStreamer) Flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.line) > 0 && s.w != nil && !ui.Quiet {
		fmt.Fprintf(s.w, "  %s %s\n", s.prefix, string(s.line))
		s.line = s.line[:0]
	}
}

// Job returns a snapshot of job id, or of the most recently started job when
// id is 0, or nil when there isn't one.
func (m *Jobs) Job(id int64) *Job {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	j := m.jobs[id]
	if id == 0 {
		for _, cand := range m.jobs {
			if j == nil || cand.ID > j.ID {
				j = cand
			}
		}
	}
	var cp *Job
	if j != nil {
		c := *j
		c.Log = j.out.String()
		c.Stdout = c.Log
		if j.stderr != nil {
			c.Stderr = j.stderr.String()
		}
		if c.Running {
			c.Ms = time.Since(j.start).Milliseconds()
		}
		cp = &c
	}
	lookup := m.threadJob
	m.mu.Unlock()

	// Inline and batch edits run as threads and share this id space, so one
	// poll endpoint serves both. Asked for the latest, the newer of the two wins.
	if lookup != nil {
		if tj := lookup(id); tj != nil && (cp == nil || tj.ID > cp.ID) {
			return tj
		}
	}
	return cp
}

// NextJobID hands out an id from the sequence every job shares.
func (m *Jobs) NextJobID() int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq++
	return m.seq
}

// StartPrompt dispatches a one-shot prompt to the selected harness with no
// target file -- used for generating text (e.g. a commit message) rather
// than editing code. There is no file range to anchor an overlap check
// against, so a prompt job is never blocked by, or blocks, a file edit.
func (m *Jobs) StartPrompt(label, prompt string) (*Job, error) {
	name, args, model := m.current()
	m.mu.Lock()
	if args == nil {
		m.mu.Unlock()
		ui.Status("err", "agent", "prompt dispatch refused: no coding harness selected", 0, os.Stdout)
		return nil, ErrNoAgent
	}
	m.seq++
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	job := &Job{
		ID:      m.seq,
		Harness: name,
		Path:    label,
		Running: true,
		Changed: []string{},
		Tracked: git.Available(m.root),
		out:     processio.NewTailBuffer(jobLogBytes),
		stderr:  processio.NewTailBuffer(jobLogBytes),
		start:   time.Now(),
		cancel:  cancel,
	}
	if m.jobs == nil {
		m.jobs = map[int64]*Job{}
	}
	m.jobs[job.ID] = job
	modelStr := ""
	if model != "" {
		modelStr = fmt.Sprintf(" (%s)", model)
	}
	m.mu.Unlock()

	ui.Status("step", "agent", fmt.Sprintf("#%d %s%s · %s", job.ID, name, modelStr, label), 0, os.Stdout)

	go m.run(ctx, cancel, job, args, model, prompt)
	return m.Job(job.ID), nil
}

func (m *Jobs) run(ctx context.Context, cancel context.CancelFunc, job *Job, base []string, model, prompt string) {
	defer cancel()
	defer func() {
		m.mu.Lock()
		job.Running = false
		job.Ms = time.Since(job.start).Milliseconds()
		if job.cancel != nil {
			job.cancel = nil
		}
		m.mu.Unlock()
	}()

	if ui.Verbose {
		ui.VerbosePrompt(job.ID, job.Harness, prompt, os.Stdout)
	}

	before := WorktreeSnapshot(m.root)

	stdoutStreamer := newLineStreamer(job.out, ui.Faint("│", os.Stdout), os.Stdout)
	stderrStreamer := newLineStreamer(job.stderr, ui.Dim("│", os.Stdout), os.Stdout)

	a := m.openAgent(job.Harness)
	session, err := a.Open(ctx, agents.Open{Key: fmt.Sprintf("edit-%d", job.ID), Version: m.version, Dir: m.root, Base: base, Model: model, Mode: agents.ModeEdit, Stderr: stderrStreamer})
	if err == nil {
		defer session.Close()
		_, err = session.Prompt(ctx, prompt, &writerSink{Writer: stdoutStreamer})
	}
	stdoutStreamer.Flush()
	stderrStreamer.Flush()

	changed := ChangedSince(m.root, before)
	m.Settle(changed)

	m.mu.Lock()
	job.Running = false
	job.Changed = changed
	job.Ms = time.Since(job.start).Milliseconds()
	if err != nil {
		job.Error = err.Error()
	}
	stdoutOutput := job.out.String()
	stderrOutput := job.stderr.String()
	m.mu.Unlock()

	durStr := ui.FmtDuration(time.Duration(job.Ms) * time.Millisecond)
	if err != nil {
		ui.Status("err", "agent", fmt.Sprintf("#%d %s failed in %s: %s", job.ID, job.Harness, durStr, err.Error()), 0, os.Stdout)
		if trimmedErr := strings.TrimSpace(stderrOutput); trimmedErr != "" {
			ui.KV("harness stderr", trimmedErr, 0, os.Stdout)
		}
		if trimmedOut := strings.TrimSpace(stdoutOutput); trimmedOut != "" {
			ui.KV("harness stdout", trimmedOut, 0, os.Stdout)
		}
	} else {
		var summary string
		switch len(changed) {
		case 0:
			summary = "no files changed"
		case 1:
			summary = fmt.Sprintf("1 file changed: %s", changed[0])
		default:
			summary = fmt.Sprintf("%d files changed: %s", len(changed), strings.Join(changed, ", "))
		}
		ui.Status("ok", "agent", fmt.Sprintf("#%d %s · %s  (%s)", job.ID, job.Harness, durStr, summary), 0, os.Stdout)
		if len(changed) == 0 && job.Tracked {
			if trimmedErr := strings.TrimSpace(stderrOutput); trimmedErr != "" {
				ui.KV("harness stderr", trimmedErr, 0, os.Stdout)
			}
		}
	}
}

// Settle drops every trace of the old bytes. Open memoises on path+mtime+size
// so a rewritten file already misses the cache, but a harness that truncates
// and writes in place can be read mid-write, and that torn copy would then sit
// under a key nothing invalidates. Evicting is cheaper than reasoning about it.
// Language servers hold their own copy of the file and never saw the write, so
// they are closed here too and reopen on the next request.
func (m *Jobs) Settle(changed []string) {
	if m.hooks.AfterEdit != nil {
		m.hooks.AfterEdit(changed)
	}
}

// Cancel stops every harness currently running. Whatever each has already
// written stays.
func (m *Jobs) Cancel() bool {
	return m.CancelJob(0)
}

// CancelJob stops the harness run with the given id, or every running harness
// when id is 0.
func (m *Jobs) CancelJob(id int64) bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	tc := m.threadCancel
	m.mu.Unlock()
	fromThreads := tc != nil && tc(id)
	if fromThreads && id != 0 {
		return true
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if id != 0 {
		j := m.jobs[id]
		if j != nil && j.Running && j.cancel != nil {
			ui.Status("warn", "agent", fmt.Sprintf("cancelled in-flight run with %s (job %d)", j.Harness, j.ID), 0, os.Stdout)
			j.Running = false
			j.Error = "cancelled"
			cancel := j.cancel
			j.cancel = nil
			cancel()
			return true
		}
		return false
	}
	cancelled := false
	for _, j := range m.jobs {
		if !j.Running || j.cancel == nil {
			continue
		}
		ui.Status("warn", "agent", fmt.Sprintf("cancelled in-flight run with %s (job %d)", j.Harness, j.ID), 0, os.Stdout)
		j.Running = false
		j.Error = "cancelled"
		cancel := j.cancel
		j.cancel = nil
		cancel()
		cancelled = true
	}
	return cancelled || fromThreads
}

func (m *Jobs) Close() { m.Cancel() }

// ChangedSince reports the paths whose state differs from the snapshot taken
// before the run. Asking git is the only honest answer to "what did it touch":
// a harness routinely edits files nobody pointed it at.
func ChangedSince(root string, before map[string]string) []string {
	return changedSinceMaps(before, WorktreeSnapshot(root))
}

// WorktreeSnapshot is git status with each listed file's size and mtime folded
// into its entry. Status alone misses the common case of editing a file that is
// already modified: it reads "M" before and after, so the edit would go unseen.
// Files git lists as clean are left out, and those still surface through status.
func WorktreeSnapshot(root string) map[string]string {
	st := git.Status(root)
	for rel, code := range st {
		if fi, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err == nil {
			st[rel] = code + " " + strconv.FormatInt(fi.Size(), 10) + " " + strconv.FormatInt(fi.ModTime().UnixNano(), 10)
		}
	}
	return st
}

// changedSinceMaps compares two status snapshots in both directions. Outside a
// git repository both are nil and nothing is ever reported as changed, which is
// why a job carries Tracked for the client to fall back on.
func changedSinceMaps(before, after map[string]string) []string {
	out := []string{}
	for path, st := range after {
		if before[path] != st {
			out = append(out, path)
		}
	}
	// A file restored to its committed state leaves the status list entirely.
	for path := range before {
		if _, still := after[path]; !still {
			out = append(out, path)
		}
	}
	// Map iteration order is random; sort so the job's summary and API
	// response list the same files in the same order on every run.
	sort.Strings(out)
	return out
}

// ReadLineRange returns lines l1..l2 of a file, 1-based and inclusive.
func ReadLineRange(abs string, l1, l2 int) (string, error) {
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	if l1 < 1 {
		l1 = 1
	}
	if l2 < l1 {
		l2 = l1
	}
	if l1 > len(lines) {
		return "", fmt.Errorf("line %d is past the end of %s", l1, filepath.Base(abs))
	}
	if l2 > len(lines) {
		l2 = len(lines)
	}
	return strings.Join(lines[l1-1:l2], "\n"), nil
}

type writerSink struct {
	io.Writer
	wrote bool
}

// Text forwards assistant output.
func (s *writerSink) Text(t string, _ bool) { s.wrote = true; _, _ = io.WriteString(s.Writer, t) }

// Reasoning forwards the agent’s reasoning.
func (s *writerSink) Reasoning(string) {}

// Step reports tool activity.
func (s *writerSink) Step(string) {}

// Result supplies an answer when no text was streamed.
func (s *writerSink) Result(t string) {
	if !s.wrote {
		_, _ = io.WriteString(s.Writer, t)
	}
}
