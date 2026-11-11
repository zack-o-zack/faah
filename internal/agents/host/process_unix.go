//go:build !windows

package host

import (
	"os"
	"os/exec"
	"syscall"
)

func command(argv []string) (*exec.Cmd, func(), func(), error) {
	read, write, err := os.Pipe()
	if err != nil {
		return nil, nil, nil, err
	}
	// The watcher also runs if the parent exits without closing its sessions.
	script := `(
 trap '' TERM
 read -r unused <&3
 kill -TERM -$$
 sleep 5
 kill -KILL -$$
 ) </dev/null >/dev/null 2>&1 &
 exec 3<&-
 exec "$@"`
	cmd := exec.Command("/bin/sh", append([]string{"-c", script, "faah-agent"}, argv...)...)
	cmd.ExtraFiles = []*os.File{read}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return cmd, func() { read.Close() }, func() { write.Close() }, nil
}

func terminate(c *exec.Cmd) { _ = syscall.Kill(-c.Process.Pid, syscall.SIGTERM) }

func kill(c *exec.Cmd) { _ = syscall.Kill(-c.Process.Pid, syscall.SIGKILL) }
