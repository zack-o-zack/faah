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
	ThemeBootstrap = `(()=>{const r=document.documentElement;r.dataset.theme||=(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const d=getComputedStyle(r).colorScheme==='dark';r.classList.toggle('dark',d);r.dataset.codeTheme=(d?r.dataset.codeThemeDark:r.dataset.codeThemeLight)||''})()`
)

// ThemeChoice is what the document carries before first paint: the app theme
// preference and one code theme preference for each scheme.
type ThemeChoice struct {
	Theme     string
	CodeLight string
	CodeDark  string
}

// CodeTheme is a theme that paints code surfaces, sorted into a scheme.
type CodeTheme struct {
	ID     string
	Scheme string // "light" or "dark", from the theme's own color-scheme
}

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

// joinThemesCSS joins built-in theme files in filename order: the app themes
// first, then the code themes, which only reach code surfaces.
func joinThemesCSS(assets fs.FS) (string, error) {
	var css strings.Builder
	for _, pattern := range []string{"web/themes/*.css", "web/code-themes/*.css"} {
		names, err := fs.Glob(assets, pattern)
		if err != nil {
			return "", err
		}
		for _, name := range names {
			b, err := fs.ReadFile(assets, name)
			if err != nil {
				return "", err
			}
			css.WriteString("/* " + strings.TrimPrefix(name, "web/") + " */\n")
			css.Write(b)
			css.WriteByte('\n')
		}
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
	themeBlocks   = regexp.MustCompile(`(?s)([^{}]+)\{([^{}]*)\}`)
	themeSelector = regexp.MustCompile(`^(?::root|html)?\[data-theme=["']?([\w-]+)["']?\]$`)
	// A code theme reaches code surfaces only, so its selector always ends in .code-surface.
	codeThemeSelector = regexp.MustCompile(`^(?::root|html)?\[data-code-theme=["']?([\w-]+)["']?\]\s+\.code-surface$`)
	colorScheme       = regexp.MustCompile(`color-scheme:\s*(\w+)`)
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

// CodeThemes lists the code themes with the scheme each declares. A theme that
// declares no color-scheme sorts into the light list.
func (t *ThemeStyles) CodeThemes() []CodeTheme {
	css, err := t.css()
	if err != nil {
		log.Printf("themes: discover code themes: %v", err)
		return nil
	}
	found := make(map[string]CodeTheme)
	for _, block := range themeBlocks.FindAllStringSubmatch(themeComments.ReplaceAllString(css, ""), -1) {
		scheme := "light"
		if match := colorScheme.FindStringSubmatch(block[2]); match != nil && match[1] == "dark" {
			scheme = "dark"
		}
		for _, selector := range strings.Split(block[1], ",") {
			if match := codeThemeSelector.FindStringSubmatch(strings.TrimSpace(selector)); match != nil {
				found[match[1]] = CodeTheme{ID: match[1], Scheme: scheme}
			}
		}
	}
	themes := make([]CodeTheme, 0, len(found))
	for _, theme := range found {
		themes = append(themes, theme)
	}
	sort.Slice(themes, func(i, j int) bool { return themes[i].ID < themes[j].ID })
	return themes
}

// CodeIDs returns every code theme id, sorted by id.
func (t *ThemeStyles) CodeIDs() []string {
	themes := t.CodeThemes()
	ids := make([]string, 0, len(themes))
	for _, theme := range themes {
		ids = append(ids, theme.ID)
	}
	return ids
}

// CodeIDsByScheme returns the code theme ids that declare one scheme.
func (t *ThemeStyles) CodeIDsByScheme(scheme string) []string {
	var ids []string
	for _, theme := range t.CodeThemes() {
		if theme.Scheme == scheme {
			ids = append(ids, theme.ID)
		}
	}
	return ids
}

// HasCode accepts empty as "use the app theme's code colours".
func (t *ThemeStyles) HasCode(id string) bool {
	if id == "" {
		return true
	}
	for _, known := range t.CodeIDs() {
		if known == id {
			return true
		}
	}
	return false
}

// HTML applies the validated themes while preserving unknown app theme
// preferences for client fallback. Unknown code themes fall back to the app theme.
func (t *ThemeStyles) HTML(html string, choice ThemeChoice) string {
	theme := choice.Theme
	if !t.Has(theme) {
		theme = ""
	}
	light, dark := choice.CodeLight, choice.CodeDark
	if !t.HasCode(light) {
		light = ""
	}
	if !t.HasCode(dark) {
		dark = ""
	}
	attributes := `data-theme="` + template.HTMLEscapeString(theme) +
		`" data-theme-preference="` + template.HTMLEscapeString(choice.Theme) +
		`" data-code-theme-light="` + template.HTMLEscapeString(light) +
		`" data-code-theme-dark="` + template.HTMLEscapeString(dark) + `"`
	html = strings.Replace(html, `data-theme=""`, attributes, 1)
	return strings.Replace(html, "</head>", "<script>"+ThemeBootstrap+"</script>\n</head>", 1)
}
