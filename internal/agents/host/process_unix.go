//go:build !windows

package host

import (
	"os/exec"
	"syscall"
)

func group(c *exec.Cmd)     { c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func terminate(c *exec.Cmd) { _ = syscall.Kill(-c.Process.Pid, syscall.SIGTERM) }
func kill(c *exec.Cmd)      { _ = syscall.Kill(-c.Process.Pid, syscall.SIGKILL) }
