// Package agy runs Antigravity sessions over ACP.
package agy

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/acp"
)

// Agent opens native agy conversations.
type Agent struct{}

// New returns the agy adapter.
func New() *Agent { return &Agent{} }

// Name identifies the adapter.
func (*Agent) Name() string { return "agy" }

// Open starts or resumes a persistent conversation.
func (*Agent) Open(ctx context.Context, o agents.Open) (agents.Session, error) {
	argv := acp.Args(o.Base, "agy")
	versionCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(versionCtx, argv[0], "--version")
	cmd.Env = append(os.Environ(), o.Env...)
	b, _ := cmd.Output()
	var meta any
	if workflowQuirk(strings.TrimSpace(string(b))) {
		meta = map[string]any{"antigravity": map[string]any{"disabledTools": []string{"run_workflow"}}}
	}
	return acp.Open(ctx, o, argv, []string{"AGY_ACP_FORCE_FILE_STORAGE=1", "PYTHONUNBUFFERED=1"}, meta, true)
}

func workflowQuirk(version string) bool {
	var major, minor, patch int
	_, err := fmt.Sscanf(version, "%d.%d.%d", &major, &minor, &patch)
	return err == nil && major == 1 && minor == 4 && patch >= 2 && patch <= 5
}
