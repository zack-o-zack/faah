package explain

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"faah/internal/codeintel"
	"faah/internal/symbols"
)

func intp(n int) *int { return &n }

func TestClassifyExplain(t *testing.T) {
	lines := []string{"package main", "", "func NewIndex(root string) *Index {", "\treturn &Index{root: root}", "}", "x := x + x"}
	cases := []struct {
		name   string
		req    Request
		symbol string
		col    int
		text   string
		err    error
	}{
		{name: "identifier", req: Request{L1: 3, C1: intp(5), L2: 3, C2: intp(13), Text: "NewIndex"}, symbol: "NewIndex", col: 5, text: "NewIndex"},
		{name: "padded identifier", req: Request{L1: 3, C1: intp(4), L2: 3, C2: intp(13), Text: " NewIndex"}, symbol: "NewIndex", col: 5, text: "NewIndex"},
		{name: "any lone word reads as a symbol", req: Request{L1: 4, C1: intp(1), L2: 4, C2: intp(7), Text: "return"}, symbol: "return", col: 1, text: "return"},
		{name: "two tokens", req: Request{L1: 3, C1: intp(0), L2: 3, C2: intp(13), Text: "func NewIndex"}, col: -1, text: "func NewIndex"},
		{name: "multi line selection", req: Request{L1: 3, C1: intp(0), L2: 5, C2: intp(1), Text: strings.Join(lines[2:5], "\n")}, col: -1, text: strings.Join(lines[2:5], "\n")},
		{name: "diff identifier found once", req: Request{L1: 3, L2: 3, Text: "NewIndex"}, symbol: "NewIndex", col: 5, text: "NewIndex"},
		{name: "diff identifier repeated is a block", req: Request{L1: 6, L2: 6, Text: "x"}, col: -1, text: lines[5]},
		{name: "diff with deleted line between", req: Request{L1: 3, L2: 5, Text: lines[2] + "\nold line\n" + lines[3] + "\n}"}, col: -1, text: strings.Join(lines[2:5], "\n")},
		{name: "text differs from disk", req: Request{L1: 3, C1: intp(5), L2: 3, C2: intp(13), Text: "OldIndex"}, err: ErrMismatch},
		{name: "diff text differs from disk", req: Request{L1: 3, L2: 3, Text: "OldIndex"}, err: ErrMismatch},
		{name: "line past the end", req: Request{L1: 40, L2: 40, Text: "x"}, err: ErrMismatch},
		{name: "blank", req: Request{L1: 2, L2: 2, Text: "  \n"}, err: ErrBlank},
		{name: "too long", req: Request{L1: 1, L2: 401, Text: "x"}, err: ErrTooLong},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Classify(lines, c.req)
			if !errors.Is(err, c.err) {
				t.Fatalf("err = %v, want %v", err, c.err)
			}
			if c.err != nil {
				return
			}
			if got.Name != c.symbol || got.Col != c.col || got.Text != c.text {
				t.Fatalf("target = %+v, want name %q col %d text %q", got, c.symbol, c.col, c.text)
			}
		})
	}
}

func TestClassifyExplainCountsUTF16Columns(t *testing.T) {
	lines := []string{`s := "😀"; NewIndex()`}
	col := len([]rune(`s := "`)) + 2 + len([]rune(`"; `)) // the emoji is two UTF-16 units
	got, err := Classify(lines, Request{L1: 1, C1: intp(col), L2: 1, C2: intp(col + 8), Text: "NewIndex"})
	if err != nil || got.Name != "NewIndex" || got.Col != col {
		t.Fatalf("target = %+v, err = %v", got, err)
	}
	got, err = Classify(lines, Request{L1: 1, L2: 1, Text: "NewIndex"})
	if err != nil || got.Col != col {
		t.Fatalf("diff target = %+v, err = %v, want col %d", got, err, col)
	}
}

