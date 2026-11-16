package httpx

import (
	"html/template"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const (
	maxThemeFile  = 256 << 10
	maxUserThemes = 1 << 20
	// ThemeBootstrap is allowed by its hash in ContentSecurityPolicy.
	ThemeBootstrap = `(()=>{const r=document.documentElement;r.dataset.theme||=(matchMedia('(prefers-color-scheme: dark)').matches?'fibo-dark':'fibo-light');r.classList.toggle('dark',getComputedStyle(r).colorScheme==='dark')})()`
)

// ThemeStyles caches only embedded CSS. User files are re-read for every request.
type ThemeStyles struct {
	assets           fs.FS
	devRoot, dataDir string
	once             sync.Once
	builtin          string
	err              error
}

func Themes(assets fs.FS, devRoot, dataDir string) *ThemeStyles {
	return &ThemeStyles{assets: assets, devRoot: devRoot, dataDir: dataDir}
}

// joinThemesCSS joins built-in theme files in filename order.
func joinThemesCSS(assets fs.FS) (string, error) {
	names, err := fs.Glob(assets, "web/themes/*.css")
	if err != nil {
		return "", err
	}
	var css strings.Builder
	for _, name := range names {
		b, err := fs.ReadFile(assets, name)
		if err != nil {
			return "", err
		}
		css.WriteString("/* " + strings.TrimPrefix(name, "web/") + " */\n")
		css.Write(b)
		css.WriteByte('\n')
	}
	return css.String(), nil
}

func (t *ThemeStyles) css() (string, error) {
	var builtin string
	var err error
	if t.devRoot != "" {
		builtin, err = joinThemesCSS(os.DirFS(t.devRoot))
	} else {
		t.once.Do(func() { t.builtin, t.err = joinThemesCSS(t.assets) })
		builtin, err = t.builtin, t.err
	}
	if err != nil {
		return "", err
	}
	return builtin + t.userCSS(), nil
}

func (t *ThemeStyles) userCSS() string {
	if t.dataDir == "" {
		return ""
	}
	dir := filepath.Join(t.dataDir, "themes")
	entries, err := os.ReadDir(dir) // ReadDir sorts by filename.
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("themes: read %s: %v", dir, err)
		}
		return ""
	}
	var css strings.Builder
	total := 0
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".css") {
			continue
		}
		name := filepath.Join(dir, entry.Name())
		info, err := entry.Info()
		if err != nil || !entry.Type().IsRegular() || info.Size() > maxThemeFile {
			log.Printf("themes: skip %s (not a readable regular file within 256 KB): %v", name, err)
			continue
		}
		f, err := os.Open(name)
		if err != nil {
			log.Printf("themes: read %s: %v", name, err)
			continue
		}
		b, err := io.ReadAll(io.LimitReader(f, maxThemeFile+1))
		f.Close()
		if err != nil || len(b) > maxThemeFile || total+len(b) > maxUserThemes {
			log.Printf("themes: skip %s (read failed or size cap exceeded): %v", name, err)
			continue
		}
		total += len(b)
		css.WriteString("/* themes/" + entry.Name() + " */\n")
		css.Write(b)
		css.WriteByte('\n')
	}
	return css.String()
}

func (t *ThemeStyles) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := t.css()
	if err != nil {
		Fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	io.WriteString(w, body)
}

var (
	themeComments = regexp.MustCompile(`(?s)/\*.*?\*/`)
	themeRules    = regexp.MustCompile(`([^{}]+)\{`)
	themeSelector = regexp.MustCompile(`^(?::root|html)?\[data-theme=["']?([\w-]+)["']?\]$`)
)

// IDs follows the same selector contract as client-side CSS discovery.
func (t *ThemeStyles) IDs() []string {
	css, err := t.css()
	if err != nil {
		log.Printf("themes: discover: %v", err)
		return nil
	}
	found := make(map[string]bool)
	for _, rule := range themeRules.FindAllStringSubmatch(themeComments.ReplaceAllString(css, ""), -1) {
		for _, selector := range strings.Split(rule[1], ",") {
			if match := themeSelector.FindStringSubmatch(strings.TrimSpace(selector)); match != nil {
				found[match[1]] = true
			}
		}
	}
	ids := make([]string, 0, len(found))
	for id := range found {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// Has accepts empty as follow-system, but never aliases an unknown theme ID.
func (t *ThemeStyles) Has(id string) bool {
	if id == "" {
		return true
	}
	for _, known := range t.IDs() {
		if known == id {
			return true
		}
	}
	return false
}

// HTML applies the validated theme while preserving an unknown preference for client fallback.
func (t *ThemeStyles) HTML(html, preference string) string {
	theme := preference
	if !t.Has(theme) {
		theme = ""
	}
	html = strings.Replace(html, `data-theme=""`, `data-theme="`+template.HTMLEscapeString(theme)+`" data-theme-preference="`+template.HTMLEscapeString(preference)+`"`, 1)
	return strings.Replace(html, "</head>", "<script>"+ThemeBootstrap+"</script>\n</head>", 1)
}
