package diffview

import (
	"reflect"
	"testing"

	"faah/internal/render"
)

func TestHighlightWhitespace(t *testing.T) {
	for _, test := range []struct {
		name   string
		diff   string
		ignore bool
		want   []render.DiffRow
	}{
		{"exact", "@@ -1,2 +1 @@\n-\n-old\n+new\n", false, []render.DiffRow{{Type: "del", OldLine: 1, At: 1, Text: ""}, {Type: "del", OldLine: 2, At: 1, Text: "old"}, {Type: "add", NewLine: 1, Text: "new"}}},
		{"mixed", "@@ -4,3 +4,3 @@\n-\t\n-old\n+new\n+  \n context\n", true, []render.DiffRow{{Type: "del", OldLine: 5, At: 4, Text: "old"}, {Type: "add", NewLine: 4, Text: "new"}, {Type: "ctx", OldLine: 6, NewLine: 6, Text: "context"}}},
		{"blank context", "@@ -1,2 +1,2 @@\n \n-old\n+new\n", true, []render.DiffRow{{Type: "ctx", OldLine: 1, NewLine: 1, Text: ""}, {Type: "del", OldLine: 2, At: 2, Text: "old"}, {Type: "add", NewLine: 2, Text: "new"}}},
		{"blank additions and deletions", "@@ -1 +1 @@\n-\t\n+ \n", true, nil},
		{"empty", "", true, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			var rows []render.DiffRow
			for _, hunk := range Highlight("file.txt", test.diff, test.ignore) {
				for _, row := range hunk.Rows {
					row.HTML = ""
					rows = append(rows, row)
				}
			}
			if !reflect.DeepEqual(rows, test.want) {
				t.Fatalf("rows = %#v, want %#v", rows, test.want)
			}
		})
	}
}
