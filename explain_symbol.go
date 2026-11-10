package main

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

func nameMatches(container, name string) bool {
	return container == name || strings.HasSuffix(container, "."+name)
}

func (g *explainGather) symbol(ctx context.Context, enc explainSpan, hasEnc bool) (explainEvidence, []explainSection) {
	t := g.target
	var hits []NavHit
	if g.server != "" {
		hits, _ = g.deps.intel.Definition(ctx, t.Abs, t.Rel, t.L1, t.Col)
	}
	if len(hits) == 0 {
		return g.textSymbol(ctx, enc)
	}
	if !hits[0].Ext {
		// A server only learns a file's current text once it is open, so an
		// answer about a file that was closed until now can name an old line.
		g.symbols(hits[0].Path)
		if again, _ := g.deps.intel.Definition(ctx, t.Abs, t.Rel, t.L1, t.Col); len(again) > 0 {
			hits = again
		}
	}
	def := hits[0]
	ev := explainEvidence{Source: g.server, Summary: explainSummary{Source: g.server, Definition: true}}
	var sections []explainSection

	signature := ""
	if info, _ := g.deps.intel.Hover(ctx, t.Abs, t.Rel, t.L1, t.Col); info != nil && !info.Empty {
		signature = stripHoverHTML(info.Signature)
		body := signature
		if info.Doc != "" {
			body = strings.TrimSpace(body + "\n\n" + info.Doc)
		}
		if body != "" {
			sections = append(sections, explainSection{"Signature and documentation", capText(body, explainDocMax)})
		}
	}

	body := enc.Text
	switch {
	case def.Ext:
		ev.Kind = explainExternal
		ev.Key = explainKey(ev.Kind, ev.Source, t.Rel, signature, enc.Text)
	case hasEnc && def.Path == t.Rel && def.Line >= enc.L1 && def.Line <= enc.L2 && !nameMatches(enc.Name, t.Name):
		ev.Kind = explainLocal
		ev.Key = explainKey(ev.Kind, ev.Source, t.Rel, t.Name, enc.Text)
	default:
		ev.Kind = explainWorkspace
		var end int
		body, end = g.definitionBody(def)
		ev.Key = explainKey(ev.Kind, ev.Source, def.Path, t.Name, body)
		sections = append(sections, explainSection{fmt.Sprintf("Definition: %s:%s", def.Path, lineRef(def.Line, end)), numberedBlock(def.Path, body, def.Line, explainBodyMax)})
	}

	callers := ""
	if ev.Kind == explainWorkspace {
		var calls []explainSection
		calls, callers, ev.Summary.Callers = g.calls(ctx)
		sections = append(sections, calls...)
	}

	refsHash := ""
	if refs, err := g.deps.intel.References(ctx, t.Abs, t.Rel, t.L1, t.Col); err == nil && ctx.Err() == nil {
		kept := refs[:0:0]
		for _, h := range refs {
			if !h.Ext && !(h.Path == def.Path && h.Line == def.Line) {
				kept = append(kept, h)
			}
		}
		var section string
		section, ev.Summary.Refs, ev.Summary.RefFiles, refsHash = refSection(kept)
		if section != "" {
			sections = append(sections, explainSection{"References", section})
		}
	}
	ev.Hash = callers + "|" + refsHash
	return ev, sections
}

// calls reports one level of callers and callees and a hash of the callers.
func (g *explainGather) calls(ctx context.Context) ([]explainSection, string, int) {
	t := g.target
	nodes, err := g.deps.intel.PrepareCalls(ctx, t.Abs, t.Rel, t.L1, t.Col)
	if err != nil || len(nodes) == 0 {
		return nil, "", 0
	}
	var sections []explainSection
	hash, count := "", 0
	if callers, err := g.deps.intel.Calls(ctx, t.Rel, nodes[0].Item, false); err == nil && ctx.Err() == nil {
		names := make([]string, 0, len(callers))
		for _, c := range callers {
			names = append(names, c.Name)
		}
		hash, count = explainHashList(names), len(callers)
		if len(callers) > 0 {
			sections = append(sections, explainSection{"Callers", callList(callers)})
		}
	}
	if callees, err := g.deps.intel.Calls(ctx, t.Rel, nodes[0].Item, true); err == nil && len(callees) > 0 {
		sections = append(sections, explainSection{"Callees", callList(callees)})
	}
	return sections, hash, count
}

