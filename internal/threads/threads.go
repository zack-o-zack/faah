// Package threads owns persisted conversations and background edit jobs.
package threads

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/all"
	"faah/internal/codeintel"
	"faah/internal/explain"
	"faah/internal/explain/notes"
	"faah/internal/git"
	"faah/internal/processio"
	"faah/internal/settings"
	"faah/internal/ui"
)

// Threads are long-running, multi-turn conversations with a coding harness,
// anchored to a range of code but free to read and change anything in the
// workspace. Where an inline edit is a single dispatch that is forgotten once
// it exits, a Thread keeps its transcript on disk and continues the same
// harness session on every new message.
//
// Continuity works two ways. A harness with a session id faah can control
// (claude, cursor-agent) resumes its own session, so the harness keeps its own
// context. Every other harness, and any harness switched to mid-Thread, is
// replayed the earlier transcript inside the prompt.
//
// There is no overlap guard between threads or against inline edits: two
// harnesses writing the same lines is last write wins.

const (
	threadTurnTimeout = 30 * time.Minute
	threadSnippetMax  = 8000
	threadReplayMax   = 16000
	threadToolsMax    = 200
	threadSaveEvery   = 2 * time.Second
)

var (
	ErrBusy = errors.New("this thread is still working on a reply")
	ErrGone = errors.New("no such thread")
)

// Turn is one user message and the harness's answer to it.
type Turn struct {
	ID        int      `json:"id"`
	Prompt    string   `json:"prompt"`
	Reply     string   `json:"reply"`
	Reasoning string   `json:"reasoning,omitempty"`
	Tools     []string `json:"tools,omitempty"`     // what the harness did, one line each
	Changed   []string `json:"changed,omitempty"`   // files this turn touched
	BeforeSHA string   `json:"beforeSha,omitempty"` // ref-free git snapshot commit before the turn ran
	AfterSHA  string   `json:"afterSha,omitempty"`  // ref-free git snapshot commit after the turn ran
	Reverted  bool     `json:"reverted,omitempty"`  // true if the user reverted this turn's file changes
	Tracked   bool     `json:"tracked"`             // false outside git: Changed is unknown, not empty
	Error     string   `json:"error,omitempty"`
	Running   bool     `json:"running"`
	Harness   string   `json:"harness"`
	Model     string   `json:"model,omitempty"`
	Started   int64    `json:"started"` // unix ms
	Ms        int64    `json:"ms"`
	FirstMs   int64    `json:"firstMs,omitempty"` // until the first words of the reply arrived
	// Refs holds the citations in an explanation's reply that passed checking,
	// by target as written.
	Refs map[string]explain.Ref `json:"refs,omitempty"`
	// What an explanation showed on the code through the explain tools.
	Dismissed    []int               `json:"dismissed,omitempty"`
	Notes        []notes.Note        `json:"notes,omitempty"`
	Walkthroughs []notes.Walkthrough `json:"walkthroughs,omitempty"`
}

// Thread is the persisted conversation. Path and lines are where it was
// started, which is context for the harness and a jump target for the reader,
// not a limit on what it may change.
type Thread struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Kind    string `json:"kind,omitempty"` // "edit" or "batch" when started from inline edits; empty for a conversation
	Path    string `json:"path,omitempty"`
	L1      int    `json:"l1,omitempty"`
	L2      int    `json:"l2,omitempty"`
	Snippet string `json:"snippet,omitempty"`
	// Scope is what a PR-review Thread is about: "pr" (the whole pull request),
	// "mine" (the reviewer's own changes on top of it) or "selection" (just the
	// anchored code). ScopeSent is the scope the harness was last told, so a
	// change of scope is announced once rather than every turn.
	Scope     string  `json:"scope,omitempty"`
	ScopeSent string  `json:"scopeSent,omitempty"`
	Created   int64   `json:"created"`
	Updated   int64   `json:"updated"`
	SessionID string  `json:"sessionId,omitempty"`
	Turns     []*Turn `json:"turns"`
	// An explanation (Kind "explain"). ExplainKey identifies the code it describes
	// and EvidenceHash what surrounded that code; see explain.go. ExplainReader
	// is the explain.reader text it was written for. The packet the harness
	// reads is kept beside the store and loaded here for a turn.
	ExplainKey    string           `json:"explainKey,omitempty"`
	ExplainKind   string           `json:"explainKind,omitempty"`
	ExplainReader string           `json:"explainReader,omitempty"`
	EvidenceHash  string           `json:"evidenceHash,omitempty"`
	Evidence      *explain.Summary `json:"evidence,omitempty"`
	ExplainReq    *explain.Request `json:"explainReq,omitempty"`
	packet        string
}

