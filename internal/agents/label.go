package agents

import (
	"encoding/json"
	"strings"
)

// ToolLabel is "Edit server.go" or "Bash go test ./...": the tool and the one
// argument that says what it acted on.
func ToolLabel(name string, input json.RawMessage) string {
	var in map[string]any
	json.Unmarshal(input, &in)
	for _, k := range []string{"file_path", "path", "AbsolutePath", "TargetFile", "command", "CommandLine", "pattern", "query", "url", "description"} {
		if v, ok := in[k].(string); ok && v != "" {
			v = strings.Join(strings.Fields(v), " ")
			if r := []rune(v); len(r) > 120 {
				v = string(r[:120]) + "…"
			}
			return name + " " + v
		}
	}
	return name
}

// StepLabel names a call to annotate or walkthrough in words, whatever prefix
// the agent gave the tool ("mcp__faah__annotate", "faah-t1_annotate", "Run
// mcp_faah_annotate"). Other steps pass through unchanged.
func StepLabel(label string) string {
	f := strings.Fields(label)
	if len(f) == 0 {
		return label
	}
	last := f[len(f)-1]
	for name, words := range map[string]string{"annotate": "Show notes", "walkthrough": "Show a walkthrough"} {
		if len(f) == 1 && last == name || strings.Contains(last, "faah") && strings.HasSuffix(last, "_"+name) {
			return words
		}
	}
	return label
}
