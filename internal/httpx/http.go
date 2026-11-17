package httpx

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

func CleanBasePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" || p == "/" || p == "." {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = path.Clean(p)
	if !strings.HasSuffix(p, "/") {
		p += "/"
	}
	return p
}

const ContentSecurityPolicy = "default-src 'self'; script-src 'self' 'sha256-+MX5HP4gJGe3Gg62Ql1gLhiNjw+TTtGF+Yd67MmqkSs='; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https: http:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none';"

type gzipBypasser interface {
	BypassGzip()
}

func bypassGzip(w http.ResponseWriter) {
	curr := w
	for curr != nil {
		if b, ok := curr.(gzipBypasser); ok {
			b.BypassGzip()
			return
		}
		if u, ok := curr.(interface{ Unwrap() http.ResponseWriter }); ok {
			curr = u.Unwrap()
		} else {
			break
		}
	}
}

var gzipPool = sync.Pool{New: func() any {
	w, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
	return w
}}

type GzipWriter struct {
	http.ResponseWriter
	w        *gzip.Writer
	disabled *bool
}

func (g GzipWriter) BypassGzip() {
	if g.disabled != nil {
		*g.disabled = true
	}
	if g.w != nil {
		g.w.Reset(io.Discard)
	}
}

func (g GzipWriter) isDisabled() bool {
	return g.disabled != nil && *g.disabled
}

func (g GzipWriter) WriteHeader(status int) {
	if g.isDisabled() {
		g.ResponseWriter.WriteHeader(status)
		return
	}
	g.Header().Del("Content-Length")
	if status == http.StatusNotModified || status == http.StatusNoContent {
		g.Header().Del("Content-Encoding")
		if g.w != nil {
			g.w.Reset(io.Discard)
		}
	}
	g.ResponseWriter.WriteHeader(status)
}

func (g GzipWriter) Write(b []byte) (int, error) {
	if g.isDisabled() || g.w == nil {
		return g.ResponseWriter.Write(b)
	}
	g.Header().Del("Content-Length")
	return g.w.Write(b)
}

func (g GzipWriter) Flush() {
	if !g.isDisabled() && g.w != nil {
		_ = g.w.Flush()
	}
	if flusher, ok := g.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (g GzipWriter) Unwrap() http.ResponseWriter {
	return g.ResponseWriter
}

type StatusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *StatusRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *StatusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}

