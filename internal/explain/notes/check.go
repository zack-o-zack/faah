package notes

import (
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
)

const (
	maxNotes   = 100
	maxSteps   = 20
	maxSummary = 120  // runes
	maxBody    = 4000 // runes
	snapLines  = 3
)

// CheckNotes keeps the notes that pass the checks, each with its line text,
// and says what was wrong with each of the others.
func CheckNotes(read Reader, in []Note) ([]Note, []string) {
	if len(in) == 0 || len(in) > maxNotes {
		return nil, []string{fmt.Sprintf("annotate takes 1 to %d notes", maxNotes)}
	}
	var ok []Note
	var errs []string
	for i, n := range in {
		if err := checkNote(read, &n); err != nil {
			errs = append(errs, fmt.Sprintf("notes[%d]: %s", i, err))
			continue
		}
		ok = append(ok, n)
	}
	return ok, errs
}

func checkNote(read Reader, n *Note) error {
	switch n.Kind {
	case "symbol", "line", "block":
	default:
		return errors.New("kind must be symbol, line or block")
	}
	n.Summary = cut(strings.TrimSpace(n.Summary), maxSummary)
	if n.Summary == "" {
		return errors.New("summary is empty")
	}
	n.Detail = cut(strings.TrimSpace(n.Detail), maxBody)
	n.Path = cleanPath(n.Path)
	lines, ok := read(n.Path)
	if !ok {
		return fmt.Errorf("%s is not a file in the workspace", n.Path)
	}
	if n.Kind != "block" {
		n.L2 = n.L1 // a symbol or a line is shown on one line
	}
	if err := checkRange(lines, n.Path, n.L1, n.L2); err != nil {
		return err
	}
	if n.Kind == "symbol" {
		if n.Symbol == "" {
			return errors.New("symbol is empty")
		}
		line, err := findSymbol(lines, n.Path, n.Symbol, n.L1)
		if err != nil {
			return err
		}
		n.L1, n.L2 = line, line
	}
	n.Text = strings.Join(lines[n.L1-1:n.L2], "\n")
	return nil
}

// CheckWalkthrough checks every step. One bad step refuses the walkthrough.
func CheckWalkthrough(read Reader, w Walkthrough) (Walkthrough, error) {
	w.Title = cut(strings.TrimSpace(w.Title), maxSummary)
	if w.Title == "" {
		return w, errors.New("title is empty")
	}
	if len(w.Steps) < 2 || len(w.Steps) > maxSteps {
		return w, fmt.Errorf("a walkthrough has 2 to %d steps", maxSteps)
	}
	var errs []string
	for i := range w.Steps {
		s := &w.Steps[i]
		s.Title = cut(strings.TrimSpace(s.Title), maxSummary)
		s.Body = cut(strings.TrimSpace(s.Body), maxBody)
		s.Path = cleanPath(s.Path)
		lines, ok := read(s.Path)
		var err error
		switch {
		case s.Title == "" || s.Body == "":
			err = errors.New("title and body are required")
		case !ok:
			err = fmt.Errorf("%s is not a file in the workspace", s.Path)
		default:
			err = checkRange(lines, s.Path, s.L1, s.L2)
		}
		if err != nil {
			errs = append(errs, fmt.Sprintf("step %d: %s", i+1, err))
			continue
		}
		s.Text = strings.Join(lines[s.L1-1:s.L2], "\n")
	}
	if len(errs) > 0 {
		return w, errors.New(strings.Join(errs, "; "))
	}
	return w, nil
}

func checkRange(lines []string, path string, l1, l2 int) error {
	where := fmt.Sprintf("%s:%d", path, l1)
	if l2 != l1 {
		where = fmt.Sprintf("%s:%d-%d", path, l1, l2)
	}
	switch {
	case l1 < 1 || l2 < l1:
		return fmt.Errorf("%s is not a range of lines", where)
	case l2 > len(lines):
		return fmt.Errorf("%s is past the end of the file (%d lines)", where, len(lines))
	}
	return nil
}

// findSymbol returns the line that has name as a whole word: line itself, the
// nearest within snapLines, or an error naming where it really is.
func findSymbol(lines []string, path, name string, line int) (int, error) {
	re := regexp.MustCompile(`(^|[^\p{L}\p{N}_$])` + regexp.QuoteMeta(name) + `($|[^\p{L}\p{N}_$])`)
	has := func(n int) bool { return n >= 1 && n <= len(lines) && re.MatchString(lines[n-1]) }
	for d := 0; d <= snapLines; d++ {
		if has(line - d) {
			return line - d, nil
		}
		if has(line + d) {
			return line + d, nil
		}
	}
	best := 0
	for n := 1; n <= len(lines); n++ {
		if has(n) && (best == 0 || abs(n-line) < abs(best-line)) {
			best = n
		}
	}
	if best == 0 {
		return 0, fmt.Errorf("%s is not in %s", name, path)
	}
	return 0, fmt.Errorf("%s is not on %s:%d; it is on line %d", name, path, line, best)
}

// cleanPath writes a workspace path one way, so notes on a file are found
// whichever way the agent wrote it.
func cleanPath(p string) string {
	return path.Clean(strings.ReplaceAll(strings.TrimSpace(p), "\\", "/"))
}

func cut(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