type Summary struct {
	ID      string `json:"id"`
	Kind    string `json:"kind,omitempty"`
	Title   string `json:"title"`
	Path    string `json:"path,omitempty"`
	L1      int    `json:"l1,omitempty"`
	L2      int    `json:"l2,omitempty"`
	Updated int64  `json:"updated"`
	Turns   int    `json:"turns"`
	Running bool   `json:"running"`
	Failed  bool   `json:"failed,omitempty"`
	// Touched: the last finished turn changed files, or could not say (no git),
	// so open tabs need a reload.
	Touched bool `json:"touched,omitempty"`
}

type threadStore struct {
	Root    string    `json:"root"`
	Threads []*Thread `json:"threads"`
}

type Event struct {
	Name string
	Data []byte
}

type Manager struct {
	agent *Jobs
	root  string
	file  string // empty when there is nowhere to persist

	mu          sync.Mutex
	threads     map[string]*Thread
	cancels     map[string]context.CancelFunc // one running turn per Thread
	jobs        map[int64]*threadJobRef       // inline/batch edits, polled as agent jobs
	subs        map[string]map[chan Event]struct{}
	lastSave    time.Time
	sessions    map[string]*threadSession
	sessionIdle time.Duration
	closed      bool
	runtime     Runtime // host-owned selection and symbol hashes
	credentials Credentials
}

// StorePath keeps every workspace's threads beside settings.json, never
// inside the working tree.
func StorePath(root string) string {
	sp := settings.Path()
	if sp == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(root))
	return filepath.Join(filepath.Dir(sp), "threads", hex.EncodeToString(sum[:8])+".json")
}

// New restores threads and connects their edit jobs to the shared job sequence.
func New(a *Jobs, root, file string, runtime Runtime, credentials Credentials) *Manager {
	tm := &Manager{
		agent: a, root: root, file: file, runtime: runtime, credentials: credentials,
		threads: map[string]*Thread{}, sessions: map[string]*threadSession{},
		cancels: map[string]context.CancelFunc{}, jobs: map[int64]*threadJobRef{},
		subs: map[string]map[chan Event]struct{}{},
	}
	tm.load()
	a.threadJob, a.threadCancel = tm.job, tm.cancelJob
	return tm
}

// load restores saved threads. A turn that was running when faah exited can
// never finish, so it is closed out as interrupted rather than left spinning.
func (tm *Manager) load() {
	if tm.file == "" {
		return
	}
	data, err := os.ReadFile(tm.file)
	if err != nil {
		return
	}
	var st threadStore
	if json.Unmarshal(data, &st) != nil {
		return
	}
	for _, t := range st.Threads {
		if t == nil || t.ID == "" {
			continue
		}
		for _, tr := range t.Turns {
			if tr.Running {
				tr.Running = false
				if tr.Error == "" {
					tr.Error = "interrupted: faah exited before this reply finished"
				}
			}
		}
		tm.threads[t.ID] = t
	}
}

// saveLocked writes the store atomically. Callers hold tm.mu.
func (tm *Manager) saveLocked() {
	if tm.file == "" {
		return
	}
	st := threadStore{Root: tm.root}
	for _, t := range tm.threads {
		st.Threads = append(st.Threads, t)
	}
	sort.Slice(st.Threads, func(i, j int) bool { return st.Threads[i].Created < st.Threads[j].Created })
	data, err := json.MarshalIndent(st, "", " ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(tm.file), 0o755); err != nil {
		return
	}
	tmp := tm.file + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	if err := os.Rename(tmp, tm.file); err != nil {
		os.Remove(tmp)
		return
	}
	tm.lastSave = time.Now()
}