// fakeIntel answers the language-server questions from fixed tables.
type fakeIntel struct {
	defs    map[string][]codeintel.NavHit // keyed by identifier-at-position "line:col"
	refs    []codeintel.NavHit
	hover   map[string]*codeintel.HoverInfo
	syms    map[string][]symbols.Symbol
	prepare []codeintel.CallNode
	callers []codeintel.CallNode
	callees []codeintel.CallNode
}

func posKey(line, col int) string {
	return codeintel.LineRef(line, line) + ":" + codeintel.LineRef(col, col)
}

func (f *fakeIntel) Definition(_ context.Context, _, _ string, line, col int) ([]codeintel.NavHit, error) {
	return f.defs[posKey(line, col)], nil
}
func (f *fakeIntel) References(context.Context, string, string, int, int) ([]codeintel.NavHit, error) {
	return f.refs, nil
}
func (f *fakeIntel) Hover(_ context.Context, _, _ string, line, col int) (*codeintel.HoverInfo, error) {
	return f.hover[posKey(line, col)], nil
}
func (f *fakeIntel) Symbols(_ context.Context, _, rel string) ([]symbols.Symbol, error) {
	return f.syms[rel], nil
}
func (f *fakeIntel) PrepareCalls(context.Context, string, string, int, int) ([]codeintel.CallNode, error) {
	return f.prepare, nil
}
func (f *fakeIntel) Calls(_ context.Context, _, _ string, outgoing bool) ([]codeintel.CallNode, error) {
	if outgoing {
		return f.callees, nil
	}
	return f.callers, nil
}

const explainFixture = "package main\n\nfunc Caller() {\n\tv := 1\n\tNewIndex(v)\n}\n\n// NewIndex builds one.\nfunc NewIndex(n int) int {\n\treturn n\n}\n"

// intel is the code-intelligence half of a Workspace.
type intel interface {
	Definition(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error)
	References(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error)
	Hover(ctx context.Context, abs, rel string, line, col int) (*codeintel.HoverInfo, error)
	Symbols(ctx context.Context, abs, rel string) ([]symbols.Symbol, error)
	PrepareCalls(ctx context.Context, abs, rel string, line, col int) ([]codeintel.CallNode, error)
	Calls(ctx context.Context, rel, item string, outgoing bool) ([]codeintel.CallNode, error)
}

// testWorkspace is a Workspace made of a fake intel and replaceable functions.
type testWorkspace struct {
	intel   intel
	ready   func(ctx context.Context, abs, rel string) string
	outline func(abs, rel string) ([]symbols.Symbol, error)
	search  func(ctx context.Context, name string) []codeintel.FileMatches
	abs     func(rel string) (string, bool)
}

func (w *testWorkspace) Definition(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error) {
	return w.intel.Definition(ctx, abs, rel, line, col)
}
func (w *testWorkspace) References(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error) {
	return w.intel.References(ctx, abs, rel, line, col)
}
func (w *testWorkspace) Hover(ctx context.Context, abs, rel string, line, col int) (*codeintel.HoverInfo, error) {
	return w.intel.Hover(ctx, abs, rel, line, col)
}
func (w *testWorkspace) Symbols(ctx context.Context, abs, rel string) ([]symbols.Symbol, error) {
	return w.intel.Symbols(ctx, abs, rel)
}
func (w *testWorkspace) PrepareCalls(ctx context.Context, abs, rel string, line, col int) ([]codeintel.CallNode, error) {
	return w.intel.PrepareCalls(ctx, abs, rel, line, col)
}
func (w *testWorkspace) Calls(ctx context.Context, rel, item string, outgoing bool) ([]codeintel.CallNode, error) {
	return w.intel.Calls(ctx, rel, item, outgoing)
}
func (w *testWorkspace) Ready(ctx context.Context, abs, rel string) string {
	return w.ready(ctx, abs, rel)
}
func (w *testWorkspace) Outline(abs, rel string) ([]symbols.Symbol, error) {
	return w.outline(abs, rel)
}
func (w *testWorkspace) Search(ctx context.Context, name string) []codeintel.FileMatches {
	return w.search(ctx, name)
}
func (w *testWorkspace) Abs(rel string) (string, bool) { return w.abs(rel) }

