package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/forge"
	"faah/internal/git"
	"faah/internal/git/gittest"
	prpkg "faah/internal/pr"
	"faah/internal/render"
	"faah/internal/workspace"
)

func TestDiffOptions(t *testing.T) {
	for _, mode := range []string{"working", "pr", "ref", "range", "root"} {
		t.Run(mode, func(t *testing.T) {
			root := gittest.Repo(t)
			run := func(args ...string) string { return strings.TrimSpace(gittest.Run(t, root, args...)) }
			run("reset", "--hard", "HEAD")
			write := func(text string) {
				t.Helper()
				if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte(text), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(root, "keep.go"), []byte("first\n\nkeep\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			run("add", "keep.go")
			run("commit", "--amend", "--no-edit", "-q")
			write("first\n\n  indent\nold\n\nlast\n")
			run("add", "file.txt")
			run("commit", "-qm", "base")
			base := run("rev-parse", "HEAD")
			write("first\nindent\nreal\n\nlast\n")
			run("commit", "-qam", "change")
			head := run("rev-parse", "HEAD")
			write("first\n    indent\nlocal\nlast\n")
			index := workspace.NewIndex(root)
			index.Build()
			srv := &Server{ix: index, diffBase: base, prHeadSHA: head}
			query := "path=file.txt"
			exact := map[string]string{"diff": git.DiffAgainst(root, "file.txt", base)}
			switch mode {
			case "pr":
				srv.pr = prpkg.New(nil, forge.PRTarget{Owner: "o", Repo: "r"}, forge.PRMeta{Number: 1, HeadSHA: head}, "", base)
				exact["prDiff"] = git.DiffBetween(root, "file.txt", base, head)
				exact["yourDiff"] = git.DiffAgainst(root, "file.txt", head)
			case "ref":
				query += "&ref=" + head
				exact["diff"] = git.DiffCommit(root, "file.txt", head)
			case "range":
				query += "&base=" + base + "&ref=" + head
				exact["diff"] = git.DiffBetween(root, "file.txt", base, head)
			case "root":
				query += "&ref=" + run("rev-list", "--max-parents=0", "HEAD")
				query = strings.ReplaceAll(query, "file.txt", "keep.go")
				exact["diff"] = git.DiffCommit(root, "keep.go", run("rev-list", "--max-parents=0", "HEAD"))
			}
			read := func(suffix string) map[string]json.RawMessage {
				t.Helper()
				trace := filepath.Join(t.TempDir(), "git-trace.json")
				t.Setenv("GIT_TRACE2_EVENT", trace)
				response := httptest.NewRecorder()
				srv.handleDiff(response, httptest.NewRequest("GET", "/api/diff?"+query+suffix, nil))
				var result map[string]json.RawMessage
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(trace)
				if err != nil {
					t.Fatal(err)
				}
				count := strings.Count(string(data), `"event":"start"`)
				want := 1
				if mode == "pr" {
					want = 3
				}
				if suffix != "" {
					want *= 2
				}
				t.Logf("%s ignoreWhitespace=%t: %d Git subprocesses", mode, suffix != "", count)
				if count != want {
					t.Errorf("Git subprocesses = %d, want %d", count, want)
				}
				return result
			}
			exactResponse := read("")
			filtered := read("&ignoreWhitespace=1")
			for field, want := range exact {
				var text string
				if err := json.Unmarshal(exactResponse[field], &text); err != nil {
					t.Fatal(err)
				}
				if text != want {
					t.Fatalf("exact %s changed: %q != %q", field, text, want)
				}
				hunkField := strings.TrimSuffix(field, "Diff") + "Hunks"
				if field == "diff" {
					hunkField = "hunks"
				}
				var hunks []render.DiffHunk
				if err := json.Unmarshal(filtered[hunkField], &hunks); err != nil {
					t.Fatal(err)
				}
				changed := 0
				for _, hunk := range hunks {
					for _, row := range hunk.Rows {
						if row.Type == "ctx" {
							continue
						}
						changed++
						if strings.TrimSpace(row.Text) == "" || strings.TrimSpace(row.Text) == "indent" {
							t.Errorf("%s kept whitespace edit: %#v", field, row)
						}
						if row.Type == "add" && row.Text == "local" && row.NewLine != 3 {
							t.Errorf("lost real line number: %#v", row)
						}
					}
				}
				if changed == 0 {
					t.Errorf("%s lost real change", field)
				}
			}
			if mode == "root" {
				return
			}
			write("first\nindent\nold\n\nlast\n")
			if mode == "working" {
				filtered = read("&ignoreWhitespace=1")
				var hunks []render.DiffHunk
				if err := json.Unmarshal(filtered["hunks"], &hunks); err != nil {
					t.Fatal(err)
				}
				if filtered["available"] == nil || string(filtered["available"]) != "true" || len(hunks) != 0 {
					t.Fatalf("whitespace-only file must remain available: %s", filtered)
				}
			}
			gutter := httptest.NewRecorder()
			ignoredGutter := httptest.NewRecorder()
			srv.handleGutter(gutter, httptest.NewRequest("GET", "/api/gutter?path=file.txt", nil))
			srv.handleGutter(ignoredGutter, httptest.NewRequest("GET", "/api/gutter?path=file.txt&ignoreWhitespace=1", nil))
			if gutter.Body.String() != ignoredGutter.Body.String() {
				t.Fatal("gutter changed with display option")
			}
		})
	}
}
