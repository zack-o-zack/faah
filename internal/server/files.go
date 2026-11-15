package server

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"faah/internal/git"
	"faah/internal/httpx"
	"faah/internal/render"
	"faah/internal/table"
	"faah/internal/ui"
)

var imageExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".svg": true, ".ico": true, ".bmp": true, ".avif": true,
}

var imageMime = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".ico":  "image/x-icon",
	".bmp":  "image/bmp",
	".avif": "image/avif",
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	abs, rel, ok := s.resolvePath(q.Get("path"))
	if !ok {
		httpx.Fail(w, 400, "bad path")
		return
	}
	st, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) && git.Available(s.ix.Root()) {
			diffAvail := false
			// A file a local commit deleted has nothing on disk, so the normal
			// working-tree check below can't vouch for it. Its commit diff can.
			if ref := q.Get("ref"); ref != "" {
				diffAvail = git.DiffCommit(s.ix.Root(), rel, ref) != ""
			} else if avail, ok := s.ix.HasDiffAvailable(rel, s.diffBase, s.pr != nil); ok {
				diffAvail = avail
			} else if s.pr != nil {
				diffAvail = git.DiffAgainst(s.ix.Root(), rel, s.diffBase) != "" ||
					git.DiffBetween(s.ix.Root(), rel, s.diffBase, s.prHeadSHA) != "" ||
					git.DiffAgainst(s.ix.Root(), rel, s.prHeadSHA) != ""
			} else {
				diffAvail = git.DiffAgainst(s.ix.Root(), rel, s.diffBase) != ""
			}
			if diffAvail {
				d := render.NewDoc("", rel)
				if ui.Verbose {
					ui.Status("info", "view", fmt.Sprintf("%s · deleted (0 bytes)", rel), 0, os.Stdout)
				}
				httpx.WriteJSON(w, map[string]any{
					"path": rel, "lang": d.Lang, "total": 0, "maxCols": 0,
					"start": 0, "lines": []string{}, "size": 0,
					"exact": true, "refine": false,
					"markdown":      render.IsMarkdown(rel),
					"table":         table.IsTable(rel),
					"diffAvailable": true,
					"deleted":       true,
					"lsp":           s.lspBrief(rel),
				})
				return
			}
		}
		httpx.Fail(w, 404, err.Error())
		return
	}
	if imageExt[strings.ToLower(filepath.Ext(rel))] {
		if ui.Verbose {
			ui.Status("info", "view", fmt.Sprintf("%s · image (%s)", rel, ui.FormatBytes(st.Size())), 0, os.Stdout)
		}
		httpx.WriteJSON(w, map[string]any{"path": rel, "image": true, "size": st.Size()})
		return
	}

	d, err := render.Open(abs, rel)
	if err != nil {
		httpx.Fail(w, 415, err.Error())
		return
	}
	start, _ := strconv.Atoi(q.Get("start"))
	count, _ := strconv.Atoi(q.Get("count"))
	if count <= 0 {
		count = render.ChunkLines
	}
	if start < 0 {
		start = 0
	}
	if start > d.Total {
		start = d.Total
	}
	if ui.Verbose && start == 0 {
		ui.Status("info", "view", fmt.Sprintf("%s · %d lines (%s)", rel, d.Total, ui.FormatBytes(st.Size())), 0, os.Stdout)
	}
	lines, exact := d.Lines(start, start+count)
	_, coming := d.Exact()
	diffAvail := false
	if git.Available(s.ix.Root()) {
		if ref := q.Get("ref"); ref != "" {
			if base := q.Get("base"); base != "" && git.ValidSHA(base) && git.ValidSHA(ref) {
				diffAvail = git.DiffBetween(s.ix.Root(), rel, base, ref) != ""
			} else {
				// isPinned to one commit: what matters is whether that commit touched
				// the file, not whether the working tree has since diverged.
				diffAvail = git.DiffCommit(s.ix.Root(), rel, ref) != ""
			}
		} else if avail, ok := s.ix.HasDiffAvailable(rel, s.diffBase, s.pr != nil); ok {
			diffAvail = avail
		} else if s.pr != nil {
			diffAvail = git.DiffAgainst(s.ix.Root(), rel, s.diffBase) != "" ||
				git.DiffBetween(s.ix.Root(), rel, s.diffBase, s.prHeadSHA) != "" ||
				git.DiffAgainst(s.ix.Root(), rel, s.prHeadSHA) != ""
		} else {
			diffAvail = git.DiffAgainst(s.ix.Root(), rel, s.diffBase) != ""
		}
	}
	resp := map[string]any{
		"path": rel, "lang": d.Lang, "total": d.Total, "maxCols": d.MaxCols,
		"start": start, "lines": lines, "size": st.Size(),
		"exact": exact, "refine": !exact && coming,
		"markdown":      render.IsMarkdown(rel),
		"table":         table.IsTable(rel),
		"diffAvailable": diffAvail,
		"lsp":           s.lspBrief(rel),
		"diagnostics":   s.lsp.Diagnostics(abs, rel),
	}
	if q.Get("raw") == "1" {
		rawLines := make([]string, len(lines))
		for i := range lines {
			rawLines[i] = d.Raw(start + i + 1)
		}
		resp["raw"] = rawLines
	}
	httpx.WriteJSON(w, resp)
}

func (s *Server) handleClose(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	abs, rel, ok := s.resolvePath(q.Get("path"))
	if !ok {
		httpx.Fail(w, 400, "bad path")
		return
	}
	render.Evict(abs)
	s.lsp.CloseDoc(abs, rel)
	httpx.WriteJSON(w, map[string]any{"ok": true, "path": rel})
}