func explainFixtureDeps(t *testing.T, root string, intel *fakeIntel) *testWorkspace {
	t.Helper()
	return &testWorkspace{
		intel: intel,
		ready: func(context.Context, string, string) string { return "gopls" },
		outline: func(abs, rel string) ([]symbols.Symbol, error) {
			return symbols.Outline(abs, rel)
		},
		search: func(context.Context, string) []codeintel.FileMatches { return nil },
		abs:    func(rel string) (string, bool) { return filepath.Join(root, filepath.FromSlash(rel)), true },
	}
}

func explainFixtureIntel() *fakeIntel {
	syms := []symbols.Symbol{
		{Name: "Caller", Kind: "func", Line: 3, End: 6},
		{Name: "NewIndex", Kind: "func", Line: 9, End: 11},
	}
	return &fakeIntel{
		defs:  map[string][]codeintel.NavHit{posKey(5, 1): {{Path: "main.go", Line: 9, Def: true}}, posKey(9, 5): {{Path: "main.go", Line: 9, Def: true}}, posKey(4, 1): {{Path: "main.go", Line: 4, Def: true}}},
		hover: map[string]*codeintel.HoverInfo{posKey(5, 1): {Signature: `<i class=k>func</i> NewIndex(n <i class=kt>int</i>) &lt;int&gt;`, Doc: "NewIndex builds one."}},
		syms:  map[string][]symbols.Symbol{"main.go": syms},
		refs: []codeintel.NavHit{
			{Path: "main.go", Line: 9, Mid: "NewIndex"},
			{Path: "main.go", Line: 5, Mid: "NewIndex"},
			{Path: "other_test.go", Line: 3, Mid: "NewIndex"},
			{Path: "lib.go", Line: 7, Mid: "NewIndex"},
			{Path: "/go/fmt.go", Line: 2, Mid: "NewIndex", Ext: true},
		},
		prepare: []codeintel.CallNode{{Name: "NewIndex", Item: "item"}},
		callers: []codeintel.CallNode{{Name: "Caller", Path: "main.go", Line: 3}},
		callees: []codeintel.CallNode{{Name: "helper", Path: "lib.go", Line: 12}},
	}
}

func explainFixtureRoot(t *testing.T) (string, string, []string) {
	t.Helper()
	root := t.TempDir()
	abs := filepath.Join(root, "main.go")
	if err := os.WriteFile(abs, []byte(explainFixture), 0o644); err != nil {
		t.Fatal(err)
	}
	return root, abs, strings.Split(explainFixture, "\n")
}

func symbolTarget(abs string, line, col int, name string) Target {
	return Target{Abs: abs, Rel: "main.go", L1: line, L2: line, Col: col, Name: name, Text: name}
}

func TestGatherExplainWorkspaceSymbol(t *testing.T) {
	root, abs, lines := explainFixtureRoot(t)
	ev := Gather(context.Background(), explainFixtureDeps(t, root, explainFixtureIntel()), symbolTarget(abs, 5, 1, "NewIndex"), lines)
	if ev.Kind != KindSymbol || ev.Source != "gopls" {
		t.Fatalf("evidence = %+v", ev)
	}
	for _, want := range []string{"func NewIndex(n int) <int>", "NewIndex builds one.", "return n", "Caller (main.go:3)", "helper (lib.go:12)", "lib.go:7"} {
		if !strings.Contains(ev.Packet, want) {
			t.Errorf("packet lacks %q:\n%s", want, ev.Packet)
		}
	}
	if strings.Contains(ev.Packet, "<i class") {
		t.Errorf("packet kept hover HTML:\n%s", ev.Packet)
	}
	if strings.Contains(ev.Packet, "/go/fmt.go") {
		t.Errorf("packet kept an external reference:\n%s", ev.Packet)
	}
	if strings.Index(ev.Packet, "lib.go:7") > strings.Index(ev.Packet, "other_test.go:3") {
		t.Errorf("non-test references should come first:\n%s", ev.Packet)
	}
	want := Summary{Source: "gopls", Definition: true, Refs: 3, RefFiles: 3, Callers: 1}
	if ev.Summary != want {
		t.Fatalf("summary = %+v, want %+v", ev.Summary, want)
	}
	if !strings.Contains(ev.Packet, "data") {
		t.Errorf("packet should say workspace content is data:\n%s", ev.Packet)
	}
	for _, want := range []string{"5| \tNewIndex(v)\n", "3| func Caller() {\n", "9| func NewIndex(n int) int {\n", "10| \treturn n\n"} {
		if !strings.Contains(ev.Packet, want) {
			t.Errorf("packet lacks numbered line %q:\n%s", want, ev.Packet)
		}
	}
}

