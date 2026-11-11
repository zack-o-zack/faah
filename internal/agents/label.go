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