func newThreadID() string {
	var b [5]byte
	rand.Read(b[:])
	return "t" + hex.EncodeToString(b[:])
}

func threadTitle(msg string) string {
	line := strings.TrimSpace(strings.SplitN(strings.TrimSpace(msg), "\n", 2)[0])
	r := []rune(line)
	if len(r) > 60 {
		line = string(r[:60]) + "…"
	}
	if line == "" {
		line = "Untitled thread"
	}
	return line
}

func (t *Thread) Running() bool {
	return len(t.Turns) > 0 && t.Turns[len(t.Turns)-1].Running
}

func (t *Thread) summary() Summary {
	s := Summary{ID: t.ID, Kind: t.Kind, Title: t.Title, Path: t.Path, L1: t.L1, L2: t.L2, Updated: t.Updated, Turns: len(t.Turns), Running: t.Running()}
	if n := len(t.Turns); n > 0 && !s.Running {
		last := t.Turns[n-1]
		s.Failed = last.Error != ""
		s.Touched = len(last.Changed) > 0 || !last.Tracked
	}
	return s
}

// List returns every Thread, most recently active first.
func (tm *Manager) List() []Summary {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	out := make([]Summary, 0, len(tm.threads))
	for _, t := range tm.threads {
		out = append(out, t.summary())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated > out[j].Updated })
	return out
}

func (tm *Manager) Get(id string) *Thread {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	t := tm.threads[id]
	if t == nil {
		return nil
	}
	return cloneThread(t)
}

func cloneThread(t *Thread) *Thread {
	c := *t
	c.Turns = make([]*Turn, len(t.Turns))
	for i, tr := range t.Turns {
		tc := *tr
		tc.Tools = append([]string(nil), tr.Tools...)
		tc.Changed = append([]string(nil), tr.Changed...)
		tc.Dismissed = append([]int(nil), tr.Dismissed...)
		tc.Notes = append([]notes.Note(nil), tr.Notes...)
		tc.Walkthroughs = append([]notes.Walkthrough(nil), tr.Walkthroughs...)
		c.Turns[i] = &tc
	}
	return &c
}

// Create opens a Thread anchored at path:l1-l2 (path may be empty for a Thread
// about the workspace as a whole) and starts its first turn.
func (tm *Manager) Create(abs, rel string, l1, l2 int, message, scope string) (*Thread, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return nil, errors.New("message is empty")
	}
	t := &Thread{
		ID:      newThreadID(),
		Title:   threadTitle(message),
		Path:    rel,
		Scope:   cleanThreadScope(scope),
		Created: time.Now().UnixMilli(),
	}
	t.Updated = t.Created
	if rel != "" {
		if l1 < 1 {
			l1 = 1
		}
		if l2 < l1 {
			l2 = l1
		}
		t.L1, t.L2 = l1, l2
		t.Snippet = anchorSnippet(abs, l1, l2)
	}
	tm.mu.Lock()
	tm.threads[t.ID] = t
	tm.mu.Unlock()
	if _, err := tm.Send(t.ID, message); err != nil {
		tm.mu.Lock()
		delete(tm.threads, t.ID)
		tm.mu.Unlock()
		return nil, err
	}
	return tm.Get(t.ID), nil
}

func cleanThreadScope(s string) string {
	switch s {
	case "pr", "mine", "selection":
		return s
	}
	return ""
}

// SetScope changes what a Thread is about; the harness hears of it with the
// next message.
func (tm *Manager) SetScope(id, scope string) error {
	scope = cleanThreadScope(scope)
	tm.mu.Lock()
	defer tm.mu.Unlock()
	t := tm.threads[id]
	if t == nil {
		return ErrGone
	}
	t.Scope = scope
	tm.saveLocked()
	tm.publishThreadLocked(t)
	return nil
}

// threadRun is everything a turn's goroutine needs, decided under the lock.
type threadRun struct {
	tid     string
	turn    *Turn
	name    string
	model   string
	base    []string // the selected harness's headless argv
	env     []string // extra environment, such as a read-only agent's config
	message string
	prior   []*Turn
}