func callList(nodes []CallNode) string {
	var b strings.Builder
	shown := nodes
	if len(shown) > explainMaxCalls {
		shown = shown[:explainMaxCalls]
	}
	for _, n := range shown {
		if n.Ext {
			fmt.Fprintf(&b, "- %s (outside the workspace)\n", n.Name)
		} else {
			fmt.Fprintf(&b, "- %s (%s:%d)\n", n.Name, n.Path, n.Line)
		}
	}
	if extra := len(nodes) - len(shown); extra > 0 {
		fmt.Fprintf(&b, "%d more omitted\n", extra)
	}
	return strings.TrimRight(b.String(), "\n")
}

func isTestPath(p string) bool {
	base := filepath.Base(p)
	return strings.Contains(base, "_test.") || strings.Contains(base, ".test.") || strings.Contains(base, ".spec.") ||
		strings.HasPrefix(base, "test_") || strings.Contains("/"+p, "/test/") || strings.Contains("/"+p, "/tests/")
}

// refSection samples references, non-test files first, and hashes where they
// are by file and count, so a moved reference does not read as a changed one.
func refSection(hits []NavHit) (string, int, int, string) {
	byFile := map[string][]NavHit{}
	var files []string
	for _, h := range hits {
		if _, ok := byFile[h.Path]; !ok {
			files = append(files, h.Path)
		}
		byFile[h.Path] = append(byFile[h.Path], h)
	}
	sort.Slice(files, func(i, j int) bool {
		if ti, tj := isTestPath(files[i]), isTestPath(files[j]); ti != tj {
			return tj
		}
		return files[i] < files[j]
	})
	parts := make([]string, 0, len(files))
	var b strings.Builder
	shown := 0
	for _, f := range files {
		parts = append(parts, f+":"+strconv.Itoa(len(byFile[f])))
		for i, h := range byFile[f] {
			if i >= explainMaxRefsFile || shown >= explainMaxRefs {
				break
			}
			fmt.Fprintf(&b, "%s:%d: %s\n", h.Path, h.Line, strings.TrimSpace(h.Pre+h.Mid+h.Post))
			shown++
		}
	}
	if extra := len(hits) - shown; extra > 0 {
		fmt.Fprintf(&b, "%d more references omitted\n", extra)
	}
	return strings.TrimRight(b.String(), "\n"), len(hits), len(files), explainHashList(parts)
}

// textSymbol stands in when no language server can say what the name is.
func (g *explainGather) textSymbol(ctx context.Context, enc explainSpan) (explainEvidence, []explainSection) {
	t := g.target
	ev := explainEvidence{Kind: explainWorkspace, Source: "text", Summary: explainSummary{Source: "text"}}
	var hits []NavHit
	if g.deps.search != nil {
		for _, f := range g.deps.search(ctx, t.Name) {
			for _, m := range f.Matches {
				hits = append(hits, NavHit{Path: f.Path, Line: m.Line, Pre: m.Pre, Mid: m.Mid, Post: m.Post, Def: m.Def})
			}
		}
	}
	section, refs, files, hash := refSection(hits)
	ev.Summary.Refs, ev.Summary.RefFiles = refs, files
	ev.Hash = "|" + hash
	var sections []explainSection
	body := ""
	for _, h := range hits {
		if h.Def {
			var end int
			body, end = g.definitionBody(h)
			sections = append(sections, explainSection{fmt.Sprintf("Likely definition, by text match: %s:%s", h.Path, lineRef(h.Line, end)), numberedBlock(h.Path, body, h.Line, explainBodyMax)})
			break
		}
	}
	ev.Key = explainKey(ev.Kind, ev.Source, t.Rel, t.Name, enc.Text, g.targetLine(), body)
	if section != "" {
		sections = append(sections, explainSection{"Occurrences found by whole-word text search, not resolved by a language server", section})
	}
	return ev, sections
}
