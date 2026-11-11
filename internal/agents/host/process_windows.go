package host

import "os/exec"

func command(argv []string) (*exec.Cmd, func(), func(), error) {
	return exec.Command(argv[0], argv[1:]...), func() {}, func() {}, nil
}
func terminate(c *exec.Cmd) { _ = c.Process.Kill() }
func kill(c *exec.Cmd)      { _ = c.Process.Kill() }
