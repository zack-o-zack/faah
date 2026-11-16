package explain

import (
	"errors"
	"os"
	"strings"
	"unicode/utf16"

	"faah/internal/codeintel"
)

func UTF16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// Classify checks a selection against the file and decides whether it
// names one symbol or is a block of code.
func Classify(lines []string, req Request) (Target, error) {
	var t Target
	if req.File {
		end := len(lines)
		if end > 0 && lines[end-1] == "" {
			end--
		}
		if strings.TrimSpace(strings.Join(lines[:end], "\n")) == "" {
			return t, ErrBlank
		}
		return Target{File: true, L1: 1, L2: end, Col: -1}, nil
	}
	if req.L1 < 1 || req.L2 < req.L1 {
		return t, ErrBlank
	}
	if req.L2-req.L1+1 > explainMaxLines {
		return t, ErrTooLong
	}
	if req.L1 > len(lines) || req.L2 > len(lines) {
		return t, ErrMismatch
	}
	t.L1, t.L2, t.Col = req.L1, req.L2, -1
	text := strings.Join(lines[req.L1-1:req.L2], "\n")
	if req.C1 != nil && req.C2 != nil {
		var ok bool
		text, ok = sliceColumns(lines, req.L1, *req.C1, req.L2, *req.C2)
		if !ok {
			return t, ErrMismatch
		}
	}
	if strings.TrimSpace(text) == "" {
		return t, ErrBlank
	}
	t.Text = text
	name := req.Symbol
	if name == "" && req.C1 != nil && req.C2 != nil {
		name = strings.TrimSpace(text)
	}
	if req.L1 == req.L2 && explainWholeID.MatchString(name) {
		line := lines[req.L1-1]
		if req.C1 != nil && req.C2 != nil {
			if strings.TrimSpace(text) != name {
				return t, ErrMismatch
			}
			t.Col = *req.C1 + UTF16Len(text[:strings.Index(text, name)])
		} else if at := strings.Index(line, name); at >= 0 && strings.Count(line, name) == 1 {
			t.Col = UTF16Len(line[:at])
		} else if at < 0 {
			return t, ErrMismatch
		}
		if t.Col >= 0 {
			t.Name, t.Text = name, name
		}
	}
	return t, nil
}

// sliceColumns cuts l1:c1 to l2:c2 out of the file; columns are UTF-16 units.
func sliceColumns(lines []string, l1, c1, l2, c2 int) (string, bool) {
	if c1 < 0 || c2 < 0 || c1 > UTF16Len(lines[l1-1]) || c2 > UTF16Len(lines[l2-1]) {
		return "", false
	}
	if l1 == l2 {
		if c2 < c1 {
			return "", false
		}
		line := lines[l1-1]
		return line[codeintel.UTF16ToByte(line, c1):codeintel.UTF16ToByte(line, c2)], true
	}
	parts := append([]string(nil), lines[l1-1:l2]...)
	parts[0] = parts[0][codeintel.UTF16ToByte(parts[0], c1):]
	last := len(parts) - 1
	parts[last] = parts[last][:codeintel.UTF16ToByte(parts[last], c2)]
	return strings.Join(parts, "\n"), true
}

// ReadLines reads a source file as lines, refusing directories and files
// over explainMaxFileBytes.
func ReadLines(abs string) ([]string, error) {
	st, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Size() > explainMaxFileBytes {
		return nil, errors.New("not a readable source file")
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	return strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n"), nil
}
