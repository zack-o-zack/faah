//go:build windows

package host

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsLifetimeHelper(t *testing.T) {
	role := os.Getenv("FAAH_WINDOWS_LIFETIME")
	if role == "" {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if role == "leaf" {
		time.Sleep(time.Minute)
		return
	}
	if role == "child" {
		child := exec.Command(exe, "-test.run=^TestWindowsLifetimeHelper$")
		child.Env = append(os.Environ(), "FAAH_WINDOWS_LIFETIME=leaf")
		if err := child.Start(); err != nil {
			t.Fatal(err)
		}
		fmt.Printf("%d %d\n", os.Getpid(), child.Process.Pid)
		child.Wait()
		return
	}
	process, err := Start([]string{exe, "-test.run=^TestWindowsLifetimeHelper$"}, t.TempDir(), append(os.Environ(), "FAAH_WINDOWS_LIFETIME=child"), os.Stderr)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Println(string(<-process.Lines))
	bufio.NewReader(os.Stdin).ReadString('\n')
	os.Exit(0)
}

func TestWindowsProcessTreeLifetime(t *testing.T) {
	for _, parentExit := range []bool{false, true} {
		t.Run(strconv.FormatBool(parentExit), func(t *testing.T) {
			exe, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			var line string
			var stop func()
			if parentExit {
				owner := exec.Command(exe, "-test.run=^TestWindowsLifetimeHelper$")
				owner.Env = append(os.Environ(), "FAAH_WINDOWS_LIFETIME=owner")
				output, err := owner.StdoutPipe()
				if err != nil {
					t.Fatal(err)
				}
				input, err := owner.StdinPipe()
				if err != nil {
					t.Fatal(err)
				}
				if err := owner.Start(); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { owner.Process.Kill(); owner.Wait() })
				line, err = bufio.NewReader(output).ReadString('\n')
				if err != nil {
					t.Fatal(err)
				}
				stop = func() { fmt.Fprintln(input); input.Close() }
			} else {
				process, err := Start([]string{exe, "-test.run=^TestWindowsLifetimeHelper$"}, t.TempDir(), append(os.Environ(), "FAAH_WINDOWS_LIFETIME=child"), nil)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { process.Close() })
				select {
				case output := <-process.Lines:
					line = string(output)
				case <-time.After(5 * time.Second):
					t.Fatal("child did not start")
				}
				stop = func() { process.Close() }
			}
			var handles []windows.Handle
			if len(strings.Fields(line)) != 2 {
				t.Fatalf("invalid process ids: %q", line)
			}
			for _, field := range strings.Fields(line) {
				pid, err := strconv.Atoi(field)
				if err != nil {
					t.Fatal(err)
				}
				handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_TERMINATE, false, uint32(pid))
				if err != nil {
					t.Fatal(err)
				}
				defer windows.CloseHandle(handle)
				defer windows.TerminateProcess(handle, 1)
				handles = append(handles, handle)
			}
			stop()
			for _, handle := range handles {
				status, err := windows.WaitForSingleObject(handle, 5000)
				if err != nil || status != windows.WAIT_OBJECT_0 {
					t.Fatalf("process survived: status=%d err=%v", status, err)
				}
			}
		})
	}
}
