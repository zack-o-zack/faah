package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// mcpCall posts one tools/call to the server's MCP endpoint with a token and
// returns the HTTP status.
func mcpCall(t *testing.T, s *Server, tok, name, args string) int {
	t.Helper()
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"` + name + `","arguments":` + args + `}}`
	r := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w.Code
}

func TestExplainToolCallsLandOnTheTurn(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	// The fake codex finds faah's endpoint and token in its -c flags and calls
	// annotate with curl, as a real harness would over MCP.
	script := `url=""; tok=""
for a in "$@"; do case "$a" in
mcp_servers.faah.url=*) url=${a#*=}; url=${url#\"}; url=${url%\"} ;;
mcp_servers.faah.http_headers=*) tok=${a#*Bearer }; tok=${tok%%\"*} ;;
esac; done
printf 'tok=%s\n' "$tok"
curl -s -H "Authorization: Bearer $tok" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"annotate","arguments":{"notes":[{"kind":"symbol","path":"main.go","l1":7,"symbol":"helper","summary":"Does nothing yet."}]}}}' "$url"
`
	s := explainServer(t, root, script)
	ts := httptest.NewServer(s)
	defer ts.Close()
	s.SetToolsAddr(strings.TrimPrefix(ts.URL, "http://"))
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	th := waitThreadIdle(t, s, m["thread"].(map[string]any)["id"].(string))
	tr := th.Turns[0]
	if n := tr.Notes; len(n) != 1 || n[0].Symbol != "helper" || n[0].L1 != 7 || n[0].Text != "func helper() {}" {
		t.Fatalf("notes = %+v\nreply: %s\nerror: %s", n, tr.Reply, tr.Error)
	}
	// The token stops working when the turn ends.
	tok := regexp.MustCompile(`tok=(\w+)`).FindStringSubmatch(tr.Reply)
	if tok == nil {
		t.Fatalf("no token in %q", tr.Reply)
	}
	if code := mcpCall(t, s, tok[1], "annotate", `{"notes":[]}`); code != http.StatusUnauthorized {
		t.Fatalf("after the turn, a call = %d", code)
	}
}

func TestExplainTaggedBlocksLandOnTheTurn(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	verifyHarnesses(t, "opencode")
	p := filepath.Join(t.TempDir(), "opencode")
	body := "#!/bin/sh\nprintf '%s\\n' 'Helper.' '<faah:annotate>{\"notes\":[{\"kind\":\"line\",\"path\":\"main.go\",\"l1\":4,\"summary\":\"Calls helper.\"}]}</faah:annotate>'\n"
	if err := os.WriteFile(p, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	s := agentServer(t, root, p+" run")
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	th := waitThreadIdle(t, s, m["thread"].(map[string]any)["id"].(string))
	tr := th.Turns[0]
	if strings.Contains(tr.Reply, "faah:annotate") || len(tr.Notes) != 1 || tr.Notes[0].Text != "\thelper()" {
		t.Fatalf("reply = %q, notes = %+v, error = %s", tr.Reply, tr.Notes, tr.Error)
	}
}