// Send appends a message to the Thread and starts the harness on it.
func (tm *Manager) Send(id, message string) (*Thread, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return nil, errors.New("message is empty")
	}
	tm.mu.Lock()
	explaining := tm.threads[id] != nil && tm.threads[id].Kind == "explain"
	tm.mu.Unlock()
	name, base, model := tm.agent.current()
	if explaining {
		name, base, model = tm.runtime.Select()
	}
	if base == nil {
		ui.Status("err", "thread", "dispatch refused: no coding harness selected", 0, os.Stdout)
		return nil, ErrNoAgent
	}

	tm.mu.Lock()
	t := tm.threads[id]
	if t == nil {
		tm.mu.Unlock()
		return nil, ErrGone
	}
	if t.Running() {
		tm.mu.Unlock()
		return nil, ErrBusy
	}
	var env []string
	mode := agents.ModeEdit
	if explaining {
		mode = agents.ModeAsk
	}
	if explaining {
		if err := all.CheckAsk(name); err != nil {
			tm.mu.Unlock()
			return nil, err
		}
	}
	if tm.closed {
		tm.mu.Unlock()
		return nil, errors.New("thread manager is closed")
	}
	if live := tm.sessions[id]; live != nil && live.idle != nil {
		live.idle.Stop()
		live.idle = nil
	}
	if live := tm.sessions[id]; live != nil && (live.name != name || live.model != model || live.mode != mode) {
		tm.closeSessionLocked(id)
	}
	if len(t.Turns) > 0 {
		last := t.Turns[len(t.Turns)-1]
		if last.Harness != name || last.Model != model {
			t.SessionID = ""
		}
	}
	prior := make([]*Turn, 0, len(t.Turns))
	for _, tr := range t.Turns {
		c := *tr
		prior = append(prior, &c)
	}
	turn := &Turn{
		ID: len(t.Turns) + 1, Prompt: message, Running: true, Tracked: git.Available(tm.root),
		Harness: name, Model: model, Started: time.Now().UnixMilli(),
	}
	t.Turns = append(t.Turns, turn)
	t.Updated = turn.Started
	ctx, cancel := context.WithTimeout(context.Background(), threadTurnTimeout)
	tm.cancels[id] = cancel
	tm.saveLocked()
	tm.publishThreadLocked(t)
	tm.mu.Unlock()

	modelNote := ""
	if model != "" {
		modelNote = " (" + model + ")"
	}
	ui.Status("step", "thread", fmt.Sprintf("%s turn %d · %s%s · %s", id, turn.ID, name, modelNote, t.Title), 0, os.Stdout)

	go tm.runTurn(ctx, cancel, &threadRun{tid: id, turn: turn, name: name, model: model, base: base, env: env, message: message, prior: prior})
	return tm.Get(id), nil
}

