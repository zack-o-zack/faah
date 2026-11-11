package agents

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// NewUUID returns a random version 4 UUID, the form claude and gemini accept
// as a session id. Moved from newUUID in agent.go.
func NewUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// SetFlag returns a copy of argv with flag's value replaced. ok is false when
// argv has no such flag.
func SetFlag(argv []string, flag, value string) ([]string, bool) {
	out := append([]string(nil), argv...)
	for i := 0; i+1 < len(out); i++ {
		if out[i] == flag {
			out[i+1] = value
			return out, true
		}
	}
	return out, false
}

// InsertAfterBinary returns argv with extra placed right after argv[0].
func InsertAfterBinary(argv, extra []string) []string {
	out := make([]string, 0, len(argv)+len(extra))
	out = append(out, argv[0])
	out = append(out, extra...)
	return append(out, argv[1:]...)
}

// StdinArgv makes a print-mode argv read its prompt as stream-json on stdin:
// it adds --input-format stream-json and empties the prompt placeholder.
// Moved from standbyArgv in explain_standby.go.
func StdinArgv(argv []string, placeholder string) []string {
	out := make([]string, 0, len(argv)+2)
	out = append(out, argv[0], "--input-format", "stream-json")
	for _, a := range argv[1:] {
		out = append(out, strings.ReplaceAll(a, placeholder, ""))
	}
	return out
}
