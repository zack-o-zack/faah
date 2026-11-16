package server

import (
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"regexp"
	"strings"

	"faah/internal/httpx"
	"faah/internal/settings"
)

func (s *Server) routePath(subpath string) string {
	if s.basePath == "" || s.basePath == "/" {
		return subpath
	}
	bp := strings.TrimSuffix(s.basePath, "/")
	if !strings.HasPrefix(subpath, "/") {
		return bp + "/" + subpath
	}
	return bp + subpath
}

func (s *Server) registerRoutes() {
	sub, _ := fs.Sub(s.assets, "web")
	staticPrefix := s.routePath("/static/")
	s.mux.Handle(staticPrefix, httpx.Static(sub, staticPrefix))
	s.mux.HandleFunc(s.routePath("/static/themes.css"), s.themes.ServeHTTP)

	if s.basePath != "/" && s.basePath != "" {
		s.mux.HandleFunc(s.basePath, s.handleIndex)
		trimmed := strings.TrimSuffix(s.basePath, "/")
		s.mux.HandleFunc(trimmed, func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, s.basePath, http.StatusMovedPermanently)
		})
		s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" {
				http.Redirect(w, r, s.basePath, http.StatusFound)
				return
			}
			http.NotFound(w, r)
		})
	} else {
		s.mux.HandleFunc("/", s.handleIndex)
	}

	s.mux.HandleFunc(s.routePath("/api/meta"), s.handleMeta)
	s.mux.HandleFunc(s.routePath("/api/metrics"), s.handleMetrics)
	s.mux.HandleFunc(s.routePath("/api/tree"), s.handleTree)
	s.mux.HandleFunc(s.routePath("/api/find"), s.handleFind)
	s.mux.HandleFunc(s.routePath("/api/file"), s.handleFile)
	s.mux.HandleFunc(s.routePath("/api/close"), s.handleClose)
	s.mux.HandleFunc(s.routePath("/api/raw"), s.handleRaw)
	s.mux.HandleFunc(s.routePath("/api/file/save"), s.handleFileSave)
	s.mux.HandleFunc(s.routePath("/api/fs/new"), s.handleFSNew)
	s.mux.HandleFunc(s.routePath("/api/markdown"), s.handleMarkdown)
	s.mux.HandleFunc(s.routePath("/api/table"), s.handleTable)
	s.mux.HandleFunc(s.routePath("/api/diff"), s.handleDiff)
	s.mux.HandleFunc(s.routePath("/api/gutter"), s.handleGutter)
	s.mux.HandleFunc(s.routePath("/api/stream"), s.handleEventStream)
	s.mux.HandleFunc(s.routePath("/api/git/stream"), s.handleEventStream)
	s.mux.HandleFunc(s.routePath("/api/git/refresh"), s.handleGitRefresh)
	s.mux.HandleFunc(s.routePath("/api/git/stage"), s.handleGitStage)
	s.mux.HandleFunc(s.routePath("/api/git/unstage"), s.handleGitUnstage)
	s.mux.HandleFunc(s.routePath("/api/git/hunk"), s.handleGitHunk)
	s.mux.HandleFunc(s.routePath("/api/git/commit"), s.handleGitCommit)
	s.mux.HandleFunc(s.routePath("/api/git/commit-message"), s.handleGitCommitMessage)
	s.mux.HandleFunc(s.routePath("/api/git/push"), s.handleGitPush)
	s.mux.HandleFunc(s.routePath("/api/git/pull"), s.handleGitPull)
	s.mux.HandleFunc(s.routePath("/api/git/sync-agent"), s.handleGitSyncAgent)
	s.mux.HandleFunc(s.routePath("/api/git/sync-state"), s.handleGitSyncState)
	s.mux.HandleFunc(s.routePath("/api/git/abort"), s.handleGitAbort)
	s.mux.HandleFunc(s.routePath("/api/git/log"), s.handleGitLog)
	s.mux.HandleFunc(s.routePath("/api/unpushed"), s.handleUnpushed)
	s.mux.HandleFunc(s.routePath("/api/commitfiles"), s.handleCommitFiles)
	s.mux.HandleFunc(s.routePath("/api/commitdetail"), s.handleCommitDetail)
	s.mux.HandleFunc(s.routePath("/api/search"), s.handleSearch)
	s.mux.HandleFunc(s.routePath("/api/outline"), s.handleOutline)
	s.mux.HandleFunc(s.routePath("/api/def"), s.handleDef)
	s.mux.HandleFunc(s.routePath("/api/reindex"), s.handleReindex)
	s.mux.HandleFunc(s.routePath("/api/lsp/def"), s.handleLSPDef)
	s.mux.HandleFunc(s.routePath("/api/lsp/refs"), s.handleLSPRefs)
	s.mux.HandleFunc(s.routePath("/api/lsp/calls"), s.handleLSPCalls)
	s.mux.HandleFunc(s.routePath("/api/lsp/symbols"), s.handleLSPSymbols)
	s.mux.HandleFunc(s.routePath("/api/lsp/hover"), s.handleLSPHover)
	s.mux.HandleFunc(s.routePath("/api/lsp/diagnostics"), s.handleLSPDiagnostics)
	s.mux.HandleFunc(s.routePath("/api/lsp/warm"), s.handleLSPWarm)
	s.mux.HandleFunc(s.routePath("/api/lsp/setup"), s.handleLSPSetup)
	s.mux.HandleFunc(s.routePath("/api/lsp/install"), s.handleLSPInstall)
	s.mux.HandleFunc(s.routePath("/api/lsp/start"), s.handleLSPStart)
	s.mux.HandleFunc(s.routePath("/api/lsp/stop"), s.handleLSPStop)
	s.mux.HandleFunc(s.routePath("/api/lsp/servers"), s.handleLSPServers)
	s.mux.HandleFunc(s.routePath("/api/agent/harnesses"), s.handleAgentHarnesses)
	s.mux.HandleFunc(s.routePath("/api/agent/models"), s.handleAgentModels)
	s.mux.HandleFunc(s.routePath("/api/agent/select"), s.handleAgentSelect)
	s.mux.HandleFunc(s.routePath("/api/agent/edit"), s.handleAgentEdit)
	s.mux.HandleFunc(s.routePath("/api/agent/batch"), s.handleAgentBatchEdit)
	s.mux.HandleFunc(s.routePath("/api/agent/job"), s.handleAgentJob)
	s.mux.HandleFunc(s.routePath("/api/agent/cancel"), s.handleAgentCancel)
	s.mux.HandleFunc(s.routePath("/api/threads"), s.handleThreads)
	s.mux.HandleFunc(s.routePath("/api/threads/get"), s.handleThreadGet)
	s.mux.HandleFunc(s.routePath("/api/threads/create"), s.handleThreadCreate)
	s.mux.HandleFunc(s.routePath("/api/threads/send"), s.handleThreadSend)
	s.mux.HandleFunc(s.routePath("/api/threads/cancel"), s.handleThreadCancel)
	s.mux.HandleFunc(s.routePath("/api/threads/scope"), s.handleThreadScope)
	s.mux.HandleFunc(s.routePath("/api/threads/delete"), s.handleThreadDelete)
	s.mux.HandleFunc(s.routePath("/api/threads/revert"), s.handleThreadRevert)
	s.mux.HandleFunc(s.routePath("/api/threads/stream"), s.handleThreadStream)
	s.mux.HandleFunc(s.routePath("/api/explain"), s.handleExplain)
	s.mux.HandleFunc(s.routePath("/api/explain/notes"), s.handleExplainNotes)
	s.mux.HandleFunc(s.routePath("/api/explain/notes/dismiss"), s.handleExplainNotesDismiss)
	s.mux.HandleFunc(s.routePath("/api/mcp"), s.handleMCP)
	s.mux.HandleFunc(s.routePath("/api/explain/prepare"), s.handleExplainPrepare)
	s.mux.HandleFunc(s.routePath("/api/review-workflow/config"), s.handleReviewWorkflowConfig)
	s.mux.HandleFunc(s.routePath("/api/review-workflow/run"), s.handleReviewWorkflowRun)
	s.mux.HandleFunc(s.routePath("/api/review-workflow/stop"), s.handleReviewWorkflowStop)
	s.mux.HandleFunc(s.routePath("/api/review-workflow/status"), s.handleReviewWorkflowStatus)
	s.mux.HandleFunc(s.routePath("/api/review-workflow/stream"), s.handleReviewWorkflowStream)
	s.mux.HandleFunc(s.routePath("/api/review/walkthrough"), s.handleReviewWalkthrough)
	s.mux.HandleFunc(s.routePath("/api/review/context"), s.handleReviewContext)
	s.mux.HandleFunc(s.routePath("/api/settings"), s.handleSettings)
	s.mux.HandleFunc(s.routePath("/api/pr/meta"), s.handlePRMeta)
	s.mux.HandleFunc(s.routePath("/api/pr/overview"), s.handlePROverview)
	s.mux.HandleFunc(s.routePath("/api/pr/comments"), s.handlePRComments)
	s.mux.HandleFunc(s.routePath("/api/pr/comments/delete"), s.handlePRCommentDelete)
	s.mux.HandleFunc(s.routePath("/api/pr/submit"), s.handlePRSubmit)
	s.mux.HandleFunc(s.routePath("/api/pr/launch"), s.handleLaunchPR)
	s.mux.HandleFunc(s.routePath("/api/pr/existing-comments"), s.handlePRExistingComments)
	s.mux.HandleFunc(s.routePath("/api/pr/comments/issue"), s.handlePRIssueCommentPost)
	s.mux.HandleFunc(s.routePath("/api/pr/comments/review-reply"), s.handlePRReviewCommentReply)
	s.mux.HandleFunc(s.routePath("/api/pr/merge-status"), s.handlePRMergeStatus)
	s.mux.HandleFunc(s.routePath("/api/pr/merge"), s.handlePRMerge)
	s.mux.HandleFunc(s.routePath("/api/pr/merge-message"), s.handlePRMergeMessage)
	s.mux.HandleFunc(s.routePath("/api/forge/connect"), s.handleForgeConnect)
	s.mux.HandleFunc(s.routePath("/api/session"), s.handleSession)
}

var baseHrefRe = regexp.MustCompile(`<base\s+href="[^"]*">`)

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	expected := s.baseURLPath()
	if r.URL.Path != expected && r.URL.Path != strings.TrimSuffix(expected, "/") {
		http.NotFound(w, r)
		return
	}
	b, err := fs.ReadFile(s.assets, "web/index.html")
	if err != nil {
		httpx.Fail(w, 500, err.Error())
		return
	}
	theme := ""
	if configured := settings.Read().WorkbenchColorTheme; configured != nil {
		theme = *configured
	}
	html := s.themes.HTML(string(b), theme)
	baseTag := fmt.Sprintf(`<base href="%s">`, expected)
	if strings.Contains(html, "<base ") {
		html = baseHrefRe.ReplaceAllString(html, baseTag)
	} else if idx := strings.Index(html, "<head>"); idx != -1 {
		html = html[:idx+6] + "\n" + baseTag + html[idx+6:]
	} else {
		html = baseTag + "\n" + html
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	io.WriteString(w, html)
}
