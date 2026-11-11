//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// standbyGroup puts the harness in its own process group, so killing it also
// kills the helpers it started.
func standbyGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func standbyKill(cmd *exec.Cmd) {
	if cmd.Process != nil && cmd.Process.Pid > 0 {
		syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
