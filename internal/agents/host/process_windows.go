package host

import "os/exec"

func group(c *exec.Cmd)     {}
func terminate(c *exec.Cmd) { _ = c.Process.Kill() }
func kill(c *exec.Cmd)      { _ = c.Process.Kill() }
