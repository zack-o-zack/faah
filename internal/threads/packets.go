package threads

import (
	"os"
	"path/filepath"
	"strings"
)

// Packets live beside the store, because saveLocked rewrites the whole store
// on every turn and they are up to 16 KB each.
func (tm *Manager) explainPacketPath(id string) string {
	if tm.file == "" {
		return ""
	}
	return filepath.Join(strings.TrimSuffix(tm.file, ".json")+".explain", id+".md")
}

func (tm *Manager) writeExplainPacket(id, packet string) {
	p := tm.explainPacketPath(id)
	if p == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(p, []byte(packet), 0o600)
}

func (tm *Manager) readExplainPacket(id string) string {
	p := tm.explainPacketPath(id)
	if p == "" {
		return ""
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	return string(data)
}

func (tm *Manager) removeExplainPacket(id string) {
	if p := tm.explainPacketPath(id); p != "" {
		_ = os.Remove(p)
	}
}
