package threads

import (
	"os"
	"testing"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/all"
	"faah/internal/mcp"
	"faah/internal/threads/threadstest"
)

var fakeCLI = threadstest.CLI

func TestMain(m *testing.M) {
	threadstest.RunCLIHelper()
	os.Exit(m.Run())
}

func isolateSettings(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	return dir
}

func testJobs(root, name string) *Jobs {
	return NewJobs(root, "test", func() (string, []string, string) {
		if name == "" {
			return "", nil, ""
		}
		return name, []string{name}, ""
	}, all.For)
}

type testCredentials struct {
	tokens mcp.Tokens
}

func (c *testCredentials) Issue(id string) string { return c.tokens.Issue(id) }
func (c *testCredentials) Touch(id string)        { c.tokens.Touch(id) }
func (c *testCredentials) Revoke(token string)    { c.tokens.Revoke(token) }
func (c *testCredentials) RevokeThread(id string) {
	c.tokens.RevokeScope(func(scope any) bool { return scope == id })
}
func (c *testCredentials) Endpoint(string) *agents.ToolEndpoint { return nil }

func testManager(jobs *Jobs, root string) *Manager {
	return New(jobs, root, StorePath(root), Runtime{}, &testCredentials{})
}

func waitThreadIdle(t *testing.T, tm *Manager, id string) *Thread {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if th := tm.Get(id); th != nil && !th.Running() {
			return th
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("thread did not finish")
	return nil
}
