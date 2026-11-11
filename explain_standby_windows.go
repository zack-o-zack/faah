//go:build windows

package main

import "os/exec"

func standbyGroup(cmd *exec.Cmd) {}

func standbyKill(cmd *exec.Cmd) {
	if cmd.Process != nil {
		cmd.Process.Kill()
	}
}
