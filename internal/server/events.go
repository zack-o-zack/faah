package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"faah/internal/threads"
)

// handleEventStream streams real-time workspace events (git status notifications and process metrics) via Server-Sent Events (SSE).
//
// It is the one long-lived connection a tab holds. Browsers allow only six
// HTTP/1.1 connections per host, shared by every tab, so each extra
// EventSource is one fewer slot for ordinary requests; once they are all
// parked on streams, every fetch queues forever and the UI stops loading.
// Other live feeds therefore ride along here, opted into by query:
//
//	threads=1    thread list events, as threads:<event>
//	thread=<id>  one thread's events, as thread:<event> {"id":..,"data":..}; repeatable
//	review=1     review workflow events, as review:<event>
func (s *Server) handleEventStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	includeMetrics := r.URL.Path != s.routePath("/api/git/stream")

	// 1. Immediately send initial metrics on connection (for unified stream)
	if includeMetrics {
		if mBytes, err := json.Marshal(getProcessMetrics(s.lsp)); err == nil {
			if _, err := fmt.Fprintf(w, "event: metrics\ndata: %s\n\n", mBytes); err != nil {
				return
			}
			flusher.Flush()
		}
	}

	// 2. Subscribe to git watcher if available
	var gitCh <-chan []byte
	if s.gitWatcher != nil {
		var cancel func()
		gitCh, cancel = s.gitWatcher.Subscribe()
		defer cancel()
	}

	// 3. Optional feeds, fanned into one channel. A feed whose channel closes
	// under us (a slow subscriber dropped by its publisher) ends the stream,
	// so the client reconnects and resyncs from fresh snapshots.
	feed, lost, ok := s.subscribeStreamFeeds(r, w, flusher)
	if !ok {
		return
	}

	// 4. Periodic metrics ticker (2500ms) for unified stream
	var metricsTicker *time.Ticker
	var metricsC <-chan time.Time
	if includeMetrics {
		metricsTicker = time.NewTicker(2500 * time.Millisecond)
		defer metricsTicker.Stop()
		metricsC = metricsTicker.C
	}

	// 5. Heartbeat ticker (15s) in case gitWatcher is disabled or not ticking
	heartbeatTicker := time.NewTicker(15 * time.Second)
	defer heartbeatTicker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-s.streamsDone:
			return
		case <-lost:
			return

		case msg, ok := <-gitCh:
			if !ok {
				return
			}
			if _, err := w.Write(msg); err != nil {
				return
			}
			flusher.Flush()

		case msg := <-feed:
			if _, err := w.Write(msg); err != nil {
				return
			}
			flusher.Flush()

		case <-metricsC:
			if mBytes, err := json.Marshal(getProcessMetrics(s.lsp)); err == nil {
				if _, err := fmt.Fprintf(w, "event: metrics\ndata: %s\n\n", mBytes); err != nil {
					return
				}
				flusher.Flush()
			}

		case <-heartbeatTicker.C:
			if _, err := fmt.Fprintf(w, "event: ping\ndata: {}\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// subscribeStreamFeeds subscribes to the optional feeds named in r's query,
// writes their initial snapshots to w, and returns a channel of ready-to-write
// frames plus a channel that closes when any feed is lost. The subscriptions
// end with r's context. ok is false if writing a snapshot failed.
func (s *Server) subscribeStreamFeeds(r *http.Request, w io.Writer, flusher http.Flusher) (feed <-chan []byte, lost <-chan struct{}, ok bool) {
	ctx := r.Context()
	q := r.URL.Query()
	out := make(chan []byte, 64)
	lostCh := make(chan struct{})
	var lostOnce sync.Once
	markLost := func() { lostOnce.Do(func() { close(lostCh) }) }

	var snapshots []byte
	forward := func(frames <-chan []byte) {
		go func() {
			for f := range frames {
				select {
				case out <- f:
				case <-ctx.Done():
					return
				}
			}
			if ctx.Err() == nil {
				markLost()
			}
		}()
	}

	// threadFrames adapts a thread subscription; per-thread events carry
	// their id so one connection can follow several threads.
	threadFrames := func(id string, ch <-chan threads.Event, first threads.Event, unsub func()) {
		frame := func(ev threads.Event) []byte {
			if id == "" {
				return []byte(fmt.Sprintf("event: threads:%s\ndata: %s\n\n", ev.Name, ev.Data))
			}
			env, _ := json.Marshal(struct {
				ID   string          `json:"id"`
				Data json.RawMessage `json:"data"`
			}{id, ev.Data})
			return []byte(fmt.Sprintf("event: thread:%s\ndata: %s\n\n", ev.Name, env))
		}
		snapshots = append(snapshots, frame(first)...)
		frames := make(chan []byte)
		go func() {
			defer close(frames)
			defer unsub()
			for {
				select {
				case ev, open := <-ch:
					if !open {
						return
					}
					select {
					case frames <- frame(ev):
					case <-ctx.Done():
						return
					}
				case <-ctx.Done():
					return
				}
			}
		}()
		forward(frames)
	}

	if s.threads != nil {
		if q.Get("threads") == "1" {
			ch, first, unsub, _ := s.threads.Subscribe("")
			threadFrames("", ch, first, unsub)
		}
		seen := map[string]bool{}
		for _, id := range q["thread"] {
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			ch, first, unsub, found := s.threads.Subscribe(id)
			if !found {
				// Gone while the client was away: say so, so it stops asking.
				env, _ := json.Marshal(map[string]any{"id": id, "data": map[string]string{"id": id}})
				snapshots = append(snapshots, fmt.Sprintf("event: thread:deleted\ndata: %s\n\n", env)...)
				continue
			}
			threadFrames(id, ch, first, unsub)
		}
	}

	if s.reviewFlow != nil && q.Get("review") == "1" {
		ch, unsub := s.reviewFlow.Subscribe()
		if runData, err := json.Marshal(s.reviewFlow.CurrentRun()); err == nil {
			snapshots = append(snapshots, fmt.Sprintf("event: review:snapshot\ndata: %s\n\n", runData)...)
		}
		frames := make(chan []byte)
		go func() {
			defer close(frames)
			defer unsub()
			for {
				select {
				case ev, open := <-ch:
					if !open {
						return
					}
					select {
					case frames <- []byte(fmt.Sprintf("event: review:%s\ndata: %s\n\n", ev.Name, ev.Data)):
					case <-ctx.Done():
						return
					}
				case <-ctx.Done():
					return
				}
			}
		}()
		forward(frames)
	}

	if len(snapshots) > 0 {
		if _, err := w.Write(snapshots); err != nil {
			return nil, nil, false
		}
		flusher.Flush()
	}
	return out, lostCh, true
}
