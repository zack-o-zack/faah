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

func TestHighlightChangedWordsSchemaAndRoundTrip(t *testing.T) {
	isolateSettings(t)
	const key = "diffEditor.highlightChangedWords"
	found := false
	for _, item := range Schema {
		if item.Key != key {
			continue
		}
		found = true
		if item.Type != "boolean" || item.Default != true ||
			item.Title != "Diff: Highlight Changed Words" ||
			item.Description != "Highlights the words that changed inside a changed line." ||
			item.Category != "Git & Diff" {
			t.Fatalf("unexpected schema: %+v", item)
		}
	}
	if !found || DefaultMap()[key] != true || ReadMergedMap()[key] != true {
		t.Fatalf("expected boolean schema with default true, found=%t default=%v", found, DefaultMap()[key])
	}
	for _, value := range []bool{false, true} {
		if err := UpdateMap(map[string]any{key: value}); err != nil {
			t.Fatal(err)
		}
		if got := ReadRawMap()[key]; got != value {
			t.Fatalf("saved value = %v, want %v", got, value)
		}
		if got := ReadMergedMap()[key]; got != value {
			t.Fatalf("loaded value = %v, want %v", got, value)
		}
	}
	if err := UpdateMap(map[string]any{key: nil}); err != nil {
		t.Fatal(err)
	}
	if got := ReadMergedMap()[key]; got != true {
		t.Fatalf("default after reset = %v, want true", got)
	}
}