func (s *Server) handleMarkdown(w http.ResponseWriter, r *http.Request) {
	abs, rel, ok := s.resolvePath(r.URL.Query().Get("path"))
	if !ok {
		httpx.Fail(w, 400, "bad path")
		return
	}
	if !render.IsMarkdown(rel) {
		httpx.Fail(w, 415, "not a Markdown file")
		return
	}
	st, err := os.Stat(abs)
	if err != nil {
		httpx.Fail(w, 404, err.Error())
		return
	}
	if st.IsDir() {
		httpx.Fail(w, 415, "is a directory")
		return
	}
	if st.Size() > render.MaxMarkdownBytes {
		httpx.Fail(w, 413, "too large to preview")
		return
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		httpx.Fail(w, 404, err.Error())
		return
	}
	out, err := render.RenderMarkdown(data)
	if err != nil {
		httpx.Fail(w, 500, err.Error())
		return
	}
	httpx.WriteJSON(w, map[string]any{"path": rel, "html": out})
}

// handleTable serves a CSV or TSV file parsed into rows for the table view.
// Cells go back as plain strings; the client inserts them as text, never HTML.
func (s *Server) handleTable(w http.ResponseWriter, r *http.Request) {
	abs, rel, ok := s.resolvePath(r.URL.Query().Get("path"))
	if !ok {
		httpx.Fail(w, 400, "bad path")
		return
	}
	delim, ok := table.Delim(rel)
	if !ok {
		httpx.Fail(w, 415, "not a CSV or TSV file")
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		httpx.Fail(w, 404, err.Error())
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		httpx.Fail(w, 404, err.Error())
		return
	}
	if st.IsDir() {
		httpx.Fail(w, 415, "is a directory")
		return
	}
	res, err := table.Render(f, st.Size(), delim)
	if err != nil {
		var pe *csv.ParseError
		if errors.As(err, &pe) {
			httpx.Fail(w, 422, err.Error())
			return
		}
		httpx.Fail(w, 500, err.Error())
		return
	}
	httpx.WriteJSON(w, res)
}

func setRawHeaders(w http.ResponseWriter, rel string) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	base := filepath.Base(rel)
	cd := mime.FormatMediaType("attachment", map[string]string{
		"filename": base,
	})
	if cd == "" {
		cd = fmt.Sprintf(`attachment; filename=%q`, base)
	}
	w.Header().Set("Content-Disposition", cd)

	ext := strings.ToLower(filepath.Ext(rel))
	ct := ""
	if imageExt[ext] {
		ct = mime.TypeByExtension(ext)
		if ct == "" {
			ct = imageMime[ext]
		}
	}
	if ct == "" || !strings.HasPrefix(ct, "image/") {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
}

func (s *Server) handleRaw(w http.ResponseWriter, r *http.Request) {
	abs, rel, ok := s.safePath(r.URL.Query().Get("path"))
	if !ok {
		httpx.Fail(w, 400, "bad path")
		return
	}
	setRawHeaders(w, rel)
	http.ServeFile(w, r, abs)
}

type fileSaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func (s *Server) handleFileSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req fileSaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Fail(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	abs, rel, ok := s.safePath(req.Path)
	if !ok || rel == "" {
		httpx.Fail(w, http.StatusBadRequest, "bad path")
		return
	}

	dir := filepath.Dir(abs)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		httpx.Fail(w, http.StatusInternalServerError, "failed to create directory: "+err.Error())
		return
	}

	if st, err := os.Stat(abs); err == nil && st.IsDir() {
		httpx.Fail(w, http.StatusBadRequest, "target is a directory")
		return
	}

	if err := os.WriteFile(abs, []byte(req.Content), 0o644); err != nil {
		httpx.Fail(w, http.StatusInternalServerError, "failed to write file: "+err.Error())
		return
	}

	render.Evict(abs)
	if s.lsp != nil {
		s.lsp.CloseDoc(abs, rel)
		s.lsp.RefreshOpenDocs()
	}
	s.ix.TouchPath(rel)
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}

	httpx.WriteJSON(w, map[string]any{
		"ok":   true,
		"path": rel,
		"size": len(req.Content),
	})
}

type fsNewRequest struct {
	Path string `json:"path"`
	Type string `json:"type"`
}

func (s *Server) handleFSNew(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req fsNewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Fail(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	abs, rel, ok := s.safePath(req.Path)
	if !ok || rel == "" {
		httpx.Fail(w, http.StatusBadRequest, "bad path")
		return
	}

	if _, err := os.Stat(abs); err == nil {
		httpx.Fail(w, http.StatusConflict, "already exists: "+rel)
		return
	}

	if req.Type == "dir" {
		if err := os.MkdirAll(abs, 0o755); err != nil {
			httpx.Fail(w, http.StatusInternalServerError, "failed to create directory: "+err.Error())
			return
		}
	} else {
		dir := filepath.Dir(abs)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			httpx.Fail(w, http.StatusInternalServerError, "failed to create parent directory: "+err.Error())
			return
		}
		if err := os.WriteFile(abs, []byte(""), 0o644); err != nil {
			httpx.Fail(w, http.StatusInternalServerError, "failed to create file: "+err.Error())
			return
		}
		render.Evict(abs)
	}

	s.ix.TouchPath(rel)
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}

	httpx.WriteJSON(w, map[string]any{
		"ok":   true,
		"path": rel,
		"type": req.Type,
	})
}
