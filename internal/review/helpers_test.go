package review

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"

	"faah/internal/agents"
	"faah/internal/threads"
	"faah/internal/threads/threadstest"
)

var fakeCLI = threadstest.CLI

type fakeAgent = threadstest.Agent

type fakeThread struct {
	thread *threads.Thread
	cancel context.CancelFunc
	subs   map[chan threads.Event]struct{}
}

type fakeThreads struct {
	mu      sync.Mutex
	root    string
	open    func(string) agents.Agent
	threads map[string]*fakeThread
}

func testThreadManager(root string, open func(string) agents.Agent) (*fakeThreads, error) {
	if _, err := exec.LookPath("claude"); err != nil {
		return nil, err
	}
	if open == nil {
		open = func(string) agents.Agent {
			return &fakeAgent{PromptFunc: threadstest.Reply("All good.")}
		}
	}
	return &fakeThreads{root: root, open: open, threads: make(map[string]*fakeThread)}, nil
}

func (f *fakeThreads) Create(abs, rel string, l1, l2 int, message, scope string) (*threads.Thread, error) {
	ctx, cancel := context.WithCancel(context.Background())
	f.mu.Lock()
	id := fmt.Sprintf("thread-%d", len(f.threads)+1)
	t := &threads.Thread{ID: id, Path: rel, L1: l1, L2: l2, Scope: scope,
		Turns: []*threads.Turn{{ID: 1, Prompt: message, Running: true}}}
	f.threads[id] = &fakeThread{thread: t, cancel: cancel, subs: make(map[chan threads.Event]struct{})}
	initial := copyThread(t)
	f.mu.Unlock()
	go func() {
		defer cancel()
		sink := &fakeSink{}
		session, err := f.open("claude").Open(ctx, agents.Open{Dir: f.root})
		if err == nil {
			_, err = session.Prompt(ctx, message, sink)
			session.Close()
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		t.Turns[0].Reply = sink.String()
		t.Turns[0].Running = false
		if err != nil {
			t.Turns[0].Error = err.Error()
		}
		data, _ := json.Marshal(t)
		for ch := range f.threads[id].subs {
			ch <- threads.Event{Name: "thread", Data: data}
		}
	}()
	return initial, nil
}

func copyThread(t *threads.Thread) *threads.Thread {
	copy := *t
	copy.Turns = make([]*threads.Turn, len(t.Turns))
	for i, turn := range t.Turns {
		value := *turn
		copy.Turns[i] = &value
	}
	return &copy
}

func (f *fakeThreads) Get(id string) *threads.Thread {
	f.mu.Lock()
	defer f.mu.Unlock()
	if t := f.threads[id]; t != nil {
		return copyThread(t.thread)
	}
	return nil
}

func (f *fakeThreads) Cancel(id string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	t := f.threads[id]
	if t == nil || !t.thread.Running() {
		return false
	}
	t.cancel()
	return true
}

func (f *fakeThreads) Subscribe(id string) (<-chan threads.Event, threads.Event, func(), bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t := f.threads[id]
	if t == nil {
		return nil, threads.Event{}, nil, false
	}
	data, _ := json.Marshal(t.thread)
	ch := make(chan threads.Event, 256)
	t.subs[ch] = struct{}{}
	return ch, threads.Event{Name: "thread", Data: data}, func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		delete(t.subs, ch)
		close(ch)
	}, true
}

func (f *fakeThreads) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.threads {
		t.cancel()
	}
}

type fakeSink struct {
	strings.Builder
}

func (s *fakeSink) Reasoning(string)         {}
func (s *fakeSink) Text(text string, _ bool) { s.WriteString(text) }
func (s *fakeSink) Step(string)              {}
func (s *fakeSink) Result(text string) {
	if s.Len() == 0 {
		s.WriteString(text)
	}
}