func (tm *Manager) runTurn(ctx context.Context, cancel context.CancelFunc, r *threadRun) {
	defer cancel()

	// Settle the session before composing the prompt: whether the harness
	// remembers the conversation decides whether it must be replayed.
	tm.mu.Lock()
	t := tm.threads[r.tid]
	if t == nil {
		tm.mu.Unlock()
		return
	}
	sessionID := t.SessionID
	explaining := t.Kind == "explain"
	if explaining && t.packet == "" {
		t.packet = tm.readExplainPacket(t.ID)
	}
	tm.mu.Unlock()

	a := tm.agent.openAgent(r.name)
	mode := agents.ModeEdit
	if explaining {
		mode = agents.ModeAsk
	}
	tm.mu.Lock()
	liveSession := tm.sessions[r.tid]
	tm.mu.Unlock()
	stderr := processio.NewTailBuffer(jobLogBytes)
	replay := len(r.prior) > 0 && sessionID == "" && liveSession == nil
	var openErr error
	if liveSession == nil {
		tok := tm.credentials.Issue(r.tid)
		o := agents.Open{Key: r.tid, Version: tm.agent.version, Dir: tm.root, Base: r.base, Env: r.env, Model: r.model, Mode: mode, Resume: sessionID, Tools: tm.credentials.Endpoint(tok), Stderr: stderr}
		var opened agents.Session
		opened, openErr = a.Open(ctx, o)
		if openErr != nil && sessionID != "" {
			o.Resume = ""
			opened, openErr = a.Open(ctx, o)
			replay = true
		}
		if openErr != nil {
			tm.credentials.Revoke(tok)
		} else {
			liveSession = &threadSession{session: opened, token: tok, name: r.name, model: r.model, mode: mode}
			tm.mu.Lock()
			if tm.closed || tm.threads[r.tid] == nil {
				opened.Close()
				tm.credentials.Revoke(tok)
				openErr = errors.New("thread closed")
			} else {
				tm.sessions[r.tid] = liveSession
				t.SessionID = opened.ID()
				tm.saveLocked()
			}
			tm.mu.Unlock()
		}
	}
	if liveSession != nil {
		tm.credentials.Touch(r.tid)
	}
	prCtx, scopeChanged := "", false
	if tm.agent.hooks.PRContext != nil && (t.ExplainReq == nil || !t.ExplainReq.PR) {
		tm.mu.Lock()
		scope := t.Scope
		scopeChanged = scope != t.ScopeSent
		tm.mu.Unlock()
		prCtx = tm.agent.hooks.PRContext(scope)
		if prCtx != "" {
			tm.mu.Lock()
			t.ScopeSent = scope
			tm.saveLocked()
			tm.mu.Unlock()
		}
	}
	prompt := threadPrompt(t, r.prior, r.message, replay, prCtx, scopeChanged)

	if ui.Verbose {
		ui.VerbosePrompt(0, r.name, prompt, os.Stdout)
	}

	before := worktreeSnapshot(tm.root)
	beforeSHA := git.SnapshotWorktree(tm.root)
	started := time.Now()
	sink := &threadSink{tm: tm, tid: r.tid, turn: r.turn, began: started}

	var out agents.Outcome
	err := openErr
	if err == nil {
		out, err = liveSession.session.Prompt(ctx, prompt, sink)
	}
	changed := changedSince(tm.root, before)
	afterSHA := ""
	if len(changed) > 0 && beforeSHA != "" {
		afterSHA = git.SnapshotWorktree(tm.root)
	}
	tm.agent.settle(changed)
	var refs map[string]explain.Ref
	if explaining {
		cited := sink.reply()
		tm.mu.Lock()
		for _, n := range r.turn.Notes {
			cited += "\n\n" + n.Detail
		}
		tm.mu.Unlock()
		refs = explain.ValidateRefs(tm.root, cited)
	}

	tm.mu.Lock()
	if t := tm.threads[r.tid]; t != nil {
		if t.SessionID == "" && out.SessionID != "" {
			t.SessionID = out.SessionID
		}
		r.turn.Running = false
		r.turn.Ms = time.Since(started).Milliseconds()
		r.turn.Changed = changed
		r.turn.BeforeSHA = beforeSHA
		r.turn.AfterSHA = afterSHA
		r.turn.Refs = refs
		if err != nil {
			msg := err.Error()
			if tail := strings.TrimSpace(stderr.String()); tail != "" && strings.TrimSpace(r.turn.Reply) == "" {
				if len(tail) > 2000 {
					tail = tail[len(tail)-2000:]
				}
				msg += "\n" + tail
			}
			r.turn.Error = msg
		}
		t.Updated = time.Now().UnixMilli()
		if err != nil {
			tm.closeSessionLocked(r.tid)
		}
		tm.idleSessionLocked(r.tid)
		delete(tm.cancels, r.tid)
		tm.saveLocked()
		tm.publishThreadLocked(t)
	}
	tm.mu.Unlock()

	dur := ui.FmtDuration(time.Since(started))
	if err != nil {
		ui.Status("err", "thread", fmt.Sprintf("%s turn %d failed in %s: %s", r.tid, r.turn.ID, dur, err.Error()), 0, os.Stdout)
	} else {
		ui.Status("ok", "thread", fmt.Sprintf("%s turn %d · %s, first words after %s  (%d files changed)", r.tid, r.turn.ID, dur, ui.FmtDuration(time.Duration(r.turn.FirstMs)*time.Millisecond), len(changed)), 0, os.Stdout)
	}
}