func (r *StatusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (r *StatusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hijacker, ok := r.ResponseWriter.(http.Hijacker); ok {
		return hijacker.Hijack()
	}
	return nil, nil, errors.New("hijack unsupported")
}

func (r *StatusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

// NewGzipWriter reuses a pooled compressor for this response. Close releases it.
func NewGzipWriter(w http.ResponseWriter) *GzipWriter {
	gz := gzipPool.Get().(*gzip.Writer)
	gz.Reset(w)
	var disabled bool
	return &GzipWriter{ResponseWriter: w, w: gz, disabled: &disabled}
}

func (g *GzipWriter) Close() { g.w.Close(); gzipPool.Put(g.w) }

func (r *StatusRecorder) Status() int { return r.status }
func WriteJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	// Highlighted lines are already HTML-escaped by the time they get here, so
	// the extra \u003c encoding only inflates the payload and makes the API
	// awkward to read with anything but a JSON parser.
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}

func Fail(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func staticContentType(p string) string {
	ext := strings.ToLower(path.Ext(p))
	switch ext {
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".html":
		return "text/html; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".ico":
		return "image/x-icon"
	case ".woff2":
		return "font/woff2"
	case ".woff":
		return "font/woff"
	case ".ttf":
		return "font/ttf"
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

var (
	vendorFetchMu sync.Mutex
	vendorCDNs    = map[string]string{
		"vendor/mermaid-12.0.0.min.js": "https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.min.js",
	}
)

func vendorCacheDir() string {
	if c := os.Getenv("XDG_CACHE_HOME"); c != "" {
		return filepath.Join(c, "faah", "vendor")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".faah", "cache", "vendor")
	}
	return filepath.Join(os.TempDir(), "faah-cache", "vendor")
}

type memGzFile struct {
	*bytes.Reader
	name    string
	size    int64
	modTime time.Time
}

func (m *memGzFile) Stat() (fs.FileInfo, error) { return m, nil }
func (m *memGzFile) Close() error               { return nil }
func (m *memGzFile) Name() string               { return m.name }
func (m *memGzFile) Size() int64                { return m.size }
func (m *memGzFile) Mode() fs.FileMode          { return 0644 }
func (m *memGzFile) ModTime() time.Time         { return m.modTime }
func (m *memGzFile) IsDir() bool                { return false }
func (m *memGzFile) Sys() any                   { return nil }

func openOrFetchVendorAsset(rel string) (fs.File, error) {
	gzName := path.Base(rel) + ".gz"
	cachedPath := filepath.Join(vendorCacheDir(), gzName)

	// 1. Check local persistent cache
	if f, err := os.Open(cachedPath); err == nil {
		return f, nil
	}

	// 2. Check local repository web/ directory (for dev/test fallback)
	localGz := filepath.Join("web", filepath.FromSlash(rel)+".gz")
	if f, err := os.Open(localGz); err == nil {
		return f, nil
	}

	cdnURL, ok := vendorCDNs[rel]
	if !ok {
		return nil, os.ErrNotExist
	}

	vendorFetchMu.Lock()
	defer vendorFetchMu.Unlock()

	// Double-check cache after acquiring lock
	if f, err := os.Open(cachedPath); err == nil {
		return f, nil
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(cdnURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("CDN returned HTTP %d for %s", resp.StatusCode, rel)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Compress downloaded asset with gzip level 9
	var gzBuf bytes.Buffer
	gw, err := gzip.NewWriterLevel(&gzBuf, gzip.BestCompression)
	if err != nil {
		gw = gzip.NewWriter(&gzBuf)
	}
	if _, err := gw.Write(body); err != nil {
		gw.Close()
		return nil, err
	}
	if err := gw.Close(); err != nil {
		return nil, err
	}

	gzBytes := gzBuf.Bytes()

	// Cache to disk for offline and subsequent requests
	if err := os.MkdirAll(vendorCacheDir(), 0755); err == nil {
		tmpPath := cachedPath + fmt.Sprintf(".%d.tmp", time.Now().UnixNano())
		if err := os.WriteFile(tmpPath, gzBytes, 0644); err == nil {
			_ = os.Rename(tmpPath, cachedPath)
		}
	}

	if f, err := os.Open(cachedPath); err == nil {
		return f, nil
	}
	return &memGzFile{
		Reader:  bytes.NewReader(gzBytes),
		name:    gzName,
		size:    int64(len(gzBytes)),
		modTime: time.Now(),
	}, nil
}

func Static(sub fs.FS, prefix string) http.Handler {
	fileServer := http.StripPrefix(prefix, http.FileServer(http.FS(sub)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, prefix)
		rel = path.Clean(strings.TrimPrefix(rel, "/"))
		if rel == "." || strings.HasPrefix(rel, "..") {
			http.NotFound(w, r)
			return
		}

		if info, err := fs.Stat(sub, "dist/"+rel); err == nil && !info.IsDir() {
			r2 := r.Clone(r.Context())
			r2.URL.Path = prefix + "dist/" + rel
			fileServer.ServeHTTP(w, r2)
			return
		}

		// Check if a pre-compressed .gz asset exists for this path.
		gzPath := rel + ".gz"
		gzFile, err := sub.Open(gzPath)
		if err != nil && strings.HasPrefix(rel, "vendor/") {
			gzFile, err = openOrFetchVendorAsset(rel)
		}
		if err == nil {
			defer gzFile.Close()
			fi, err := gzFile.Stat()
			if err == nil && !fi.IsDir() {
				mimeType := staticContentType(rel)
				if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
					bypassGzip(w)
					w.Header().Set("Content-Type", mimeType)
					w.Header().Set("Content-Encoding", "gzip")
					w.Header().Set("Vary", "Accept-Encoding")
					if strings.HasPrefix(rel, "vendor/") {
						w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
					}
					if rs, ok := gzFile.(io.ReadSeeker); ok {
						http.ServeContent(w, r, path.Base(rel), fi.ModTime(), rs)
						return
					}
					io.Copy(w, gzFile)
					return
				}

				// Client does not accept gzip: decompress on the fly.
				gzReader, err := gzip.NewReader(gzFile)
				if err == nil {
					defer gzReader.Close()
					w.Header().Set("Content-Type", mimeType)
					w.Header().Set("Vary", "Accept-Encoding")
					if strings.HasPrefix(rel, "vendor/") {
						w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
					}
					io.Copy(w, gzReader)
					return
				}
			}
		}

		fileServer.ServeHTTP(w, r)
	})
}

// LocalPost admits a request that changes the machine only when it is a POST
// from faah's own page. Browsers send Origin on every POST, so a page from another
// site cannot pass. Requiring the Host to be an IP address or localhost also
// shuts out DNS rebinding, where an attacker's domain is pointed at this machine
// and its Origin would otherwise match.
func LocalPost(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		Fail(w, http.StatusMethodNotAllowed, "POST only")
		return false
	}
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if host != "localhost" && net.ParseIP(host) == nil {
		Fail(w, http.StatusForbidden, "open fibo by IP address or localhost to set up language servers")
		return false
	}
	if o, err := url.Parse(r.Header.Get("Origin")); err != nil || o.Host != r.Host {
		Fail(w, http.StatusForbidden, "request did not come from fibo")
		return false
	}
	return true
}
