package review

import (
	"testing"

	"faah/internal/render"
)

func TestExtractCodeUnderstanding(t *testing.T) {
	hunks := []render.DiffHunk{
		{
			OldStart: 10,
			NewStart: 10,
			Section:  "func ProcessRequest",
			Rows: []render.DiffRow{
				{Type: "ctx", OldLine: 10, NewLine: 10, Text: "func ProcessRequest(req *Request) error {"},
				{Type: "add", NewLine: 11, Text: "\tif req == nil {"},
				{Type: "add", NewLine: 12, Text: "\t\treturn ErrNilRequest"},
				{Type: "add", NewLine: 13, Text: "\t}"},
				{Type: "add", NewLine: 14, Text: "\tif !user.HasPermission(\"admin\") {"},
				{Type: "add", NewLine: 15, Text: "\t\treturn ErrForbidden"},
				{Type: "add", NewLine: 16, Text: "\t}"},
				{Type: "add", NewLine: 17, Text: "\tres, err := db.Query()"},
				{Type: "add", NewLine: 18, Text: "\tif err != nil {"},
				{Type: "add", NewLine: 19, Text: "\t\treturn fmt.Errorf(\"failed to query: %w\", err)"},
				{Type: "add", NewLine: 20, Text: "\t}"},
				{Type: "add", NewLine: 21, Text: "\tcache.Set(res)"},
				{Type: "ctx", OldLine: 11, NewLine: 22, Text: "\treturn nil"},
			},
		},
	}

	und := extractCodeUnderstanding("service.go", hunks)
	if und == nil {
		t.Fatal("expected non-nil understanding")
	}

	// Should detect fast returns (nil check & auth check)
	if len(und.FastReturns) == 0 {
		t.Fatalf("expected fast returns to be detected, got 0")
	}
	hasNil := false
	hasAuth := false
	for _, fr := range und.FastReturns {
		if fr.Kind == "nil_check" {
			hasNil = true
		}
		if fr.Kind == "auth" {
			hasAuth = true
		}
	}
	if !hasNil {
		t.Errorf("expected nil_check fast return, got: %+v", und.FastReturns)
	}
	if !hasAuth {
		t.Errorf("expected auth fast return, got: %+v", und.FastReturns)
	}

	// Should detect edge case (error check)
	if len(und.EdgeCases) == 0 {
		t.Fatalf("expected edge cases to be detected, got 0")
	}
	hasErr := false
	for _, ec := range und.EdgeCases {
		if ec.Kind == "error" {
			hasErr = true
		}
	}
	if !hasErr {
		t.Errorf("expected error edge case, got: %+v", und.EdgeCases)
	}

	// Should have generated summary
	if und.Summary == "" {
		t.Errorf("expected non-empty summary")
	}
}
