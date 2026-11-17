package httpx

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func themeResponse(t *testing.T, themes *ThemeStyles) string {
	t.Helper()
	w := httptest.NewRecorder()
	themes.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/static/themes.css", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if w.Header().Get("Content-Type") != "text/css; charset=utf-8" {
		t.Fatal("missing CSS content type")
	}
	return w.Body.String()
}

func writeTheme(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "themes"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "themes", name), []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestThemesLoadOrderAndLiveUserFiles(t *testing.T) {
	assets := fstest.MapFS{
		"web/themes/b.css": {Data: []byte(`:root[data-theme="builtin-b"] { --ink: blue; }`)},
		"web/themes/a.css": {Data: []byte(`:root[data-theme="builtin-a"] { --ink: green; }`)},
	}
	dir := t.TempDir()
	writeTheme(t, dir, "z.css", `:root[data-theme="builtin-a"] { --ink: purple; }`)
	writeTheme(t, dir, "a.css", `html[data-theme="custom"] { --ink: teal; }`)
	writeTheme(t, dir, "ignored.txt", "DO_NOT_SERVE")
	themes := Themes(assets, "", dir)
	body := themeResponse(t, themes)
	last := -1
	for _, want := range []string{"/* themes/a.css */", "/* themes/b.css */", "custom", "purple"} {
		index := strings.Index(body, want)
		if index <= last {
			t.Fatalf("load order for %q: %s", want, body)
		}
		last = index
	}
	if strings.Contains(body, "DO_NOT_SERVE") {
		t.Fatal("non-CSS file served")
	}
	if got := strings.Join(themes.IDs(), ","); got != "builtin-a,builtin-b,custom" {
		t.Fatalf("discovered %q", got)
	}
	assets["web/themes/a.css"].Data = []byte("BUILTIN_CHANGED")
	writeTheme(t, dir, "z.css", "USER_CHANGED")
	body = themeResponse(t, themes)
	if strings.Contains(body, "BUILTIN_CHANGED") || !strings.Contains(body, "USER_CHANGED") {
		t.Fatal("only built-ins should be cached")
	}
}

func TestThemesMissingDirectoryAndDevRoot(t *testing.T) {
	themes := Themes(fstest.MapFS{}, "", filepath.Join(t.TempDir(), "missing"))
	if got := themeResponse(t, themes); got != "" {
		t.Fatalf("missing directory: %q", got)
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "web", "themes"), 0700); err != nil {
		t.Fatal(err)
	}
	themes = Themes(fstest.MapFS{}, root, t.TempDir())
	for _, want := range []string{"FIRST", "SECOND"} {
		if err := os.WriteFile(filepath.Join(root, "web", "themes", "live.css"), []byte(want), 0600); err != nil {
			t.Fatal(err)
		}
		if body := themeResponse(t, themes); !strings.Contains(body, want) {
			t.Fatalf("dev root not reread: %s", body)
		}
	}
}

func TestThemesCaps(t *testing.T) {
	dir := t.TempDir()
	writeTheme(t, dir, "a-oversize.css", strings.Repeat("X", maxThemeFile+1))
	for _, name := range []string{"b.css", "c.css", "d.css", "e.css"} {
		writeTheme(t, dir, name, strings.Repeat("Y", maxThemeFile))
	}
	writeTheme(t, dir, "f-over-total.css", "OVER_TOTAL")
	body := themeResponse(t, Themes(fstest.MapFS{}, "", dir))
	if strings.Contains(body, "X") || strings.Contains(body, "OVER_TOTAL") {
		t.Fatal("oversize file served")
	}
	if strings.Count(body, "Y") != maxUserThemes {
		t.Fatalf("accepted bytes %d", strings.Count(body, "Y"))
	}
}

func TestThemesSkipUnreadableAndNonRegularFiles(t *testing.T) {
	dir := t.TempDir()
	writeTheme(t, dir, "unreadable.css", "UNREADABLE")
	if err := os.Chmod(filepath.Join(dir, "themes", "unreadable.css"), 0); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "themes", "folder.css"), 0700); err != nil {
		t.Fatal(err)
	}
	writeTheme(t, dir, "valid.css", "VALID")
	body := themeResponse(t, Themes(fstest.MapFS{}, "", dir))
	if !strings.Contains(body, "VALID") {
		t.Fatal("readable theme skipped")
	}
	if os.Getuid() != 0 && strings.Contains(body, "UNREADABLE") {
		t.Fatal("unreadable theme included")
	}
}