func TestExplainPacketNumbersBlockFromItsFirstLine(t *testing.T) {
	root, abs, lines := explainFixtureRoot(t)
	target := Target{Abs: abs, Rel: "main.go", L1: 4, L2: 5, Col: -1, Text: "\tv := 1\n\tNewIndex(v)"}
	ev := Gather(context.Background(), explainFixtureDeps(t, root, explainFixtureIntel()), target, lines)
	if !strings.Contains(ev.Packet, "4| \tv := 1\n5| \tNewIndex(v)\n") {
		t.Fatalf("packet:\n%s", ev.Packet)
	}
}

// closedFileIntel answers from out-of-date text until the file has been opened,
// which is how a language server behaves when a closed file changes on disk.
type closedFileIntel struct {
	*fakeIntel
	opened bool
}

func (c *closedFileIntel) Symbols(ctx context.Context, abs, rel string) ([]symbols.Symbol, error) {
	c.opened = true
	return c.fakeIntel.Symbols(ctx, abs, rel)
}

func (c *closedFileIntel) Definition(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error) {
	if !c.opened || rel != "main.go" {
		return []codeintel.NavHit{{Path: "main.go", Line: 2, Def: true}}, nil
	}
	return c.fakeIntel.Definition(ctx, abs, rel, line, col)
}

func TestGatherExplainAsksAgainOnceDefinitionFileIsOpen(t *testing.T) {
	root, abs, lines := explainFixtureRoot(t)
	intel := &closedFileIntel{fakeIntel: explainFixtureIntel()}
	deps := explainFixtureDeps(t, root, intel.fakeIntel)
	deps.intel = intel
	ev := Gather(context.Background(), deps, symbolTarget(abs, 5, 1, "NewIndex"), lines)
	if !strings.Contains(ev.Packet, "Definition: main.go:9-11") {
		t.Fatalf("definition should come from the current file:\n%s", ev.Packet)
	}
}

func TestGatherExplainLocalAndExternal(t *testing.T) {
	root, abs, lines := explainFixtureRoot(t)
	intel := explainFixtureIntel()
	ev := Gather(context.Background(), explainFixtureDeps(t, root, intel), symbolTarget(abs, 4, 1, "v"), lines)
	if ev.Kind != KindLocal {
		t.Fatalf("local kind = %q", ev.Kind)
	}

	intel.defs[posKey(5, 1)] = []codeintel.NavHit{{Path: "/go/lib.go", Line: 9, Def: true, Ext: true}}
	ev = Gather(context.Background(), explainFixtureDeps(t, root, intel), symbolTarget(abs, 5, 1, "NewIndex"), lines)
	if ev.Kind != KindExternal || !ev.Summary.Definition {
		t.Fatalf("external evidence = %+v", ev)
	}
}

