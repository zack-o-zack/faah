//go:build !windows

package host

import (
	"os"
	"os/exec"
	"syscall"
)

func command(argv []string) (*exec.Cmd, *processLifetime, error) {
	read, write, err := os.Pipe()
	if err != nil {
		return nil, nil, err
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
	return cmd, &processLifetime{
		attach:    func() error { return nil },
		release:   func() { read.Close() },
		detach:    func() { write.Close() },
		terminate: func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) },
		kill:      func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) },
	}, nil
}
