package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

// Bridge forwards newline-delimited MCP messages to a Streamable HTTP endpoint.
// It waits for negotiation and all outstanding calls before returning on EOF.
func Bridge(ctx context.Context, input io.Reader, output io.Writer, endpoint, authorization string) error {
	var mu sync.Mutex
	var wg sync.WaitGroup
	var writeErr error
	session, protocol := "", ""
	write := func(b []byte) {
		mu.Lock()
		defer mu.Unlock()
		if writeErr == nil {
			_, writeErr = output.Write(append(b, '\n'))
		}
	}
	failure := func(id json.RawMessage, code int, err error) {
		if len(id) == 0 {
			id = json.RawMessage("null")
		}
		b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": err.Error()}})
		write(b)
	}
	forward := func(line []byte, id json.RawMessage, initialize bool) {
		req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(line))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json, text/event-stream")
			req.Header.Set("Authorization", authorization)
			mu.Lock()
			if !initialize && session != "" {
				req.Header.Set("Mcp-Session-Id", session)
			}
			if protocol != "" {
				req.Header.Set("MCP-Protocol-Version", protocol)
			}
			mu.Unlock()
			var res *http.Response
			res, err = http.DefaultClient.Do(req)
			if err == nil {
				defer res.Body.Close()
				if res.StatusCode < 200 || res.StatusCode >= 300 {
					err = fmt.Errorf("faah MCP endpoint responded with HTTP %d", res.StatusCode)
				} else if res.StatusCode != http.StatusAccepted {
					mu.Lock()
					if v := res.Header.Get("Mcp-Session-Id"); v != "" {
						session = v
					}
					if v := res.Header.Get("MCP-Protocol-Version"); v != "" {
						protocol = v
					}
					mu.Unlock()
					payload := func(b []byte) {
						var compact bytes.Buffer
						if e := json.Compact(&compact, b); e != nil {
							err = e
							return
						}
						if initialize {
							var f struct {
								Result struct {
									ProtocolVersion string `json:"protocolVersion"`
								}
							}
							json.Unmarshal(b, &f)
							if f.Result.ProtocolVersion != "" {
								mu.Lock()
								protocol = f.Result.ProtocolVersion
								mu.Unlock()
							}
						}
						write(compact.Bytes())
					}
					if strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
						scan := bufio.NewScanner(res.Body)
						scan.Buffer(make([]byte, 65536), 16<<20)
						data := []string{}
						flush := func() {
							if len(data) > 0 {
								payload([]byte(strings.Join(data, "\n")))
								data = nil
							}
						}
						for scan.Scan() {
							line := scan.Text()
							if line == "" {
								flush()
							} else if strings.HasPrefix(line, "data:") {
								data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
							}
						}
						flush()
						if e := scan.Err(); e != nil {
							err = e
						}
					} else {
						var b []byte
						b, err = io.ReadAll(res.Body)
						if err == nil {
							payload(b)
						}
					}
				}
			}
		}
		if err != nil && len(id) > 0 {
			failure(id, -32603, err)
		}
	}
	type queued struct {
		line []byte
		id   json.RawMessage
	}
	var waiting []queued
	initialized := false
	scan := bufio.NewScanner(input)
	scan.Buffer(make([]byte, 65536), 16<<20)
	for scan.Scan() {
		line := append([]byte(nil), scan.Bytes()...)
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var f struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		if !json.Valid(line) {
			failure(nil, -32700, fmt.Errorf("Parse error"))
			continue
		}
		if json.Unmarshal(line, &f) != nil {
			continue
		}
		if f.Method != "initialize" && !initialized {
			waiting = append(waiting, queued{line, f.ID})
			continue
		}
		if f.Method == "initialize" || f.Method == "notifications/initialized" {
			if f.Method == "initialize" {
				wg.Wait()
			}
			forward(line, f.ID, f.Method == "initialize")
			if f.Method == "initialize" {
				initialized = true
				for _, q := range waiting {
					wg.Add(1)
					go func() { defer wg.Done(); forward(q.line, q.id, false) }()
				}
				waiting = nil
			}
			continue
		}
		wg.Add(1)
		go func() { defer wg.Done(); forward(line, f.ID, false) }()
	}
	wg.Wait()
	for _, q := range waiting {
		if len(q.id) > 0 {
			failure(q.id, -32603, fmt.Errorf("MCP initialize was not received"))
		}
	}
	if err := scan.Err(); err != nil {
		return err
	}
	return writeErr
}
