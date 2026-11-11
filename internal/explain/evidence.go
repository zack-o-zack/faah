package explain

import (
	"context"
	"fmt"
	"strings"

	"faah/internal/codeintel"
	"faah/internal/symbols"
)

// Workspace is what gathering evidence needs from faah: code intelligence,
// search, and file access.
type Workspace interface {
	Definition(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error)
	References(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error)
	Hover(ctx context.Context, abs, rel string, line, col int) (*codeintel.HoverInfo, error)
	Symbols(ctx context.Context, abs, rel string) ([]symbols.Symbol, error)
	PrepareCalls(ctx context.Context, abs, rel string, line, u16col int) ([]codeintel.CallNode, error)
	Calls(ctx context.Context, rel, item string, outgoing bool) ([]codeintel.CallNode, error)
	Ready(ctx context.Context, abs, rel string) string // server name, "" when none is ready
	Outline(abs, rel string) ([]symbols.Symbol, error)
	Search(ctx context.Context, name string) []codeintel.FileMatches
	Abs(rel string) (string, bool)
}

// Evidence is everything a target needs before the harness runs. Hash
// is "callers|references", either side empty when it could not be gathered.
type Evidence struct {
	Kind    string
	Source  string
	Packet  string
	Key     string
	Hash    string
	Summary Summary
}

type Section struct {
	Title string
	Body  string
}

type explainSpan struct {
	Name   string
	L1, L2 int
	Text   string
}

// explainGather holds one run's state, including files it has already read.
type explainGather struct {
	ws     Workspace
	target Target
	files  map[string][]string
	syms   map[string][]symbols.Symbol
	server string
}

func Gather(ctx context.Context, ws Workspace, t Target, lines []string) Evidence {
	g := &explainGather{
		ws: ws, target: t,
		files: map[string][]string{t.Rel: lines},
		syms:  map[string][]symbols.Symbol{},
	}
	g.server = ws.Ready(ctx, t.Abs, t.Rel)
	enc, hasEnc := g.enclosing()

	var sections []Section
	sections = append(sections, Section{"Target", targetSection(t, lines)})
	// A selection that is the whole function has no surrounding code to add.
	if hasEnc && !(t.Name == "" && t.L1 <= enc.L1 && t.L2 >= enc.L2) {
		sections = append(sections, Section{fmt.Sprintf("Enclosing code: %s, %s:%s", enc.Name, t.Rel, codeintel.LineRef(enc.L1, enc.L2)), numberedBlock(t.Rel, enc.Text, enc.L1, explainBodyMax)})
	}

	var ev Evidence
	var more []Section
	if t.Name == "" {
		ev, more = g.block(ctx, enc)
	} else {
		ev, more = g.symbol(ctx, enc, hasEnc)
	}
	ev.Packet = BuildPacket(append(sections, more...))
	return ev
}

func targetSection(t Target, lines []string) string {
	where := fmt.Sprintf("%s:%s", t.Rel, codeintel.LineRef(t.L1, t.L2))
	code := t.Text
	if t.Name != "" {
		where = fmt.Sprintf("Symbol `%s` at %s", t.Name, where)
		code = joinLines(lines, t.L1, t.L1) // the bare name says nothing the heading does not
	}
	return where + "\n" + numberedBlock(t.Rel, code, t.L1, explainTargetMax)
}

func (g *explainGather) symbols(rel string) []symbols.Symbol {
	if s, ok := g.syms[rel]; ok {
		return s
	}
	abs, ok := g.ws.Abs(rel)
	if !ok {
		return nil
	}
	var out []symbols.Symbol
	if g.server != "" {
		// A deadline here is no reason to stop: the outline below needs none.
		ctx, cancel := context.WithTimeout(context.Background(), Budget)
		out, _ = g.ws.Symbols(ctx, abs, rel)
		cancel()
	}
	if len(out) == 0 {
		out, _ = g.ws.Outline(abs, rel)
	}
	g.syms[rel] = out
	return out
}

func (g *explainGather) lines(rel string) []string {
	if l, ok := g.files[rel]; ok {
		return l
	}
	abs, ok := g.ws.Abs(rel)
	if !ok {
		return nil
	}
	lines, err := ReadLines(abs)
	if err != nil {
		return nil
	}
	g.files[rel] = lines
	return lines
}

func (g *explainGather) enclosing() (explainSpan, bool) {
	t := g.target
	syms := g.symbols(t.Rel)
	lines := g.lines(t.Rel)
	s, end, ok := enclosingSymbol(syms, t.L1, t.L2, len(lines))
	if !ok {
		return explainSpan{}, false
	}
	return explainSpan{Name: s.Name, L1: s.Line, L2: end, Text: joinLines(lines, s.Line, end)}, true
}

