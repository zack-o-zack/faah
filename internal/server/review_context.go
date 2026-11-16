package server

import (
	"bytes"
	"net/http"
	"strconv"

	"faah/internal/git"
	"faah/internal/httpx"
	"faah/internal/render"
)

type reviewContextRow struct {
	Line int    `json:"line"`
	Text string `json:"text"`
	HTML string `json:"html"`
}

func (s *Server) handleReviewContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.Fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.pr == nil || s.prHeadSHA == "" {
		httpx.Fail(w, http.StatusConflict, "not in a PR review")
		return
	}
	q := r.URL.Query()
	_, rel, ok := s.safePath(q.Get("path"))
	if !ok || rel == "" {
		httpx.Fail(w, http.StatusBadRequest, "bad path")
		return
	}
	if _, ok := s.ix.PRFiles()[rel]; !ok {
		httpx.Fail(w, http.StatusNotFound, "file is not changed by this PR")
		return
	}
	from, fromErr := strconv.Atoi(q.Get("from"))
	to, toErr := strconv.Atoi(q.Get("to"))
	if fromErr != nil || toErr != nil || to < from || (to > from && uint64(to)-uint64(from) >= 2000) {
		httpx.Fail(w, http.StatusBadRequest, "context range must contain at most 2000 lines")
		return
	}
	src, err := git.ShowFile(s.ix.Root(), s.prHeadSHA, rel, render.MaxFileBytes)
	if err != nil {
		httpx.Fail(w, http.StatusNotFound, err.Error())
		return
	}
	if render.IsBinary(src) {
		httpx.Fail(w, http.StatusUnsupportedMediaType, "binary file")
		return
	}
	doc := render.NewDoc(string(src), rel)
	// Git does not count the editor's empty line after a terminal newline.
	total := doc.Total
	if len(src) == 0 || bytes.HasSuffix(src, []byte{'\n'}) {
		total--
	}
	from = min(max(from, 1), total)
	to = min(max(to, 1), total)
	html, err := doc.HighlightRange(from-1, to)
	if err != nil {
		httpx.Fail(w, http.StatusRequestEntityTooLarge, err.Error())
		return
	}
	rows := make([]reviewContextRow, len(html))
	for i, line := range html {
		rows[i] = reviewContextRow{Line: from + i, Text: doc.Raw(from + i), HTML: line}
	}
	httpx.WriteJSON(w, struct {
		Path  string             `json:"path"`
		Total int                `json:"total"`
		Rows  []reviewContextRow `json:"rows"`
	}{rel, total, rows})
}
