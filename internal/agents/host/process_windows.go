//go:build windows

package host

import (
	"fmt"
	"os/exec"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

func command(argv []string) (*exec.Cmd, *processLifetime, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("create agent job: %w", err)
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		windows.CloseHandle(job)
		return nil, nil, fmt.Errorf("configure agent job: %w", err)
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	var mu sync.Mutex
	return cmd, &processLifetime{
		attach: func() error {
			process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
			if err != nil {
				return fmt.Errorf("open agent process for job: %w", err)
			}
			defer windows.CloseHandle(process)
			if err := windows.AssignProcessToJobObject(job, process); err != nil {
				return fmt.Errorf("assign agent process to job: %w", err)
			}
			return nil
		},
		release: func() {},
		detach: func() {
			mu.Lock()
			defer mu.Unlock()
			if job != 0 {
				windows.CloseHandle(job)
				job = 0
			}
		},
		terminate: func() {
			mu.Lock()
			defer mu.Unlock()
			if job != 0 {
				windows.TerminateJobObject(job, 1)
			}
		},
		kill: func() {
			mu.Lock()
			defer mu.Unlock()
			if job != 0 {
				windows.TerminateJobObject(job, 1)
			}
		},
	}, nil
}
