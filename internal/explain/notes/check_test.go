package notes

import (
	"strings"
	"testing"
)

var auth = strings.Split("package main\n\n// reads the header.\nfunc checkToken(h string) bool {\n\treturn h != \"\"\n}\n\nfunc handle() {\n\tcheckToken(\"x\")\n}", "\n")

func read(rel string) ([]string, bool) {
	if rel == "auth.go" {
		return auth, true
	}
	return nil, false
}

func TestCheckNotes(t *testing.T) {
	in := []Note{
		{Kind: "symbol", Path: "auth.go", L1: 4, L2: 6, Symbol: "checkToken", Summary: "  Reads the header.  "},
		{Kind: "symbol", Path: "auth.go", L1: 2, L2: 2, Symbol: "checkToken", Summary: "Snaps to line 4."},
		{Kind: "block", Path: "auth.go", L1: 8, L2: 10, Summary: strings.Repeat("x", 200), Detail: strings.Repeat("d", 5000)},
		{Kind: "line", Path: "auth.go", L1: 40, L2: 40, Summary: "past the end"},
		{Kind: "symbol", Path: "auth.go", L1: 9, L2: 9, Symbol: "missing", Summary: "no such name"},
		{Kind: "symbol", Path: "auth.go", L1: 1, L2: 1, Symbol: "handle", Summary: "far away"},
		{Kind: "line", Path: "../etc/passwd", L1: 1, L2: 1, Summary: "outside"},
		{Kind: "box", Path: "auth.go", L1: 1, L2: 1, Summary: "bad kind"},
		{Kind: "line", Path: "auth.go", L1: 1, L2: 1, Summary: "  "},
		{Kind: "line", Path: "./auth.go", L1: 1, Summary: "Cleaned path."},
	}
	ok, errs := CheckNotes(read, in)
	if len(ok) != 4 || ok[3].Path != "auth.go" || ok[3].L2 != 1 {
		t.Fatalf("kept %d notes: %+v\nerrors: %v", len(ok), ok, errs)
	}
	if n := ok[0]; n.L1 != 4 || n.L2 != 4 || n.Summary != "Reads the header." || n.Text != "func checkToken(h string) bool {" {
		t.Fatalf("symbol note = %+v", n)
	}
	if n := ok[1]; n.L1 != 4 || n.L2 != 4 {
		t.Fatalf("snapped note = %+v", n)
	}
	if n := ok[2]; len([]rune(n.Summary)) != 120 || len(n.Detail) != 4000 || cut(strings.Repeat("詳", 5000), maxBody) != strings.Repeat("詳", 4000) || n.Text != "func handle() {\n\tcheckToken(\"x\")\n}" {
		t.Fatalf("block note = %+v", n)
	}
	want := []string{
		"notes[3]: auth.go:40 is past the end of the file (10 lines)",
		"notes[4]: missing is not in auth.go",
		"notes[5]: handle is not on auth.go:1; it is on line 8",
		"notes[6]: ../etc/passwd is not a file in the workspace",
		"notes[7]: kind must be symbol, line or block",
		"notes[8]: summary is empty",
	}
	if strings.Join(errs, "\n") != strings.Join(want, "\n") {
		t.Fatalf("errors:\n%s\nwant:\n%s", strings.Join(errs, "\n"), strings.Join(want, "\n"))
	}
	if _, errs := CheckNotes(read, nil); len(errs) != 1 || errs[0] != "annotate takes 1 to 100 notes" {
		t.Fatalf("empty call = %v", errs)
	}
}

func TestCheckWalkthrough(t *testing.T) {
	w := Walkthrough{Title: "Login", Steps: []Step{
		{Path: "auth.go", L1: 8, L2: 10, Title: "Handler", Body: "Calls checkToken."},
		{Path: "auth.go", L1: 4, L2: 6, Title: "Check", Body: "Reads the header."},
	}}
	got, err := CheckWalkthrough(read, w)
	if err != nil || got.Steps[1].Text != "func checkToken(h string) bool {\n\treturn h != \"\"\n}" {
		t.Fatalf("walkthrough = %+v, %v", got, err)
	}
	w.Steps[1].L2 = 99
	if _, err := CheckWalkthrough(read, w); err == nil || err.Error() != "step 2: auth.go:4-99 is past the end of the file (10 lines)" {
		t.Fatalf("bad step error = %v", err)
	}
	if _, err := CheckWalkthrough(read, Walkthrough{Title: "x", Steps: w.Steps[:1]}); err == nil || err.Error() != "a walkthrough has 2 to 20 steps" {
		t.Fatalf("one step error = %v", err)
	}
}
