package acp

import "strings"

// Args removes turn-only options and keeps only options supported in ACP mode.
func Args(base []string, name string) []string {
	if len(base) == 0 {
		base = []string{name}
	}
	out := []string{base[0], "acp"}
	values := map[string]bool{}
	switches := map[string]bool{}
	for _, f := range []string{"--add-dir", "--agent", "--log-file", "--cli_log_file"} {
		values[f] = true
	}
	switches["--disable-telemetry"] = true
	switches["--sandbox"] = true

	for i := 1; i < len(base); i++ {
		a := base[i]
		key, _, equal := strings.Cut(a, "=")
		if values[key] {
			out = append(out, a)
			if !equal && i+1 < len(base) {
				i++
				out = append(out, base[i])
			}
			continue
		}
		if switches[key] {
			out = append(out, a)
			continue
		}
		switch key {
		case "-p", "--prompt", "--output-format", "-o", "--mode", "--conversation", "--resume", "-r", "--session-id", "--model", "-m", "--approval-mode", "--prompt-interactive", "-i":
			if !equal && i+1 < len(base) {
				i++
			}
		}
	}
	return out
}