func TestGatherExplainFallsBackToText(t *testing.T) {
	root, abs, lines := explainFixtureRoot(t)
	deps := explainFixtureDeps(t, root, explainFixtureIntel())
	deps.ready = func(context.Context, string, string) string { return "" }
	deps.search = func(context.Context, string) []codeintel.FileMatches {
		return []codeintel.FileMatches{
			{Path: "main.go", Matches: []codeintel.Match{{Line: 5, Mid: "NewIndex"}, {Line: 9, Mid: "NewIndex", Def: true}}},
			{Path: "lib.go", Matches: []codeintel.Match{{Line: 7, Mid: "NewIndex"}}},
		}
	}
	ev := Gather(context.Background(), deps, symbolTarget(abs, 5, 1, "NewIndex"), lines)
	want := Summary{Source: "text", Refs: 3, RefFiles: 2}
	if ev.Summary != want {
		t.Fatalf("summary = %+v, want %+v", ev.Summary, want)
	}
	if !strings.Contains(ev.Packet, "text search") {
		t.Errorf("packet should label its text-match evidence:\n%s", ev.Packet)
	}
	if !strings.Contains(ev.Packet, "Likely definition") || !strings.Contains(ev.Packet, "return n") {
		t.Errorf("packet should quote the definition text search found:\n%s", ev.Packet)
	}
}

func TestGatherExplainBlockResolvesIdentifiers(t *testing.T) {
	root, abs, lines := explainFixtureRoot(t)
	intel := explainFixtureIntel()
	target := Target{Abs: abs, Rel: "main.go", L1: 4, L2: 5, Col: -1, Text: "\tv := 1\n\tNewIndex(v)"}
	ev := Gather(context.Background(), explainFixtureDeps(t, root, intel), target, lines)
	if ev.Kind != KindBlock || ev.Summary.Identifiers != 1 {
		t.Fatalf("block evidence = %+v", ev)
	}
	if !strings.Contains(ev.Packet, "NewIndex (main.go:9)") || !strings.Contains(ev.Packet, "func Caller") {
		t.Fatalf("packet:\n%s", ev.Packet)
	}
}

func TestExplainPacketLimit(t *testing.T) {
	huge := strings.Repeat("x", 5000)
	p := BuildPacket([]Section{
		{Title: "Target", Body: huge},
		{Title: "Enclosing", Body: huge},
		{Title: "Definition", Body: huge},
		{Title: "Callers", Body: huge},
	})
	if len(p) > PacketMax {
		t.Fatalf("packet is %d bytes, limit %d", len(p), PacketMax)
	}
	if !strings.Contains(p, "### Definition") || strings.Contains(p, "### Callers") || !strings.Contains(p, "Callers") {
		t.Fatalf("lowest section should be dropped and named:\n%s", p[len(p)-200:])
	}
}

func TestExplainKeyAndHash(t *testing.T) {
	root, abs, lines := explainFixtureRoot(t)
	deps := explainFixtureDeps(t, root, explainFixtureIntel())
	base := Gather(context.Background(), deps, symbolTarget(abs, 5, 1, "NewIndex"), lines)

	// Reached from its own definition, a workspace symbol is the same explanation.
	intel := explainFixtureIntel()
	intel.hover[posKey(9, 5)] = intel.hover[posKey(5, 1)]
	other := Gather(context.Background(), explainFixtureDeps(t, root, intel), symbolTarget(abs, 9, 5, "NewIndex"), lines)
	if other.Key != base.Key {
		t.Fatal("a workspace symbol should have one key across call sites")
	}

	// Lines above shift; the key must not move.
	shifted := "// new\n" + explainFixture
	if err := os.WriteFile(abs, []byte(shifted), 0o644); err != nil {
		t.Fatal(err)
	}
	intel = explainFixtureIntel()
	intel.defs = map[string][]codeintel.NavHit{posKey(6, 1): {{Path: "main.go", Line: 10, Def: true}}}
	intel.syms["main.go"] = []symbols.Symbol{{Name: "Caller", Kind: "func", Line: 4, End: 7}, {Name: "NewIndex", Kind: "func", Line: 10, End: 12}}
	moved := Gather(context.Background(), explainFixtureDeps(t, root, intel), symbolTarget(abs, 6, 1, "NewIndex"), strings.Split(shifted, "\n"))
	if moved.Key != base.Key {
		t.Fatal("moving code should keep the key")
	}

	// The body changes; the key must move.
	changed := strings.Replace(explainFixture, "return n", "return n + 1", 1)
	if err := os.WriteFile(abs, []byte(changed), 0o644); err != nil {
		t.Fatal(err)
	}
	edited := Gather(context.Background(), deps, symbolTarget(abs, 5, 1, "NewIndex"), strings.Split(changed, "\n"))
	if edited.Key == base.Key {
		t.Fatal("changing the body should change the key")
	}

	// A new caller leaves the key alone and only moves the hash.
	if err := os.WriteFile(abs, []byte(explainFixture), 0o644); err != nil {
		t.Fatal(err)
	}
	intel = explainFixtureIntel()
	intel.callers = append(intel.callers, codeintel.CallNode{Name: "Another", Path: "lib.go", Line: 1})
	more := Gather(context.Background(), explainFixtureDeps(t, root, intel), symbolTarget(abs, 5, 1, "NewIndex"), lines)
	if more.Key != base.Key || more.Hash == base.Hash {
		t.Fatalf("key moved %v, hash moved %v", more.Key != base.Key, more.Hash != base.Hash)
	}
	if got := StaleReason(base.Hash, more.Hash); got != "callers" {
		t.Fatalf("stale reason = %q", got)
	}
	if got := StaleReason(base.Hash, "|"+strings.Split(base.Hash, "|")[1]); got != "" {
		t.Fatalf("a part that was not gathered must not read as stale, got %q", got)
	}
}

