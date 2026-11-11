package agents

import (
	"crypto/rand"
	"encoding/hex"
)

// NewUUID returns a random version 4 UUID, the form claude and gemini accept
// as a session id.
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
