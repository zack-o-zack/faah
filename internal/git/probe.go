package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

// disabled turns off all git awareness (the -no-git flag). Like uiQuiet, a
// process-wide switch set once in main before anything reads it.
var disabled bool

type Info struct {
	ok       bool
	toplevel string // repo root as git reports it (symlinks resolved)
	gitdir   string // absolute path to .git directory or file
}

var (
	mu    sync.Mutex
	cache = map[string]Info{}
)

// Available reports whether the git binary is on PATH and root sits inside a
// working tree. Memoized per root: detection shells out once. Fails quiet -- no
// git, no repo, or -no-git all yield false, never an error.
func Available(root string) bool { return Probe(root).ok }

// Dir returns the absolute path to the repository's .git directory.
func Dir(root string) string { return Probe(root).gitdir }

func Probe(root string) Info {
	if disabled {
		return Info{}
	}
	mu.Lock()
	defer mu.Unlock()
	if info, ok := cache[root]; ok {
		if info.ok && info.gitdir != "" {
			if _, err := os.Lstat(info.gitdir); err == nil {
				return info
			}
		}
		delete(cache, root)
	}
	var info Info
	if _, err := exec.LookPath("git"); err == nil {
		out, err := exec.Command("git", "-C", root, "rev-parse", "--show-toplevel").Output()
		safeDir := false
		if err != nil {
			if out2, err2 := exec.Command("git", "-c", "safe.directory=*", "-C", root, "rev-parse", "--show-toplevel").Output(); err2 == nil {
				out, err = out2, nil
				safeDir = true
			}
		}
		if err == nil {
			top := strings.TrimSpace(string(out))
			gd := filepath.Join(top, ".git")
			var gdCmd *exec.Cmd
			if safeDir {
				gdCmd = exec.Command("git", "-c", "safe.directory=*", "-C", root, "rev-parse", "--git-dir")
			} else {
				gdCmd = exec.Command("git", "-C", root, "rev-parse", "--git-dir")
			}
			if gdOut, err := gdCmd.Output(); err == nil {
				rawGd := strings.TrimSpace(string(gdOut))
				if filepath.IsAbs(rawGd) {
					gd = rawGd
				} else {
					gd = filepath.Join(top, rawGd)
				}
			}
			info = Info{ok: true, toplevel: top, gitdir: gd}
			cache[root] = info
		}
	}
	return info
}

func SetDisabled(value bool)   { disabled = value }
func Disabled() bool           { return disabled }
func (info Info) OK() bool     { return info.ok }
func (info Info) Root() string { return info.toplevel }
func (info Info) Dir() string  { return info.gitdir }