func TestValidateExplainRefs(t *testing.T) {
	root := t.TempDir()
	body := "line one\nfunc NewIndex() {}\nline three\n\n\nfunc Moved() {}\n"
	if err := os.WriteFile(filepath.Join(root, "a.go"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "secret.go")
	os.WriteFile(outside, []byte("x\n"), 0o644)
	if err := os.Symlink(outside, filepath.Join(root, "link.go")); err != nil {
		t.Fatal(err)
	}
	reply := strings.Join([]string{
		"[`NewIndex`](a.go:2) and [Moved()](a.go:2)",
		"[Gone](a.go:3) [the opening lines](a.go:1-3) [far](a.go:99) [bad](a.go:3-99)",
		"[escape](../secret.go:1) [abs](/etc/hosts:1) [missing](b.go:1) [link](link.go:1)",
		"`a.go:6` and `a.go` and at a.go:3, plus `b.go:4`",
	}, "\n")
	got := ValidateRefs(root, reply)
	want := map[string]Ref{
		"a.go:2":   {Line: 2},
		"a.go:1-3": {Line: 1, End: 3},
		"a.go:6":   {Line: 6},
		"a.go":     {},
		"a.go:3":   {Line: 3},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("refs = %+v\nwant %+v", got, want)
	}

	snapped := ValidateRefs(root, "[Moved](a.go:4)")
	if !reflect.DeepEqual(snapped, map[string]Ref{"a.go:4": {Line: 6}}) {
		t.Fatalf("snapped = %+v", snapped)
	}
	if none := ValidateRefs(root, "[Absent](a.go:4)"); len(none) != 0 {
		t.Fatalf("an absent label should not link: %+v", none)
	}
}

func TestExplainInstructionsLeaveLengthToTheReader(t *testing.T) {
	plain := Instructions(KindBlock, "  ")
	for _, limit := range []string{"120 words", "one paragraph", "concisely", "The reader says"} {
		if strings.Contains(plain, limit) {
			t.Errorf("instructions without a reader contain %q:\n%s", limit, plain)
		}
	}
	got := Instructions(KindBlock, "new to Go")
	if !strings.Contains(got, `The reader says about themselves: "new to Go". Shape the explanation for them.`) {
		t.Fatalf("instructions = %s", got)
	}
}

func TestValidateRefsRejectsUnreadableSource(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "directory.go"), 0o755); err != nil {
		t.Fatal(err)
	}
	got := ValidateRefs(root, "`directory.go` and `directory.go:1`")
	if len(got) != 0 {
		t.Fatalf("unreadable source should not link: %+v", got)
	}
}
