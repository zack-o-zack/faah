package diffview

import (
	"strings"

	"faah/internal/git"
	"faah/internal/render"
)

func Read(root, path, base, head string, ignoreWhitespace bool, otherPaths ...string) (string, []render.DiffHunk) {
	read := git.DiffPaths
	if ignoreWhitespace {
		read = git.DiffPathsIgnoringWhitespace
	}
	text := read(root, base, head, append([]string{path}, otherPaths...)...)
	return text, Highlight(path, text, ignoreWhitespace)
}

func Highlight(path, text string, ignoreWhitespace bool) []render.DiffHunk {
	hunks := render.HighlightDiff(path, text)
	if ignoreWhitespace {
		for index := range hunks {
			rows := hunks[index].Rows[:0]
			for _, row := range hunks[index].Rows {
				if row.Type != "ctx" && strings.TrimSpace(row.Text) == "" {
					continue
				}
				rows = append(rows, row)
			}
			hunks[index].Rows = rows
		}
	}
	return hunks
}
