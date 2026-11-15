package lsp

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"

	"faah/internal/codeintel"
	"faah/internal/render"
)

// ---------------------------------------------------------------- hover

// Hover asks the server what a position is, and renders the answer.
func (m *Manager) Hover(ctx context.Context, abs, rel string, line, col int) (*codeintel.HoverInfo, error) {
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
	byteCol := codeintel.UTF16ToByte(d.Raw(line), col)

	var res struct {
		Contents json.RawMessage `json:"contents"`
	}
	err = c.call(ctx, "textDocument/hover", map[string]any{
		"textDocument": map[string]any{"uri": pathToURI(abs)},
		"position":     c.toLSP(d.Raw(line), line, byteCol),
	}, &res)
	if err != nil {
		return nil, err
	}
	if len(res.Contents) == 0 {
		return &codeintel.HoverInfo{Empty: true}, nil
	}

	code, prose := parseHoverContents(res.Contents)
	if code == "" && prose == "" {
		return &codeintel.HoverInfo{Empty: true}, nil
	}
	return &codeintel.HoverInfo{Signature: highlightSnippet(code, rel), Doc: prose}, nil
}

// parseHoverContents flattens the three shapes the spec allows: a MarkupContent
// object, a MarkedString, or an array of MarkedStrings.
func parseHoverContents(raw json.RawMessage) (code, prose string) {
	var markup struct {
		Kind  string `json:"kind"`
		Value string `json:"value"`
	}
	if err := json.Unmarshal(raw, &markup); err == nil && markup.Value != "" {
		return splitMarkdown(markup.Value)
	}

	var one string
	if err := json.Unmarshal(raw, &one); err == nil {
		return splitMarkdown(one)
	}

	var many []json.RawMessage
	if err := json.Unmarshal(raw, &many); err == nil {
		var codes, proses []string
		for _, item := range many {
			var s string
			if json.Unmarshal(item, &s) == nil {
				c, p := splitMarkdown(s)
				if c != "" {
					codes = append(codes, c)
				}
				if p != "" {
					proses = append(proses, p)
				}
				continue
			}
			var ms struct {
				Language string `json:"language"`
				Value    string `json:"value"`
			}
			if json.Unmarshal(item, &ms) == nil && ms.Value != "" {
				if ms.Language != "" {
					codes = append(codes, ms.Value)
				} else {
					proses = append(proses, ms.Value)
				}
			}
		}
		return strings.Join(codes, "\n"), strings.Join(proses, "\n\n")
	}
	return "", ""
}

// splitMarkdown pulls fenced code blocks out of a hover body; what is left is
// documentation prose.
func splitMarkdown(s string) (code, prose string) {
	var codes, text []string
	inFence := false
	var fence []string
	for _, line := range strings.Split(s, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			if inFence {
				codes = append(codes, strings.Join(fence, "\n"))
				fence = nil
			}
			inFence = !inFence
			continue
		}
		if inFence {
			fence = append(fence, line)
		} else {
			text = append(text, line)
		}
	}
	if len(fence) > 0 {
		codes = append(codes, strings.Join(fence, "\n"))
	}
	code = strings.TrimSpace(strings.Join(codes, "\n"))
	prose = strings.TrimSpace(stripMarkdown(strings.Join(text, "\n")))

	// A server that only speaks plaintext sends no fences at all. Its first
	// line is still the declaration, so promote it rather than showing nothing.
	if code == "" && prose != "" {
		first, rest, _ := strings.Cut(prose, "\n")
		if looksLikeDeclaration(first) {
			code, prose = first, strings.TrimSpace(rest)
		}
	}
	const maxProse = 900
	if len(prose) > maxProse {
		if cut := strings.LastIndex(prose[:maxProse], " "); cut > 0 {
			prose = prose[:cut]
		} else {
			prose = prose[:maxProse]
		}
		prose += "…"
	}
	return code, prose
}

// looksLikeDeclaration is a deliberately conservative test: short, no trailing
// sentence punctuation, and carrying syntax a prose line would not.
func looksLikeDeclaration(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 200 || strings.HasSuffix(s, ".") {
		return false
	}
	return strings.ContainsAny(s, "(){}[]<>:=*&") || strings.Contains(s, " ")
}

var (
	mdInline = strings.NewReplacer("**", "", "__", "", "`", "")
	mdLink   = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	// No backreference: Go's regexp is RE2, so the three rule forms are spelled out.
	mdRule     = regexp.MustCompile(`^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$`)
	mdOnlyLink = regexp.MustCompile(`^\s*\[[^\]]*\]\([^)]*\)\s*$`)
)

// stripMarkdown flattens a hover body into something readable in a tooltip.
// Nothing here tries to be a markdown renderer; it removes the decorations that
// would otherwise show up as literal punctuation.
func stripMarkdown(s string) string {
	var out []string
	blank := 0
	for _, line := range strings.Split(s, "\n") {
		if mdRule.MatchString(line) || mdOnlyLink.MatchString(line) {
			continue // horizontal rules and bare "see also" links are noise
		}
		line = strings.TrimRight(mdInline.Replace(mdLink.ReplaceAllString(line, "$1")), " ")
		if strings.TrimSpace(line) == "" {
			blank++
			if blank > 1 {
				continue
			}
		} else {
			blank = 0
		}
		out = append(out, line)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

const maxSignatureLines = 12

// highlightSnippet runs a hover signature through the same lexer the file uses,
// so the card matches the editor.
func highlightSnippet(code, rel string) string {
	if code == "" {
		return ""
	}
	lines := strings.Split(code, "\n")
	if len(lines) > maxSignatureLines {
		lines = append(lines[:maxSignatureLines], "…")
		code = strings.Join(lines, "\n")
	}
	d := render.NewDoc(code, rel)
	out, _ := d.Lines(0, d.Total)
	return strings.Join(out, "\n")
}