// Cancel stops the turn running in a Thread. What it already wrote stays.
func (tm *Manager) Cancel(id string) bool {
	tm.mu.Lock()
	cancel := tm.cancels[id]
	tm.mu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

// Delete removes a Thread, stopping its turn first.
func (tm *Manager) Delete(id string) bool {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tm.threads[id] == nil {
		return false
	}
	if cancel := tm.cancels[id]; cancel != nil {
		cancel()
	}
	tm.closeSessionLocked(id)
	delete(tm.threads, id)
	tm.removeExplainPacket(id)
	tm.saveLocked()
	tm.publishLocked(id, "deleted", map[string]string{"id": id})
	tm.publishLocked("", "deleted", map[string]string{"id": id})
	return true
}

func (tm *Manager) Close() {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	for _, cancel := range tm.cancels {
		cancel()
	}
	tm.closed = true
	for id := range tm.sessions {
		tm.closeSessionLocked(id)
	}

}

// RevertTurn restores the files touched by a specific turn back to their
// pre-turn snapshot (BeforeSHA).
func (tm *Manager) RevertTurn(id string, turnID int) (*Thread, []string, error) {
	tm.mu.Lock()
	t := tm.threads[id]
	if t == nil {
		tm.mu.Unlock()
		return nil, nil, ErrGone
	}
	if t.Running() {
		tm.mu.Unlock()
		return nil, nil, ErrBusy
	}
	var target *Turn
	for _, tr := range t.Turns {
		if tr.ID == turnID {
			target = tr
			break
		}
	}
	if target == nil {
		tm.mu.Unlock()
		return nil, nil, errors.New("no such turn")
	}
	if target.BeforeSHA == "" || len(target.Changed) == 0 {
		tm.mu.Unlock()
		return nil, nil, errors.New("no snapshot available for this turn")
	}
	beforeSHA := target.BeforeSHA
	paths := append([]string(nil), target.Changed...)
	tm.mu.Unlock()

	if err := git.RestoreSnapshotPaths(tm.root, beforeSHA, paths); err != nil {
		return nil, nil, err
	}
	tm.agent.settle(paths)

	tm.mu.Lock()
	if t := tm.threads[id]; t != nil {
		for _, tr := range t.Turns {
			if tr.ID == turnID {
				tr.Reverted = true
				break
			}
		}
		t.Updated = time.Now().UnixMilli()
		tm.saveLocked()
		tm.publishThreadLocked(t)
	}
	tm.mu.Unlock()
	return tm.Get(id), paths, nil
}

// ---------------------------------------------------------------- output

// threadSink receives a turn's output from the agent and keeps it as the
// turn's reply, streaming text and steps to the UI as they arrive.
type threadSink struct {
	tm    *Manager
	tid   string
	turn  *Turn
	began time.Time // when the harness was started, for timing the first words
}

func (s *threadSink) Text(text string, block bool) { s.text(text, block) }
func (s *threadSink) Step(label string) {
	// Agents name files by absolute path; the workspace prefix is noise.
	label = strings.ReplaceAll(label, s.tm.root+string(filepath.Separator), "")
	s.tool(agents.StepLabel(label))
}

// Result is the final answer, kept only when nothing was streamed.
func (s *threadSink) Result(text string) {
	if strings.TrimSpace(s.reply()) == "" {
		s.text(text, true)
	}
}

func (s *threadSink) reply() string {
	s.tm.mu.Lock()
	defer s.tm.mu.Unlock()
	return s.turn.Reply
}

// text appends to the reply. block marks a whole assistant message, which is
// set off from the previous one by a blank line.
func (s *threadSink) text(text string, block bool) {
	if text == "" {
		return
	}
	s.tm.mu.Lock()
	defer s.tm.mu.Unlock()
	if block && s.turn.Reply != "" && !strings.HasSuffix(s.turn.Reply, "\n\n") {
		text = "\n\n" + text
	}
	if s.turn.FirstMs == 0 {
		s.turn.FirstMs = max(1, time.Since(s.began).Milliseconds())
	}
	s.turn.Reply += text
	s.tm.publishLocked(s.tid, "delta", map[string]any{"turn": s.turn.ID, "text": text})
	s.tm.maybeSaveLocked()
}

func (s *threadSink) tool(text string) {
	s.tm.mu.Lock()
	defer s.tm.mu.Unlock()
	if len(s.turn.Tools) < threadToolsMax {
		s.turn.Tools = append(s.turn.Tools, text)
	}
	s.tm.publishLocked(s.tid, "tool", map[string]any{"turn": s.turn.ID, "text": text})
}

// maybeSaveLocked checkpoints a long reply so an exit mid-turn loses seconds,
// not the whole answer.
func (tm *Manager) maybeSaveLocked() {
	if time.Since(tm.lastSave) >= threadSaveEvery {
		tm.saveLocked()
	}
}

// ---------------------------------------------------------------- events

// publishLocked delivers an event to the subscribers of one Thread ("" is the
// list channel). A subscriber that cannot keep up is dropped, and its client
// reconnects to a fresh snapshot, so nothing is ever delivered out of order.
func (tm *Manager) publishLocked(id, name string, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	for ch := range tm.subs[id] {
		select {
		case ch <- Event{name, data}:
		default:
			delete(tm.subs[id], ch)
			close(ch)
		}
	}
}

func (tm *Manager) publishThreadLocked(t *Thread) {
	tm.publishLocked(t.ID, "thread", t)
	tm.publishLocked("", "summary", t.summary())
}

// subscribe registers for events on id ("" for the list) and returns the
// current state taken under the same lock, so nothing falls between the two.
func (tm *Manager) Subscribe(id string) (<-chan Event, Event, func(), bool) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	var first Event
	if id == "" {
		list := make([]Summary, 0, len(tm.threads))
		for _, t := range tm.threads {
			list = append(list, t.summary())
		}
		sort.Slice(list, func(i, j int) bool { return list[i].Updated > list[j].Updated })
		data, _ := json.Marshal(list)
		first = Event{"list", data}
	} else {
		t := tm.threads[id]
		if t == nil {
			return nil, first, nil, false
		}
		data, _ := json.Marshal(t)
		first = Event{"thread", data}
	}
	ch := make(chan Event, 256)
	if tm.subs[id] == nil {
		tm.subs[id] = map[chan Event]struct{}{}
	}
	tm.subs[id][ch] = struct{}{}
	return ch, first, func() {
		tm.mu.Lock()
		defer tm.mu.Unlock()
		if _, ok := tm.subs[id][ch]; ok {
			delete(tm.subs[id], ch)
			close(ch)
		}
	}, true
}

