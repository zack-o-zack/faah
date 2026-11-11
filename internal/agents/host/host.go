// Package host owns the pipes and lifetime of an agent process.
package host

import (
	"bufio"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"
)

type Process struct {
	Cmd    *exec.Cmd
	Lines  chan []byte
	Exited chan struct{}
	stdin  io.WriteCloser
	mu     sync.Mutex
	tail   []byte
	err    error
	once   sync.Once
}

func Start(argv []string, dir string, env []string, stderr io.Writer) (*Process, error) {
	if len(argv) == 0 {
		return nil, fmt.Errorf("empty agent command")
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Env = env
	group(cmd)
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		return nil, err
	}
	p := &Process{Cmd: cmd, stdin: in, Lines: make(chan []byte, 64), Exited: make(chan struct{})}
	cmd.Stderr = tailWriter{p}
	if stderr != nil {
		cmd.Stderr = io.MultiWriter(tailWriter{p}, stderr)
	}
	if err = cmd.Start(); err != nil {
		in.Close()
		out.Close()
		return nil, err
	}
	go func() {
		scan := bufio.NewScanner(out)
		scan.Buffer(make([]byte, 65536), 16<<20)
		for scan.Scan() {
			line := append([]byte(nil), scan.Bytes()...)
			p.Lines <- line
		}
		scanErr := scan.Err()
		err := cmd.Wait()
		if scanErr != nil {
			err = scanErr
		}
		p.mu.Lock()
		p.err = err
		p.mu.Unlock()
		close(p.Lines)
		close(p.Exited)
	}()
	return p, nil
}
func (p *Process) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.stdin.Write(b)
}
func (p *Process) WriteTail(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.tail = append(p.tail, b...)
	if len(p.tail) > 65536 {
		p.tail = p.tail[len(p.tail)-65536:]
	}
	return len(b), nil
}

type tailWriter struct{ p *Process }

func (w tailWriter) Write(b []byte) (int, error) { return w.p.WriteTail(b) }
func (p *Process) Tail() string                  { p.mu.Lock(); defer p.mu.Unlock(); return string(p.tail) }
func (p *Process) Error() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return fmt.Errorf("agent process exited: %v\n%s", p.err, p.tail)
}
func (p *Process) Close() error {
	p.once.Do(func() {
		terminate(p.Cmd)
		go func() { timer := time.NewTimer(5 * time.Second); defer timer.Stop(); <-timer.C; kill(p.Cmd) }()
	})
	return nil
}
