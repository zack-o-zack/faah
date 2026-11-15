package settings

import "testing"

func TestDiffOptionsRoundTrip(t *testing.T) {
	isolateSettings(t)
	defaults := DefaultMap()
	if defaults["diffEditor.ignoreWhitespace"] != false {
		t.Fatalf("whitespace default = %v", defaults["diffEditor.ignoreWhitespace"])
	}
	for _, item := range Schema {
		if item.Title == "Diff: Ignore Trim Whitespace" {
			t.Fatal("obsolete whitespace setting")
		}
	}
	for _, value := range []bool{true, false} {
		if err := UpdateMap(map[string]any{"diffEditor.ignoreWhitespace": value, "diffEditor.renderSideBySide": value}); err != nil {
			t.Fatal(err)
		}
		if got := ReadMergedMap(); got["diffEditor.ignoreWhitespace"] != value || got["diffEditor.renderSideBySide"] != value {
			t.Fatalf("round trip: %v", got)
		}
	}
}
