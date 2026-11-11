package opencode

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/host"
)

const serverIdle = 30 * time.Second

var shared = struct {
	sync.Mutex
	servers map[string]*server
}{servers: map[string]*server{}}

type event struct {
	Type string `json:"type"`
	Data struct {
		SessionID string   `json:"sessionID"`
		ID        string   `json:"id"`
		Delta     string   `json:"delta"`
		Name      string   `json:"name"`
		Action    string   `json:"action"`
		Resources []string `json:"resources"`
		Error     struct {
			Message string `json:"message"`
		} `json:"error"`
	} `json:"data"`
}

type server struct {
	idleDelay     time.Duration
	process       *host.Process
	url, password string
	client        *http.Client
	mu            sync.Mutex
	routes        map[string]*session
	done          chan struct{}
	once          sync.Once
	refs          int
	idle          *time.Timer
	ready         chan struct{}
}

func (s *server) idleDuration() time.Duration {
	if s.idleDelay > 0 {
		return s.idleDelay
	}
	return serverIdle
}

func acquire(ctx context.Context, o agents.Open) (*server, func(), error) {
	binary := "opencode"
	if len(o.Base) > 0 {
		binary = o.Base[0]
	}
	shared.Lock()
	defer shared.Unlock()
	s := shared.servers[binary]
	if s != nil {
		select {
		case <-s.done:
			s = nil
		default:
		}
	}
	if s == nil {
		var err error
		s, err = launch(ctx, o, binary)
		if err != nil {
			return nil, nil, err
		}
		shared.servers[binary] = s
	}
	if s.idle != nil {
		s.idle.Stop()
	}
	s.refs++
	var once sync.Once
	release := func() {
		once.Do(func() {
			shared.Lock()
			defer shared.Unlock()
			s.refs--
			if s.refs == 0 {
				s.idle = time.AfterFunc(s.idleDuration(), func() {
					shared.Lock()
					defer shared.Unlock()
					if s.refs == 0 {
						s.stop()
						if shared.servers[binary] == s {
							delete(shared.servers, binary)
						}
					}
				})
			}
		})
	}
	return s, release, nil
}

var listenURL = regexp.MustCompile(`server listening on (https?://[^\s]+)`)

type readyWriter struct {
	mu   sync.Mutex
	tail string
	urls chan string
	dst  io.Writer
}

// Write captures the server address while forwarding startup diagnostics.
func (w *readyWriter) Write(b []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.tail += string(b)
	if len(w.tail) > 65536 {
		w.tail = w.tail[len(w.tail)-65536:]
	}
	if m := listenURL.FindStringSubmatch(w.tail); len(m) > 1 {
		select {
		case w.urls <- m[1]:
		default:
		}
	}
	if w.dst != nil {
		_, _ = w.dst.Write(b)
	}
	return len(b), nil
}

func launch(ctx context.Context, o agents.Open, binary string) (*server, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return nil, err
	}
	password := hex.EncodeToString(b)
	envMap := map[string]string{}
	for _, e := range append(os.Environ(), o.Env...) {
		k, v, ok := strings.Cut(e, "=")
		if ok {
			envMap[k] = v
		}
	}
	delete(envMap, "OPENCODE_SERVER_PASSWORD")
	envMap["OPENCODE_PASSWORD"] = password
	env := []string{}
	for k, v := range envMap {
		env = append(env, k+"="+v)
	}
	urls := make(chan string, 1)
	w := &readyWriter{urls: urls, dst: o.Stderr}
	p, err := host.Start([]string{binary, "serve", "--hostname=127.0.0.1", fmt.Sprintf("--port=%d", port)}, "", env, w)
	if err != nil {
		return nil, err
	}
	go func() {
		for line := range p.Lines {
			if m := listenURL.FindSubmatch(line); len(m) > 1 {
				select {
				case urls <- string(m[1]):
				default:
				}
			}
		}
	}()
	readyCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var address string
	select {
	case address = <-urls:
	case <-p.Exited:
		return nil, p.Error()
	case <-readyCtx.Done():
		p.Close()
		return nil, readyCtx.Err()
	}
	s := newServer(address, password)
	s.process = p
	infoCtx, infoCancel := context.WithTimeout(readyCtx, 5*time.Second)
	defer infoCancel()
	if err = s.call(infoCtx, "GET", "/api/info", nil, nil); err != nil {
		p.Close()
		s.stop()
		return nil, err
	}
	go func() { <-p.Exited; s.stop() }()
	go s.events()
	select {
	case <-s.ready:
		return s, nil
	case <-s.done:
		return nil, s.failure()
	case <-readyCtx.Done():
		s.stop()
		return nil, readyCtx.Err()
	}
}

