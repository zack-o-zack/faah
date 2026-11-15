package lsp

import (
	"fmt"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf8"

	"faah/internal/codeintel"
)

// ---------------------------------------------------------------- positions

// toLSP converts a 1-based line and 0-based byte column into the offsets the
// server expects. The spec counts UTF-16 code units by default, which is not
// what Go gives us.
func (c *client) toLSP(lineText string, line, byteCol int) position {
	if byteCol < 0 {
		byteCol = 0
	}
	if byteCol > len(lineText) {
		byteCol = len(lineText)
	}
	prefix := lineText[:byteCol]
	var ch int
	switch c.encoding {
	case "utf-8":
		ch = byteCol
	case "utf-32":
		ch = utf8.RuneCountInString(prefix)
	default:
		// Count UTF-16 code units without allocating: one unit per rune,
		// plus one more for astral runes (surrogate pairs). Ranging over the
		// string yields the same runes []rune(prefix) would — including
		// U+FFFD per invalid byte — so this matches utf16.Encode exactly.
		for _, r := range prefix {
			if r >= 0x10000 {
				ch += 2
			} else {
				ch++
			}
		}
	}
	return position{Line: line - 1, Character: ch}
}

// fromLSP converts a server position back into a 1-based line and 0-based byte
// column against the file we have on disk.
func (c *client) fromLSP(lines []string, p position) (int, int) {
	line := p.Line + 1
	if p.Line < 0 || p.Line >= len(lines) {
		return line, 0
	}
	return c.fromLSPLine(lines[p.Line], p)
}

func (c *client) fromLSPLine(text string, p position) (int, int) {
	line := p.Line + 1
	if p.Character <= 0 {
		return line, 0
	}
	switch c.encoding {
	case "utf-8":
		if p.Character > len(text) {
			return line, len(text)
		}
		return line, p.Character
	case "utf-32":
		// Sum rune widths directly instead of materializing []rune and
		// re-encoding the prefix to a throwaway string.
		n, bytes := 0, 0
		for _, r := range text {
			if n >= p.Character {
				break
			}
			n++
			bytes += utf8.RuneLen(r)
		}
		return line, bytes
	default:
		return line, codeintel.UTF16ToByte(text, p.Character)
	}
}

// ---------------------------------------------------------------- uris

func pathToURI(p string) string {
	p = filepath.ToSlash(p)
	if runtime.GOOS == "windows" {
		if !strings.HasPrefix(p, "/") {
			p = "/" + p
		}
	}
	u := url.URL{Scheme: "file", Path: p}
	return u.String()
}

func uriToPath(uri string) (string, error) {
	u, err := url.Parse(uri)
	if err != nil {
		return "", err
	}
	if u.Scheme != "file" && u.Scheme != "" {
		return "", fmt.Errorf("not a file uri: %s", uri)
	}
	p := u.Path
	if runtime.GOOS == "windows" {
		p = strings.TrimPrefix(p, "/")
	}
	return filepath.FromSlash(p), nil
}
