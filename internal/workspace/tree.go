package workspace

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Children lists a directory for the tree. Ignored directories are never walked,
// so their contents are read from disk on demand, all marked ignored: git cannot
// re-include anything beneath an excluded directory either.
func (ix *Index) Children(dir string) ([]Node, bool) {
	ix.mu.RLock()
	c, ok := ix.children[dir]
	under := !ok && ix.underIgnoredLocked(dir)
	var res []Node
	if ok {
		res = make([]Node, len(c))
		copy(res, c)
	}
	ix.mu.RUnlock()
	if ok || !under {
		return res, ok
	}
	return ix.listIgnored(dir)
}

// CompactChildren is Children with compact folders: a folder whose only
// entry the view shows is another folder becomes one row named a/b/c, with
// the deepest folder's path. keep says which entries the view shows.
func (ix *Index) CompactChildren(dir string, keep func(Node) bool) ([]Node, bool) {
	kids, ok := ix.Children(dir)
	if !ok || keep == nil {
		return kids, ok
	}
	for i, k := range kids {
		if !k.Dir || k.Ignored {
			continue
		}
		name := k.Name
		for {
			sub, ok := ix.Children(k.Path)
			if !ok {
				break
			}
			var only Node
			n := 0
			for _, c := range sub {
				if keep(c) {
					only = c
					n++
				}
			}
			if n != 1 || !only.Dir || only.Ignored {
				break
			}
			name += "/" + only.Name
			k = only
		}
		k.Name = name
		kids[i] = k
	}
	return kids, true
}

// underIgnoredLocked reports whether dir sits inside a directory the walk
// listed as ignored. The caller holds ix.mu.
func (ix *Index) underIgnoredLocked(dir string) bool {
	if dir == "" || strings.ContainsRune(dir, '\\') {
		return false
	}
	for _, seg := range strings.Split(dir, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return false // never let a crafted path climb out of the root
		}
	}
	// The nearest ancestor the walk visited decides: its entry for the next
	// segment down must be an ignored directory.
	for p := dir; p != ""; {
		parent := ""
		if i := strings.LastIndexByte(p, '/'); i >= 0 {
			parent = p[:i]
		}
		if kids, ok := ix.children[parent]; ok {
			name := strings.TrimPrefix(p[len(parent):], "/")
			for _, k := range kids {
				if k.Name == name {
					return k.Dir && k.Ignored
				}
			}
			return false
		}
		p = parent
	}
	return false
}

// listIgnored reads the immediate entries of an ignored directory directly from disk on demand,
// marking all child nodes as Ignored. This allows the file tree UI to expand ignored directories
// without needing them to be walked or kept in the search index.
func (ix *Index) listIgnored(dir string) ([]Node, bool) {
	ents, err := os.ReadDir(filepath.Join(ix.root, filepath.FromSlash(dir)))
	if err != nil {
		return nil, false
	}
	kids := make([]Node, 0, len(ents))
	for _, e := range ents {
		if e.Type()&os.ModeSymlink != 0 {
			continue
		}
		kids = append(kids, Node{Name: e.Name(), Path: dir + "/" + e.Name(), Dir: e.IsDir(), Ignored: true})
	}
	sortNodes(kids)
	return kids, true
}

func lessFoldASCII(a, b string) bool {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		ca, cb := a[i], b[i]
		if ca >= 0x80 || cb >= 0x80 {
			return strings.ToLower(a) < strings.ToLower(b)
		}
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return ca < cb
		}
	}
	return len(a) < len(b)
}

// sortNodes orders a listing directories first, then case-insensitively by name.
func sortNodes(kids []Node) {
	sort.Slice(kids, func(i, j int) bool {
		if kids[i].Dir != kids[j].Dir {
			return kids[i].Dir
		}
		return lessFoldASCII(kids[i].Name, kids[j].Name)
	})
}

// injectDeletedNodes ensures that files marked deleted in git status (which do not
// exist on disk and were therefore omitted by the filesystem walk) are added to children
// under their respective parent directories, and that any missing intermediate directory
// nodes are created and marked dirty.
func injectDeletedNodes(children map[string][]Node, gs map[string]string, staged, partial map[string]bool, ys map[string]string, dirtyDirs map[string]bool, yourDirtyDirs map[string]bool) {
	apply := func(p string, st string, isStaged bool, yst string) {
		isPartial := partial[p]
		parts := strings.Split(p, "/")
		for i := 0; i < len(parts)-1; i++ {
			parentDir := ""
			if i > 0 {
				parentDir = strings.Join(parts[:i], "/")
			}
			subDir := strings.Join(parts[:i+1], "/")
			name := parts[i]

			kids := children[parentDir]
			found := false
			for _, k := range kids {
				if k.Name == name && k.Dir {
					found = true
					break
				}
			}
			if !found {
				children[parentDir] = append(children[parentDir], Node{
					Name:      name,
					Path:      subDir,
					Dir:       true,
					Dirty:     dirtyDirs[subDir],
					YourDirty: yourDirtyDirs != nil && yourDirtyDirs[subDir],
				})
				sortNodes(children[parentDir])
			}
			if _, ok := children[subDir]; !ok {
				children[subDir] = []Node{}
			}
		}

		dir := ""
		name := p
		if lastSlash := strings.LastIndexByte(p, '/'); lastSlash >= 0 {
			dir = p[:lastSlash]
			name = p[lastSlash+1:]
		}

		kids := children[dir]
		found := false
		for i := range kids {
			if kids[i].Path == p && !kids[i].Dir {
				kids[i].Status = st
				kids[i].Staged = isStaged
				kids[i].Partial = isPartial
				kids[i].YourStatus = yst
				found = true
				break
			}
		}
		if !found {
			children[dir] = append(children[dir], Node{
				Name:       name,
				Path:       p,
				Dir:        false,
				Status:     st,
				Staged:     isStaged,
				Partial:    isPartial,
				YourStatus: yst,
			})
			sortNodes(children[dir])
		}
	}

	for p, st := range gs {
		yst := ""
		if ys != nil {
			yst = ys[p]
		}
		apply(p, st, staged != nil && staged[p], yst)
	}
	for p, st := range ys {
		if gs == nil || gs[p] == "" {
			apply(p, "", staged != nil && staged[p], st)
		}
	}
}

func cleanupEmptyDirs(children map[string][]Node, root string) {
	changed := true
	for changed {
		changed = false
		for dir, kids := range children {
			if dir == "" || len(kids) > 0 {
				continue
			}
			absDir := filepath.Join(root, filepath.FromSlash(dir))
			if _, err := os.Stat(absDir); err != nil {
				delete(children, dir)
				parent := ""
				if idx := strings.LastIndexByte(dir, '/'); idx >= 0 {
					parent = dir[:idx]
				}
				pkids := children[parent]
				pFiltered := pkids[:0]
				for _, k := range pkids {
					if k.Path != dir {
						pFiltered = append(pFiltered, k)
					}
				}
				children[parent] = pFiltered
				changed = true
				break
			}
		}
	}
}