func TestThemeDiscoveryAndBootstrapContract(t *testing.T) {
	themes := Themes(fstest.MapFS{"web/themes/test.css": {Data: []byte(`
 /* :root[data-theme="comment"] {} */
 @media screen { :root[data-theme='first'], [data-theme=second] { --ink: green; } }
 .nested [data-theme="not-root"] { --ink: green; }
 `)}}, "", "")
	if got := strings.Join(themes.IDs(), ","); got != "first,second" {
		t.Fatalf("IDs %q", got)
	}
	if !themes.Has("") || themes.Has("missing") {
		t.Fatal("unknown theme must not be aliased")
	}
	sum := sha256.Sum256([]byte(ThemeBootstrap))
	if !strings.Contains(ContentSecurityPolicy, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'") {
		t.Fatal("theme script not allowed by CSP")
	}
}

func TestCodeThemesServedAndDiscoveredSeparately(t *testing.T) {
	assets := fstest.MapFS{
		"web/themes/app.css": {Data: []byte(`:root[data-theme="app"] { --ink: blue; }`)},
		"web/code-themes/night.css": {Data: []byte(
			`:root[data-code-theme="night"] .code-surface { --theme-name: "Night"; color-scheme: dark; }`)},
		"web/code-themes/day.css": {Data: []byte(
			`:root[data-code-theme="day"] .code-surface { --theme-name: "Day"; color-scheme: light; }`)},
		"web/code-themes/plain.css": {Data: []byte(
			`:root[data-code-theme="plain"] .code-surface { --foreground: black; }`)},
	}
	dir := t.TempDir()
	writeTheme(t, dir, "user.css", `:root[data-code-theme="mine"] .code-surface { color-scheme: dark; }`)
	writeTheme(t, dir, "app.css", `:root[data-theme="user-app"] { --ink: teal; }`)
	themes := Themes(assets, "", dir)

	body := themeResponse(t, themes)
	for _, want := range []string{"/* code-themes/day.css */", "/* code-themes/night.css */", "/* themes/user.css */"} {
		if !strings.Contains(body, want) {
			t.Fatalf("stylesheet missing %q", want)
		}
	}

	if got := strings.Join(themes.IDs(), ","); got != "app,user-app" {
		t.Fatalf("app theme discovery %q", got)
	}
	if got := strings.Join(themes.CodeIDs(), ","); got != "day,mine,night,plain" {
		t.Fatalf("code theme discovery %q", got)
	}
	// A code theme without color-scheme sorts into the light list.
	if got := strings.Join(themes.CodeIDsByScheme("light"), ","); got != "day,plain" {
		t.Fatalf("light code themes %q", got)
	}
	if got := strings.Join(themes.CodeIDsByScheme("dark"), ","); got != "mine,night" {
		t.Fatalf("dark code themes %q", got)
	}
	if themes.Has("night") || themes.HasCode("app") {
		t.Fatal("app and code theme namespaces must stay separate")
	}
	if !themes.HasCode("") || themes.HasCode("missing") {
		t.Fatal("unknown code theme must not be aliased")
	}
}

func TestCodeThemeHTMLInjection(t *testing.T) {
	themes := Themes(fstest.MapFS{
		"web/themes/app.css": {Data: []byte(`:root[data-theme="app"] { --ink: blue; }`)},
		"web/code-themes/night.css": {Data: []byte(
			`:root[data-code-theme="night"] .code-surface { color-scheme: dark; }`)},
	}, "", "")
	page := `<html data-theme=""><head></head><body></body></html>`

	html := themes.HTML(page, ThemeChoice{Theme: "app", CodeLight: "day", CodeDark: "night"})
	for _, want := range []string{
		`data-theme="app"`,
		`data-theme-preference="app"`,
		`data-code-theme-light=""`, // unknown id falls back to the app theme's code colours
		`data-code-theme-dark="night"`,
		`<script>` + ThemeBootstrap + `</script>`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("document missing %q: %s", want, html)
		}
	}

	// An unavailable app theme keeps its preference for the client, but the document paints the fallback.
	html = themes.HTML(page, ThemeChoice{Theme: "gone", CodeLight: "night", CodeDark: "gone"})
	for _, want := range []string{
		`data-theme=""`,
		`data-theme-preference="gone"`,
		`data-code-theme-light="night"`,
		`data-code-theme-dark=""`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("document missing %q: %s", want, html)
		}
	}
}
