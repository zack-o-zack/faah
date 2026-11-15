package git

import (
	"os/exec"
	"strings"
)

// ReviewBranch is a locally available comparison target.
type ReviewBranch struct {
	Name   string `json:"name"`
	Remote bool   `json:"remote"`
}

type ReviewBases struct {
	Current       string         `json:"current,omitempty"`
	DefaultRemote string         `json:"defaultRemote,omitempty"`
	Upstream      string         `json:"upstream,omitempty"`
	Branches      []ReviewBranch `json:"branches"`
}

// HasBranch reports whether name exactly matches a locally available branch.
func (bases ReviewBases) HasBranch(name string) bool {
	for _, branch := range bases.Branches {
		if branch.Name == name {
			return true
		}
	}
	return false
}

// ListReviewBases reads only local refs, in exactly one Git subprocess.
func ListReviewBases(root string) ReviewBases {
	empty := ReviewBases{Branches: []ReviewBranch{}}
	if Disabled() {
		return empty
	}
	out, err := exec.Command("git", "-C", root, "for-each-ref", "--sort=refname", "--format=%(refname)%00%(upstream:short)%00%(HEAD)%00%(symref)", "refs/heads", "refs/remotes").Output()
	if err != nil {
		return empty
	}
	return parseReviewBases(string(out))
}

func parseReviewBases(out string) ReviewBases {
	result := ReviewBases{Branches: []ReviewBranch{}}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(line, "\x00")
		if len(fields) != 4 {
			continue
		}
		ref, upstream, head, symref := fields[0], fields[1], fields[2], fields[3]
		remote := strings.HasPrefix(ref, "refs/remotes/")
		name := strings.TrimPrefix(strings.TrimPrefix(ref, "refs/heads/"), "refs/remotes/")
		if remote && strings.HasSuffix(name, "/HEAD") {
			if symref != "" && (result.DefaultRemote == "" || name == "origin/HEAD") {
				result.DefaultRemote = strings.TrimPrefix(symref, "refs/remotes/")
			}
			continue
		}
		result.Branches = append(result.Branches, ReviewBranch{Name: name, Remote: remote})
		if !remote && head == "*" {
			result.Current, result.Upstream = name, upstream
		}
	}
	if result.DefaultRemote == "" {
		for _, candidate := range []string{"origin/main", "origin/master"} {
			for _, branch := range result.Branches {
				if branch.Remote && branch.Name == candidate {
					result.DefaultRemote = candidate
					return result
				}
			}
		}
	}
	return result
}