func newServer(address, password string) *server {
	return &server{url: address, password: password, client: &http.Client{}, routes: map[string]*session{}, done: make(chan struct{}), ready: make(chan struct{})}
}

func (s *server) stop() {
	s.once.Do(func() {
		close(s.done)
		if s.process != nil {
			s.process.Close()
		}
		s.client.CloseIdleConnections()
	})
}

func (s *server) failure() error {
	if s.process != nil {
		return s.process.Error()
	}
	return errors.New("opencode server stopped")
}

func (s *server) request(ctx context.Context, method, path string, body any) (*http.Request, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.url+path, reader)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth("opencode", s.password)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func (s *server) call(ctx context.Context, method, path string, body, out any) error {
	return s.callCursor(ctx, method, path, body, out, nil)
}

func (s *server) callCursor(ctx context.Context, method, path string, body, out any, next *string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := s.request(ctx, method, path, body)
	if err != nil {
		return err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 65536))
		return fmt.Errorf("opencode %s %s: HTTP %d: %s", method, strings.Split(path, "?")[0], res.StatusCode, b)
	}
	if out == nil {
		_, err = io.Copy(io.Discard, res.Body)
		return err
	}
	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Cursor struct {
			Next string `json:"next"`
		} `json:"cursor"`
	}
	if err = json.NewDecoder(res.Body).Decode(&envelope); err != nil {
		return err
	}
	if next != nil {
		*next = envelope.Cursor.Next
	}
	return json.Unmarshal(envelope.Data, out)
}

func (s *server) events() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Keep cancellation independent of the acquiring caller's lifetime.
	go func() {
		select {
		case <-s.done:
			cancel()
		case <-ctx.Done():
		}
	}()
	first := true
	for {
		req, err := s.request(ctx, "GET", "/api/event", nil)
		if err != nil {
			return
		}
		req.Header.Set("Accept", "text/event-stream")
		res, err := s.client.Do(req)
		if err == nil {
			if res.StatusCode == http.StatusOK {
				if first {
					close(s.ready)
					first = false
				} else {
					s.mu.Lock()
					targets := make([]*session, 0, len(s.routes))
					for _, target := range s.routes {
						targets = append(targets, target)
					}
					s.mu.Unlock()
					for _, target := range targets {
						target.enqueue(event{Type: "faah.events.reconnected"})
					}
				}
				scan := bufio.NewScanner(res.Body)
				scan.Buffer(make([]byte, 65536), 16<<20)
				var data []string
				dispatch := func() {
					if len(data) == 0 {
						return
					}
					var e event
					if json.Unmarshal([]byte(strings.Join(data, "\n")), &e) == nil {
						s.mu.Lock()
						target := s.routes[e.Data.SessionID]
						s.mu.Unlock()
						if target != nil {
							target.enqueue(e)
						}
					}
					data = nil
				}
				for scan.Scan() {
					line := scan.Text()
					if line == "" {
						dispatch()
					} else if strings.HasPrefix(line, "data:") {
						data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
					}
				}
				dispatch()
			}
			res.Body.Close()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func inside(dir, path string) bool {
	return agents.WithinWorkspace(dir, path)
}
