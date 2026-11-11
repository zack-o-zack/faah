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
	if strings.TrimSpace(req.Text) == "" || req.L1 < 1 || req.L2 < req.L1 {
		return t, ErrBlank
	}
	if req.L2-req.L1+1 > explainMaxLines {
		return t, ErrTooLong
	}
	if req.L1 > len(lines) {
		return t, ErrMismatch
	}
	l2 := min(req.L2, len(lines))
	t.L1, t.L2, t.Col = req.L1, l2, -1

	if req.C1 != nil && req.C2 != nil {
		text, ok := sliceColumns(lines, req.L1, *req.C1, l2, *req.C2)
		if !ok || text != strings.ReplaceAll(req.Text, "\r\n", "\n") {
			return t, ErrMismatch
		}
		t.Text = text
		if l2 == req.L1 {
			if name := strings.TrimSpace(text); explainWholeID.MatchString(name) {
				lead := text[:strings.Index(text, name)]
				t.Name, t.Col, t.Text = name, *req.C1+UTF16Len(lead), name
			}
		}
		return t, nil
	}

	if !columnlessMatches(lines[req.L1-1:l2], req.Text) {
		return t, ErrMismatch
	}
	t.Text = strings.Join(lines[req.L1-1:l2], "\n")
	if name := strings.TrimSpace(req.Text); l2 == req.L1 && explainWholeID.MatchString(name) && strings.Count(lines[req.L1-1], name) == 1 {
		line := lines[req.L1-1]
		t.Name, t.Col, t.Text = name, UTF16Len(line[:strings.Index(line, name)]), name
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

// columnlessMatches checks a diff selection. Its text can include deleted rows
// and clipped end lines, so only whole interior lines must be present.
func columnlessMatches(disk []string, text string) bool {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	if len(disk) == 1 {
		return strings.Contains(disk[0], strings.TrimRight(text, "\n"))
	}
	have := map[string]bool{}
	for _, l := range strings.Split(text, "\n") {
		have[l] = true
	}
	for _, l := range disk[1 : len(disk)-1] {
		if !have[l] {
			return false
		}
	}
	return true
}

// ReadLines reads a source file as lines, refusing directories and files
// over explainMaxFileBytes.
func ReadLines(abs string) ([]string, error) {
	st, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if st.IsDir() || st.Size() > explainMaxFileBytes {
		return nil, errors.New("not a readable source file")
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	return strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n"), nil
}
