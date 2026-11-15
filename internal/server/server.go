package server

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"faah/internal/httpx"
	lsppkg "faah/internal/lsp"
	prpkg "faah/internal/pr"
	"faah/internal/render"
	"faah/internal/review"
	"faah/internal/session"
	"faah/internal/telemetry"
	"faah/internal/ui"
	"faah/internal/workspace"
)

// Options supplies the workspace services and UI configuration.
type Options struct {
	Assets                                   fs.FS
	Version, DevRoot, BasePath, WorkbenchURL string
	Workspace                                *workspace.Index
	LSP                                      *lsppkg.Manager
	Telemetry                                *telemetry.Service
}

// Server is the main faah HTTP server handling the web UI, static assets,
// REST API endpoints, Server-Sent Events (SSE), and workspace services.
type Server struct {
	overviewCache prOverviewCache
	version       string
	assets        fs.FS
	devRoot       string
	ix            *workspace.Index
	lsp           *lsppkg.Manager
	tel           *telemetry.Service // nil in tests; Track is nil-safe
	agent         *agentManager      // nil unless main wires editing for this session
	threads       *threadManager     // nil unless editing is wired: threads run on the same harness
	explainPre    explainPrefetch    // evidence gathered ahead of an Explain click
	pr            *prpkg.Session     // nil unless main launched this process as `faah pr ...`
	diffBase      string             // ref /api/diff and /api/gutter diff against; "HEAD" unless in PR mode
	prHeadSHA     string             // PR mode only: the checked-out PR head commit. Frozen boundary between
	// the PR's own diff (diffBase..prHeadSHA) and the reviewer's local edits
	// since checkout (prHeadSHA..working tree); refreshed on Pull.
	gitWatcher *workspace.Watcher
	mux        *http.ServeMux
	basePath   string
	session    *session.Manager

	workbenchURL string // the workbench's base path, when this faah is one of its workspaces

	reviewFlow *review.Manager

	lastReq atomic.Int64 // unix nanos of the most recent request

	// streamsDone closes when the HTTP server starts shutting down, so event
	// streams end their responses cleanly instead of being cut when we exit.
	streamsDone chan struct{}
	endStreams  sync.Once
}

// EndStreams stops background maintenance and ends every open event stream. Register it with
// http.Server.RegisterOnShutdown: Shutdown does not cancel request contexts,
// so streams would otherwise hold it up until its deadline.
func (s *Server) EndStreams() {
	s.endStreams.Do(func() {
		if s.streamsDone != nil {
			close(s.streamsDone)
		}
		if s.gitWatcher != nil {
			s.gitWatcher.Stop()
		}
	})
}

// baseURLPath returns the URL path prefix configured for this server (e.g. "/" or "/rev-123/").
func (s *Server) baseURLPath() string {
	if s.basePath == "" {
		return "/"
	}
	return s.basePath
}

// New creates and initializes a faah Server instance, binding index and language servers,
// starting the background workspace.Watcher, and registering all HTTP and SSE routes.
func New(opts Options) *Server {
	ix, lsp := opts.Workspace, opts.LSP
	if lsp == nil {
		lsp = lsppkg.New(lsppkg.Options{Root: ix.Root(), Enabled: false, Version: opts.Version})
	}
	bp := "/"
	if opts.BasePath != "" {
		bp = httpx.CleanBasePath(opts.BasePath)
	}
	s := &Server{
		assets:       opts.Assets,
		version:      opts.Version,
		tel:          opts.Telemetry,
		workbenchURL: opts.WorkbenchURL,
		devRoot:      opts.DevRoot,
		ix:           ix, lsp: lsp, diffBase: "HEAD", basePath: bp, mux: http.NewServeMux(), streamsDone: make(chan struct{})}
	s.session = session.New(s.basePath, ix.Root())
	s.gitWatcher = workspace.NewWatcher(ix)
	s.gitWatcher.Start(context.Background())
	s.reviewFlow = review.New(ix.Root(), nil, func() string {
		if s.pr != nil {
			return "pr"
		}
		return ""
	})
	s.registerRoutes()
	s.lastReq.Store(time.Now().UnixNano())
	go s.scavenge()
	return s
}

// scavenge hands freed pages back to the OS once nobody is asking for anything.
// Reading a large tree churns through a lot of short-lived memory, and the Go
// runtime is in no hurry to return it. That is harmless but it makes a process
// that is doing nothing look like it is holding hundreds of megabytes.
func (s *Server) scavenge() {
	const idleFor = 15 * time.Second
	const lspIdleFor = 10 * time.Minute
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	done := true // nothing to release before the first request
	for {
		select {
		case <-s.streamsDone:
			return
		case <-tick.C:
			idle := time.Since(time.Unix(0, s.lastReq.Load()))
			if s.lsp != nil && idle >= lspIdleFor {
				s.lsp.ReapIdle(lspIdleFor)
			}
			if idle < idleFor {
				done = false
				continue
			}
			if done {
				continue // already released since the last burst of work
			}
			render.Scavenge()
			debug.FreeOSMemory()
			done = true
		}
	}
}

// ServeHTTP delegates incoming HTTP requests to the configured ServeMux,
// recording request timing and updating access timestamps.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	streamPath := s.routePath("/api/stream")
	gitStreamPath := s.routePath("/api/git/stream")
	metricsPath := s.routePath("/api/metrics")
	isSSE := r.URL.Path == streamPath || r.URL.Path == gitStreamPath || r.Header.Get("Accept") == "text/event-stream"
	if r.URL.Path != metricsPath && !isSSE {
		s.lastReq.Store(time.Now().UnixNano())
	}
	start := time.Now()

	rec := &httpx.StatusRecorder{ResponseWriter: w}
	if ui.Verbose {
		defer func() {
			dur := ui.FmtDuration(time.Since(start))
			status := rec.Status()
			if status == 0 {
				status = http.StatusOK
			}
			role := "info"
			if status >= 500 {
				role = "err"
			} else if status >= 400 {
				role = "warn"
			}
			uri := r.RequestURI
			if uri == "" {
				uri = r.URL.RequestURI()
			}
			if uri == "" {
				uri = r.URL.Path
			}
			if uri == "" {
				uri = "/"
			}
			ui.Status(role, "http", fmt.Sprintf("%s %s · %d  (%s)", r.Method, uri, status, dur), 0, os.Stdout)
		}()
	}

	var out http.ResponseWriter = rec
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", httpx.ContentSecurityPolicy)
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") && !isSSE {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		gw := httpx.NewGzipWriter(rec)
		defer gw.Close()
		out = gw
	}

	s.mux.ServeHTTP(out, r)
}

// CloseThreads stops every thread turn still running at shutdown.
func (s *Server) CloseThreads() {
	if s.threads != nil {
		s.threads.Close()
	}
}
