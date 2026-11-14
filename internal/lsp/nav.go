package lsp

import (
	"bytes"
	"context"
	"encoding/json"
	"sort"

	"faah/internal/codeintel"
	"faah/internal/render"
	"faah/internal/symbols"
	"faah/internal/textutil"
)

// ---------------------------------------------------------------- navigation

// resolve turns a set of LSP ranges into display-ready hits, reading each target
// file through the same cache the editor uses.
func (m *Manager) resolve(c *client, locs []location, markDef bool) []codeintel.NavHit {
	type fileKey struct {
		abs, rel string
		ext      bool
	}
	byFile := map[fileKey][]rangePosition{}
	var order []fileKey

	for _, l := range locs {
		abs, err := uriToPath(l.URI)
		if err != nil {
			continue
		}
		// Outside the indexed tree is still worth jumping to, so treePath
		// allows this exact file to be opened even though the tree guard
		// would refuse it.
		rel, ext := m.treePath(abs, true)
		k := fileKey{abs, rel, ext}
		if _, seen := byFile[k]; !seen {
			order = append(order, k)
		}
		byFile[k] = append(byFile[k], l.Range)
	}

	var out []codeintel.NavHit
	for _, k := range order {
		d, err := render.Open(k.abs, k.rel)
		ranges := byFile[k]
		sort.Slice(ranges, func(i, j int) bool {
			if ranges[i].Start.Line != ranges[j].Start.Line {
				return ranges[i].Start.Line < ranges[j].Start.Line
			}
			return ranges[i].Start.Character < ranges[j].Start.Character
		})
		seen := map[int]bool{}
		for _, r := range ranges {
			line := r.Start.Line + 1
			if seen[line] {
				continue // one entry per line keeps the list readable
			}
			seen[line] = true

			text := ""
			from := 0
			if err == nil && d != nil && r.Start.Line >= 0 && r.Start.Line < d.Total {
				text = d.Raw(line)
				_, from = c.fromLSPLine(text, r.Start)
			}
			to := from
			if r.End.Line == r.Start.Line && err == nil && d != nil && r.End.Line >= 0 && r.End.Line < d.Total {
				_, to = c.fromLSPLine(text, r.End)
			}
			if to <= from || to > len(text) {
				to = len(text)
				if from > to {
					from = to
				}
			}
			h := textutil.Snip([]byte(text), from, to)
			out = append(out, codeintel.NavHit{
				Path: k.rel, Line: line, Pre: h.Pre, Mid: h.Mid, Post: h.Post,
				Def: markDef, Ext: k.ext,
			})
		}
	}
	return out
}

type locationOrLink struct {
	URI                  string         `json:"uri"`
	Range                rangePosition  `json:"range"`
	TargetURI            string         `json:"targetUri"`
	TargetRange          *rangePosition `json:"targetRange"`
	TargetSelectionRange *rangePosition `json:"targetSelectionRange"`
}

func (l locationOrLink) toLocation() (location, bool) {
	if l.URI != "" {
		return location{URI: l.URI, Range: l.Range}, true
	}
	if l.TargetURI != "" {
		if l.TargetSelectionRange != nil {
			return location{URI: l.TargetURI, Range: *l.TargetSelectionRange}, true
		}
		if l.TargetRange != nil {
			return location{URI: l.TargetURI, Range: *l.TargetRange}, true
		}
		return location{URI: l.TargetURI}, true
	}
	return location{}, false
}

// locate runs one position-based request and normalises the two shapes a server
// may answer with (Location or LocationLink).
func (m *Manager) locate(ctx context.Context, method, abs, rel string, line, u16col int, extra map[string]any) ([]codeintel.NavHit, error) {
	c, err := m.client(ctx, rel)
	if err != nil {
		return nil, err
	}
	if err := c.ensureOpen(abs, rel); err != nil {
		return nil, err
	}

	d, err := render.Open(abs, rel)
	if err != nil {
		return nil, err
	}
	rawLine := d.Raw(line)
	byteCol := codeintel.UTF16ToByte(rawLine, u16col)

	params := map[string]any{
		"textDocument": map[string]any{"uri": pathToURI(abs)},
		"position":     c.toLSP(rawLine, line, byteCol),
	}
	for k, v := range extra {
		params[k] = v
	}

	var rawMsg json.RawMessage
	if err := c.call(ctx, method, params, &rawMsg); err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(rawMsg)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []codeintel.NavHit{}, nil
	}
	if trimmed[0] == '{' {
		var one locationOrLink
		if err := json.Unmarshal(trimmed, &one); err != nil {
			return nil, err
		}
		if loc, ok := one.toLocation(); ok {
			return m.resolve(c, []location{loc}, method != "textDocument/references"), nil
		}
		return []codeintel.NavHit{}, nil
	}

	var items []locationOrLink
	if err := json.Unmarshal(trimmed, &items); err != nil {
		return nil, err
	}
	locs := make([]location, 0, len(items))
	for _, item := range items {
		if loc, ok := item.toLocation(); ok {
			locs = append(locs, loc)
		}
	}
	return m.resolve(c, locs, method != "textDocument/references"), nil
}

// Definition queries the language server for the definition site(s) of the symbol at the given position.
// Line is 1-based and col is the UTF-16 code unit offset from the frontend.
func (m *Manager) Definition(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error) {
	return m.locate(ctx, "textDocument/definition", abs, rel, line, col, nil)
}

// References queries the language server for all reference locations of the symbol at the given position,
// including its declaration site.
func (m *Manager) References(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error) {
	return m.locate(ctx, "textDocument/references", abs, rel, line, col,
		map[string]any{"context": map[string]any{"includeDeclaration": true}})
}

// Symbols returns the document outline, flattened with indentation that mirrors
// the server's nesting.
func (m *Manager) Symbols(ctx context.Context, abs, rel string) ([]symbols.Symbol, error) {
	c, err := m.client(ctx, rel)
	if err != nil {
		return nil, err
	}
	if err := c.ensureOpen(abs, rel); err != nil {
		return nil, err
	}

	var raw []documentSymbol
	if err := c.call(ctx, "textDocument/documentSymbol", map[string]any{
		"textDocument": map[string]any{"uri": pathToURI(abs)},
	}, &raw); err != nil {
		return nil, err
	}

	var out []symbols.Symbol
	var walk func(syms []documentSymbol, depth int)
	walk = func(syms []documentSymbol, depth int) {
		for _, s := range syms {
			rng, end := s.SelectionRange, s.Range.End.Line+1
			if s.Location != nil {
				rng, end = s.Location.Range, s.Location.Range.End.Line+1 // symbolInformation form
			}
			kind := symbolKind[s.Kind]
			if kind == "" {
				kind = "sym"
			}
			out = append(out, symbols.Symbol{
				Name: s.Name, Kind: kind, Line: rng.Start.Line + 1, End: end, Indent: depth * 2,
			})
			if len(s.Children) > 0 {
				walk(s.Children, depth+1)
			}
		}
	}
	walk(raw, 0)

	// symbolInformation comes back unordered often enough to be worth fixing.
	sort.SliceStable(out, func(i, j int) bool { return out[i].Line < out[j].Line })
	return out, nil
}