func joinLines(lines []string, l1, l2 int) string {
	if l1 < 1 || l1 > len(lines) {
		return ""
	}
	return strings.Join(lines[l1-1:min(l2, len(lines))], "\n")
}

// Symbol kinds that do not wrap code worth quoting as "the enclosing code".
var explainNotContainer = func() map[string]bool {
	m := map[string]bool{}
	for _, k := range strings.Fields("file module namespace package var const field property key string number bool array object null event operator heading import mod") {
		m[k] = true
	}
	return m
}()

// symbolEnd finds where syms[i] stops. Language servers report it; the regex
// outline does not, so its next sibling or the line cap ends it instead.
func symbolEnd(syms []symbols.Symbol, i, total int) int {
	if syms[i].End >= syms[i].Line {
		return syms[i].End
	}
	end := min(syms[i].Line+explainFallbackLines-1, total)
	for _, s := range syms[i+1:] {
		if s.Indent <= syms[i].Indent {
			return min(end, s.Line-1)
		}
	}
	return end
}

// enclosingSymbol returns the innermost container wrapping lines l1..l2.
func enclosingSymbol(syms []symbols.Symbol, l1, l2, total int) (symbols.Symbol, int, bool) {
	best, bestEnd := -1, 0
	for i, s := range syms {
		if explainNotContainer[s.Kind] || s.Line > l1 {
			continue
		}
		if end := symbolEnd(syms, i, total); end >= l2 && (best < 0 || s.Line >= syms[best].Line) {
			best, bestEnd = i, end
		}
	}
	if best < 0 {
		return symbols.Symbol{}, 0, false
	}
	return syms[best], bestEnd, true
}

// definitionBody reads the declaration starting at a definition's line.
func (g *explainGather) definitionBody(hit codeintel.NavHit) (string, int) {
	lines := g.lines(hit.Path)
	if lines == nil {
		return "", hit.Line
	}
	syms := g.symbols(hit.Path)
	for i, s := range syms {
		if s.Line == hit.Line {
			end := symbolEnd(syms, i, len(lines))
			return joinLines(lines, s.Line, end), end
		}
	}
	if s, end, ok := enclosingSymbol(syms, hit.Line, hit.Line, len(lines)); ok && s.Line == hit.Line {
		return joinLines(lines, s.Line, end), end
	}
	return joinLines(lines, hit.Line, hit.Line), hit.Line
}

func (g *explainGather) targetLine() string {
	return joinLines(g.files[g.target.Rel], g.target.L1, g.target.L1)
}

func (g *explainGather) block(ctx context.Context, enc explainSpan) (Evidence, []Section) {
	t := g.target
	source := g.server
	if source == "" {
		source = "text"
	}
	ev := Evidence{Kind: KindBlock, Source: source, Summary: Summary{Source: source}}
	ev.Key = Key(ev.Kind, ev.Source, t.Rel, t.Text, enc.Text)
	ev.Hash = "|"
	if g.server == "" {
		return ev, nil
	}

	lines := g.files[t.Rel]
	seen := map[string]bool{}
	var entries, parts []string
	tries := 0
scan:
	for n := t.L1; n <= t.L2 && n <= len(lines); n++ {
		line := lines[n-1]
		for _, loc := range explainIdentRe.FindAllStringIndex(line, -1) {
			name := line[loc[0]:loc[1]]
			if len(name) < 2 || explainKeywords[name] || seen[name] {
				continue
			}
			if tries >= explainMaxIdentTries || len(entries) >= explainMaxIdents || ctx.Err() != nil {
				break scan
			}
			seen[name] = true
			tries++
			col := UTF16Len(line[:loc[0]])
			hits, _ := g.ws.Definition(ctx, t.Abs, t.Rel, n, col)
			if len(hits) == 0 || (hits[0].Path == t.Rel && hits[0].Line >= t.L1 && hits[0].Line <= t.L2) {
				continue // declared by the selection itself, which is already quoted
			}
			info, _ := g.ws.Hover(ctx, t.Abs, t.Rel, n, col)
			if info == nil || info.Empty {
				continue
			}
			sig := strings.Join(strings.Fields(stripHoverHTML(info.Signature)), " ")
			where := fmt.Sprintf("%s:%d", hits[0].Path, hits[0].Line)
			if hits[0].Ext {
				where = "outside the workspace"
			}
			entries = append(entries, fmt.Sprintf("- %s (%s): %s", name, where, sig))
			parts = append(parts, name+" "+sig)
		}
	}
	ev.Summary.Identifiers = len(entries)
	ev.Hash = "|" + explainHashList(parts)
	if len(entries) == 0 {
		return ev, nil
	}
	return ev, []Section{{"Identifiers used by the selection", strings.Join(entries, "\n")}}
}
