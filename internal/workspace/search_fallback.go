package workspace

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// unindexedTarget reports the file a literal glob names when that file exists
// under root but is not in the index (because .gitignore excludes it). Wildcard
// globs, paths with "." or ".." segments, and anything but a regular file (a
// symlink included) are refused.
func unindexedTarget(root string, files []FileEntry, glob string) (FileEntry, bool) {
	rel := strings.TrimPrefix(glob, "/")
	if rel == "" || strings.ContainsAny(rel, "*?[!\\") || strings.HasSuffix(rel, "/") {
		return FileEntry{}, false
	}
	for _, seg := range strings.Split(rel, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return FileEntry{}, false
		}
	}
	i := sort.Search(len(files), func(i int) bool { return files[i].Path >= rel })
	if i < len(files) && files[i].Path == rel {
		return FileEntry{}, false // indexed: the normal path handles it
	}
	st, err := os.Lstat(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil || !st.Mode().IsRegular() {
		return FileEntry{}, false
	}
	name := rel[strings.LastIndexByte(rel, '/')+1:]
	return FileEntry{
		Path: rel, Name: name, Size: st.Size(),
		Lower: strings.ToLower(rel), NameStart: len(rel) - len(name),
	}, true
}