// ---------------------------------------------------------------- inline edits

// threadJobRef ties an agent-style job id, which the inline and batch edit UI
// polls, to the Thread turn doing the work.
type threadJobRef struct {
	tid   string
	turn  int
	items []BatchItem
}

// StartEdit runs inline and batch edits as a Thread, so every edit leaves a
// transcript that can be followed up. It keeps the guarantee those flows have
// always had: an edit on lines another edit is still changing is refused.
// Conversations started from the Threads pane are never guarded this way.
func (tm *Manager) StartEdit(items []BatchItem) (*Job, error) {
	if len(items) == 0 {
		return nil, errors.New("no edits specified")
	}
	for i := range items {
		items[i].Instruction = strings.TrimSpace(items[i].Instruction)
		if items[i].Instruction == "" {
			return nil, errors.New("instruction is empty")
		}
		if items[i].L1 < 1 {
			items[i].L1 = 1
		}
		if items[i].L2 < items[i].L1 {
			items[i].L2 = items[i].L1
		}
		for j := 0; j < i; j++ {
			if items[i].Path == items[j].Path && items[i].L1 <= items[j].L2 && items[j].L1 <= items[i].L2 {
				return nil, fmt.Errorf("overlapping edits in batch on %s (%s and %s)", items[i].Path, codeintel.LineRef(items[i].L1, items[i].L2), codeintel.LineRef(items[j].L1, items[j].L2))
			}
		}
	}

	if busy := tm.overlappingEdit(items); busy != "" {
		ui.Status("warn", "agent", "edit dispatch refused: "+busy, 0, os.Stdout)
		return nil, fmt.Errorf("%w: %s", ErrEditBusy, busy)
	}

	t := &Thread{ID: newThreadID(), Created: time.Now().UnixMilli()}
	t.Updated = t.Created
	var message string
	if len(items) == 1 {
		it := items[0]
		t.Kind, t.Path, t.L1, t.L2 = "edit", it.Path, it.L1, it.L2
		t.Snippet = anchorSnippet(it.Abs, it.L1, it.L2)
		t.Title = "Edit: " + threadTitle(it.Instruction)
		message = it.Instruction
	} else {
		t.Kind, t.Path, t.L1, t.L2 = "batch", items[0].Path, items[0].L1, items[0].L2
		t.Title = fmt.Sprintf("Batch edit: %d changes", len(items))
		var b strings.Builder
		fmt.Fprintf(&b, "Apply these %d edits together.\n\n", len(items))
		for i, it := range items {
			snip, err := readLineRange(it.Abs, it.L1, it.L2)
			if err != nil {
				return nil, err
			}
			if len(snip) > threadSnippetMax {
				snip = snip[:threadSnippetMax] + "\n…"
			}
			fmt.Fprintf(&b, "### Edit %d: @%s %s\n```%s\n%s\n```\n%s\n\n", i+1, it.Path, codeintel.LineRef(it.L1, it.L2),
				strings.TrimPrefix(filepath.Ext(it.Path), "."), snip, it.Instruction)
		}
		message = strings.TrimSpace(b.String())
	}

	tm.mu.Lock()
	tm.threads[t.ID] = t
	tm.mu.Unlock()
	if _, err := tm.Send(t.ID, message); err != nil {
		tm.mu.Lock()
		delete(tm.threads, t.ID)
		tm.mu.Unlock()
		return nil, err
	}
	id := tm.agent.nextJobID()
	tm.mu.Lock()
	tm.jobs[id] = &threadJobRef{tid: t.ID, turn: 1, items: items}
	tm.mu.Unlock()
	return tm.job(id), nil
}

