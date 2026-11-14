package workspace

import (
	"faah/internal/ignore"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// TouchPath incrementally inserts or updates a single relative file or directory
// path in ix.children and ix.files without re-walking the workspace tree.
func (ix *Index) TouchPath(rel string) {
	if !ix.Ready() {
		ix.Build()
		return
	}
	rel = strings.Trim(filepath.ToSlash(rel), "/")
	if rel == "" || strings.Contains(rel, "..") {
		return
	}
	abs := filepath.Join(ix.root, filepath.FromSlash(rel))
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			ix.mu.Lock()
			defer ix.mu.Unlock()
			idx := sort.Search(len(ix.files), func(i int) bool { return ix.files[i].Path >= rel })
			if idx < len(ix.files) && ix.files[idx].Path == rel {
				ix.files = append(ix.files[:idx], ix.files[idx+1:]...)
			}
			parentDir := ""
			if lastSlash := strings.LastIndexByte(rel, '/'); lastSlash >= 0 {
				parentDir = rel[:lastSlash]
			}
			if kids, ok := ix.children[parentDir]; ok {
				filtered := kids[:0]
				for _, k := range kids {
					if k.Path != rel {
						filtered = append(filtered, k)
					}
				}
				ix.children[parentDir] = filtered
			}
			delete(ix.children, rel)
		}
		return
	}

	ig := ignore.New(nil).Child(ignore.ReadGitignore(ix.root, ""))
	parts := strings.Split(rel, "/")
	for i := 0; i < len(parts)-1; i++ {
		if vcsDirs[parts[i]] {
			return
		}
		subDir := strings.Join(parts[:i+1], "/")
		if ig.Match(subDir, true) {
			return
		}
		absSub := filepath.Join(ix.root, filepath.FromSlash(subDir))
		if extra := ignore.ReadGitignore(absSub, subDir); len(extra) > 0 {
			ig = ig.Child(extra)
		}
	}

	isDir := info.IsDir()
	name := parts[len(parts)-1]
	if isDir && vcsDirs[name] {
		return
	}
	ignored := ig.Match(rel, isDir)
	var size int64
	if !isDir {
		size = info.Size()
	}

	ix.mu.Lock()
	defer ix.mu.Unlock()
	if ix.children == nil {
		ix.children = map[string][]Node{}
	}

	for i := 0; i < len(parts)-1; i++ {
		parentDir := ""
		if i > 0 {
			parentDir = strings.Join(parts[:i], "/")
		}
		subDir := strings.Join(parts[:i+1], "/")
		segName := parts[i]
		kids := ix.children[parentDir]
		found := false
		for _, k := range kids {
			if k.Name == segName && k.Dir {
				found = true
				break
			}
		}
		if !found {
			ix.children[parentDir] = append(ix.children[parentDir], Node{
				Name: segName,
				Path: subDir,
				Dir:  true,
			})
			sortNodes(ix.children[parentDir])
		}
		if _, ok := ix.children[subDir]; !ok {
			ix.children[subDir] = []Node{}
		}
	}

	parentDir := ""
	if len(parts) > 1 {
		parentDir = strings.Join(parts[:len(parts)-1], "/")
	}
	kids := ix.children[parentDir]
	foundNode := false
	for i := range kids {
		if kids[i].Path == rel {
			kids[i].Size = size
			kids[i].Dir = isDir
			kids[i].Ignored = ignored
			foundNode = true
			break
		}
	}
	if !foundNode {
		node := Node{
			Name:    name,
			Path:    rel,
			Dir:     isDir,
			Size:    size,
			Ignored: ignored,
		}
		if !isDir && !ignored {
			if ix.gitStatusMap != nil {
				node.Status = ix.gitStatusMap[rel]
			}
			if ix.gitStagedMap != nil {
				node.Staged = ix.gitStagedMap[rel]
			}
			node.Partial = ix.gitPartialMap[rel]
			if ix.gitYourStatusMap != nil {
				node.YourStatus = ix.gitYourStatusMap[rel]
			}
		}
		ix.children[parentDir] = append(ix.children[parentDir], node)
		sortNodes(ix.children[parentDir])
	}
	if isDir && !ignored {
		if _, ok := ix.children[rel]; !ok {
			ix.children[rel] = []Node{}
		}
		return
	}
	if !isDir && !ignored {
		idx := sort.Search(len(ix.files), func(i int) bool { return ix.files[i].Path >= rel })
		entry := FileEntry{
			Path:      rel,
			Name:      name,
			Size:      size,
			Lower:     toLowerIfNeeded(rel),
			NameStart: len(rel) - len(name),
		}
		if idx < len(ix.files) && ix.files[idx].Path == rel {
			ix.files[idx] = entry
		} else {
			ix.files = append(ix.files, FileEntry{})
			copy(ix.files[idx+1:], ix.files[idx:])
			ix.files[idx] = entry
		}
	}
}
