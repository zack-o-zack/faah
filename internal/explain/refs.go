package explain

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Resolve finds a cited file, refusing anything outside the workspace,
// including through a symlink.
func Resolve(root, rel string) (string, bool) {
	clean := filepath.Clean(filepath.FromSlash(rel))
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", false
	}
	abs := filepath.Join(root, clean)
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", false
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil || !strings.HasPrefix(real, realRoot+string(filepath.Separator)) {
		return "", false
	}
	return abs, true
}

// ValidateRefs checks each citation in a finished reply and returns the
// ones that hold, keyed by target as written. A citation left out renders as
// plain text. The reply itself is never changed, since it is replayed later.
func ValidateRefs(root, reply string) map[string]Ref {
	type citation struct{ label, target string }
	var cites []citation
	spans, rest := explainCodeSpans(reply)
	for _, span := range spans {
		cites = append(cites, citation{"", strings.TrimSpace(span)})
	}
	for _, m := range explainMdLinkRe.FindAllStringSubmatch(rest, -1) {
		cites = append(cites, citation{m[1], strings.TrimSpace(m[2])})
	}
	// Links come out first, as in the client, or "(path:line)" would read as bare.
	for _, m := range explainBareRe.FindAllStringSubmatch(explainMdLinkRe.ReplaceAllString(rest, " "), -1) {
		cites = append(cites, citation{"", m[1]})
	}

	files := map[string][]string{}
	load := func(rel string) []string {
		if l, ok := files[rel]; ok {
			return l
		}
		var lines []string
		if abs, ok := Resolve(root, rel); ok {
			lines, _ = ReadLines(abs)
		}
		files[rel] = lines
		return lines
	}

	out := map[string]Ref{}
	for _, c := range cites {
		m := explainTargetRe.FindStringSubmatch(c.target)
		if m == nil {
			continue
		}
		if _, done := out[c.target]; done {
			continue
		}
		lines := load(m[1])
		if lines == nil {
			continue
		}
		if m[2] == "" {
			out[c.target] = Ref{}
			continue
		}
		l1, _ := strconv.Atoi(m[2])
		l2 := l1
		if m[3] != "" {
			l2, _ = strconv.Atoi(m[3])
		}
		total := len(lines)
		if lines[total-1] == "" {
			total-- // the empty string after a final newline is not a line
		}
		if l1 < 1 || l2 < l1 || l2 > total {
			continue
		}
		delta, ok := explainSnap(lines[:total], c.label, l1, l2)
		if !ok {
			continue
		}
		ref := Ref{Line: l1 + delta}
		if m[3] != "" {
			ref.End = l2 + delta
		}
		out[c.target] = ref
	}
	return out
}

// explainCodeSpans separates inline code spans from the text around them. A
// label such as [`Name`](path:1) keeps its span, which is what labels are for.
func explainCodeSpans(s string) ([]string, string) {
	var spans []string
	var rest strings.Builder
	for i := 0; i < len(s); {
		if s[i] != '`' {
			rest.WriteByte(s[i])
			i++
			continue
		}
		start := i
		for i < len(s) && s[i] == '`' {
			i++
		}
		fence := s[start:i]
		end := strings.Index(s[i:], fence)
		if end < 0 {
			rest.WriteString(fence)
			continue
		}
		span := s[i : i+end]
		spans = append(spans, span)
		if explainTargetRe.MatchString(strings.TrimSpace(span)) {
			rest.WriteByte(' ')
		} else {
			rest.WriteString(fence + span + fence)
		}
		i += end + len(fence)
	}
	return spans, rest.String()
}

// LabelName pulls the identifier out of a citation label, or returns ""
// for a label that is a description rather than a name.
func LabelName(label string) string {
	s := strings.Trim(label, "`*_ ")
	s = strings.TrimSuffix(s, "()")
	if i := strings.LastIndexByte(s, '.'); i >= 0 {
		s = s[i+1:]
	}
	if !explainWholeID.MatchString(s) {
		return ""
	}
	return s
}

// explainSnap returns how far a citation must move to reach its named symbol:
// zero when it already appears there, otherwise the nearest occurrence.
func explainSnap(lines []string, label string, l1, l2 int) (int, bool) {
	name := LabelName(label)
	if name == "" {
		return 0, true
	}
	re, err := regexp.Compile(`(^|[^\p{L}\p{N}_$])` + regexp.QuoteMeta(name) + `($|[^\p{L}\p{N}_$])`)
	if err != nil {
		return 0, true
	}
	for n := l1; n <= l2; n++ {
		if re.MatchString(lines[n-1]) {
			return 0, true
		}
	}
	for d := 1; d <= explainSnapLines; d++ {
		if n := l1 - d; n >= 1 && re.MatchString(lines[n-1]) {
			return -d, true
		}
		if n := l2 + d; n <= len(lines) && re.MatchString(lines[n-1]) {
			return d, true
		}
	}
	return 0, false
}
