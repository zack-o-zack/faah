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

// Process owns an agent and its input and output pipes.
type Process struct {
	Cmd     *exec.Cmd
	Lines   chan []byte
	Exited  chan struct{}
	stdin   io.WriteCloser
	mu      sync.Mutex
	writeMu sync.Mutex
	tail    []byte
	err     error
	once    sync.Once
	stop    chan struct{}
}

// Start launches an agent with supervised process lifetime.
func Start(argv []string, dir string, env []string, stderr io.Writer) (*Process, error) {
	if len(argv) == 0 {
		return nil, fmt.Errorf("empty agent command")
	}
	cmd, release, detach, err := command(argv)
	if err != nil {
		return nil, err
	}
	defer release()
	started := false
	defer func() {
		if !started {
			detach()
		}
	}()
	cmd.Dir = dir
	cmd.Env = env
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		return nil, err
	}
	p := &Process{Cmd: cmd, stdin: in, Lines: make(chan []byte, 64), Exited: make(chan struct{}), stop: make(chan struct{})}
	cmd.Stderr = tailWriter{p}
	if stderr != nil {
		cmd.Stderr = io.MultiWriter(tailWriter{p}, stderr)
	}
	if err = cmd.Start(); err != nil {
		in.Close()
		out.Close()
		return nil, err
	}
	started = true
	go func() {
		defer detach()
		scan := bufio.NewScanner(out)
		scan.Buffer(make([]byte, 65536), 16<<20)
		for scan.Scan() {
			line := append([]byte(nil), scan.Bytes()...)
			select {
			case p.Lines <- line:
			case <-p.stop:
			}
		}
		scanErr := scan.Err()
		if scanErr != nil {
			p.Close()
		}
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

// Write serializes a frame to stdin.
func (p *Process) Write(b []byte) (int, error) {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return p.stdin.Write(b)
}

// WriteTail retains bounded diagnostic output.
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

// Write serializes a frame to stdin.
func (w tailWriter) Write(b []byte) (int, error) { return w.p.WriteTail(b) }

// Tail returns the recent stderr output.
func (p *Process) Tail() string { p.mu.Lock(); defer p.mu.Unlock(); return string(p.tail) }

// Error describes an exited process with its diagnostics.
func (p *Process) Error() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err == nil {
		return fmt.Errorf("agent process exited\n%s", p.tail)
	}
	return fmt.Errorf("agent process exited: %v\n%s", p.err, p.tail)
}

// Close releases the session and stops its process.
func (p *Process) Close() error {
	p.once.Do(func() {
		close(p.stop)
		select {
		case <-p.Exited:
			return
		default:
		}
		terminate(p.Cmd)
		go func() {
			timer := time.NewTimer(5 * time.Second)
			defer timer.Stop()
			select {
			case <-p.Exited:
				return
			case <-timer.C:
			}
			select {
			case <-p.Exited:
				return
			default:
				kill(p.Cmd)
			}
		}()
	})
	return nil
}