// overlappingEdit describes an edit still running on lines these items touch,
// or returns "" when there is none.
func (tm *Manager) overlappingEdit(items []BatchItem) string {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	for id, ref := range tm.jobs {
		t := tm.threads[ref.tid]
		if t == nil || !t.Running() {
			continue
		}
		for _, run := range ref.items {
			for _, it := range items {
				if run.Path == it.Path && it.L1 <= run.L2 && run.L1 <= it.L2 {
					return fmt.Sprintf("an edit is already running on %s:%s (job #%d with %s)", it.Path, codeintel.LineRef(it.L1, it.L2), id, t.Turns[len(t.Turns)-1].Harness)
				}
			}
		}
	}
	return ""
}

// job presents an inline or batch edit's turn in the shape the edit UI polls.
// id 0 means the most recent one.
func (tm *Manager) job(id int64) *Job {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if id == 0 {
		for cand := range tm.jobs {
			if cand > id {
				id = cand
			}
		}
	}
	ref := tm.jobs[id]
	if ref == nil {
		return nil
	}
	t := tm.threads[ref.tid]
	if t == nil || ref.turn > len(t.Turns) {
		return nil
	}
	turn := t.Turns[ref.turn-1]
	j := &Job{
		ID: id, ThreadID: t.ID, Harness: turn.Harness, Path: ref.items[0].Path, Lines: codeintel.LineRef(ref.items[0].L1, ref.items[0].L2),
		Running: turn.Running, Log: turn.Reply, Stdout: turn.Reply,
		Changed: append([]string{}, turn.Changed...), Ms: turn.Ms, Tracked: turn.Tracked,
	}
	if len(ref.items) > 1 {
		j.BatchCount, j.Items = len(ref.items), ref.items
	}
	if turn.Running {
		j.Ms = time.Now().UnixMilli() - turn.Started
	}
	if turn.Error != "" {
		first, rest, _ := strings.Cut(turn.Error, "\n")
		j.Error, j.Stderr = first, rest
	}
	return j
}

// cancelJob stops the edit with this job id, or every running edit for id 0.
func (tm *Manager) cancelJob(id int64) bool {
	tm.mu.Lock()
	var tids []string
	for jid, ref := range tm.jobs {
		if id == 0 || jid == id {
			tids = append(tids, ref.tid)
		}
	}
	tm.mu.Unlock()
	cancelled := false
	for _, tid := range tids {
		if tm.Cancel(tid) {
			cancelled = true
		}
	}
	return cancelled
}
