package workspace

import (
	"faah/internal/git"
	"faah/internal/ignore"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

func toLowerIfNeeded(s string) string {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || c >= 0x80 {
			return strings.ToLower(s)
		}
	}
	return s
}

// Build walks the tree once, honouring .gitignore at every level, and
// materialises both the flat file list (for fuzzy find and search) and the
// directory map (for the tree view). Root entries are published immediately so
// the frontend can display the file tree without waiting for the full repo scan.
func (ix *Index) Build() {
	start := time.Now()
	root := ignore.New(nil)
	root = root.Child(ignore.ReadGitignore(ix.root, ""))

	// Run git status concurrently with the directory walk so the 80-300ms git
	// subprocess overlaps the filesystem scan, and root directory entries are
	// published in under a millisecond on cold startup. Once both the walk and
	// git status complete, statuses are overlaid across all nodes before readyCh
	// closes.
	base := ix.diffBaseRef()
	head := ix.prHeadRef()
	type gitRes struct {
		gs           map[string]string
		staged       map[string]bool
		partial      map[string]bool
		yourStatuses map[string]string
		dirtyDirs    map[string]bool
		yourDirty    map[string]bool
		gitFiles     []string
	}
	gsCh := make(chan gitRes, 1)
	go func() {
		gs, staged, partial, yourStatuses := git.StatusAndStagedAgainst(ix.root, base, head)
		dirtyDirs, yourDirtyDirs, gitFiles := computeDirtyState(gs, yourStatuses)
		gsCh <- gitRes{
			gs:           gs,
			staged:       staged,
			partial:      partial,
			yourStatuses: yourStatuses,
			dirtyDirs:    dirtyDirs,
			yourDirty:    yourDirtyDirs,
			gitFiles:     gitFiles,
		}
	}()

	var (
		mu       sync.Mutex
		files    []FileEntry
		children = map[string][]Node{}
		wg       sync.WaitGroup
		sem      = make(chan struct{}, runtime.NumCPU()*4)
	)

	var walk func(abs, rel string, ig *ignore.IgnoreSet)
	walk = func(abs, rel string, ig *ignore.IgnoreSet) {
		defer wg.Done()
		ents, err := os.ReadDir(abs)
		if err != nil {
			return
		}
		if rel != "" {
			if extra := ignore.ReadGitignore(abs, rel); len(extra) > 0 {
				ig = ig.Child(extra)
			}
		}
		kids := make([]Node, 0, len(ents))
		localFiles := make([]FileEntry, 0, len(ents))
		var subdirs []struct {
			abs, rel string
		}
		for _, e := range ents {
			name := e.Name()
			childRel := name
			if rel != "" {
				childRel = rel + "/" + name
			}
			isDir := e.IsDir()
			// Follow nothing through symlinks; cycles are not worth the risk.
			if e.Type()&os.ModeSymlink != 0 {
				continue
			}
			if ig.Match(childRel, isDir) {
				// Listed so the tree can show it dimmed, but never walked or
				// indexed, so search and quick open stay out of it.
				if !(isDir && vcsDirs[name]) {
					kids = append(kids, Node{Name: name, Path: childRel, Dir: isDir, Ignored: true})
				}
				continue
			}
			if isDir {
				kids = append(kids, Node{Name: name, Path: childRel, Dir: true})
				subdirs = append(subdirs, struct{ abs, rel string }{filepath.Join(abs, name), childRel})
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			kids = append(kids, Node{Name: name, Path: childRel, Size: info.Size()})
			localFiles = append(localFiles, FileEntry{
				Path: childRel, Name: name, Size: info.Size(),
				Lower: toLowerIfNeeded(childRel), NameStart: len(childRel) - len(name),
			})
		}
		sortNodes(kids)
		mu.Lock()
		children[rel] = kids
		files = append(files, localFiles...)
		mu.Unlock()

		// If this is the root directory, make it available to ix.Children("")
		// immediately so the browser UI can render the sidebar tree without delay.
		if rel == "" {
			ix.mu.Lock()
			if ix.children == nil {
				ix.children = map[string][]Node{}
			}
			rootKids := make([]Node, len(kids))
			copy(rootKids, kids)
			ix.children[""] = rootKids
			ix.mu.Unlock()
		}

		for _, sd := range subdirs {
			wg.Add(1)
			select {
			case sem <- struct{}{}:
				go func(a, r string, g *ignore.IgnoreSet) {
					defer func() { <-sem }()
					walk(a, r, g)
				}(sd.abs, sd.rel, ig)
			default:
				walk(sd.abs, sd.rel, ig) // pool saturated: recurse inline
			}
		}
	}

	wg.Add(1)
	walk(ix.root, "", root)
	wg.Wait()

	gr := <-gsCh
	gs, staged, partial, yourStatuses := gr.gs, gr.staged, gr.partial, gr.yourStatuses
	dirtyDirs, yourDirtyDirs, gitFiles := gr.dirtyDirs, gr.yourDirty, gr.gitFiles

	if len(gs) > 0 || len(staged) > 0 || len(yourStatuses) > 0 {
		for dir, kids := range children {
			for i := range kids {
				if kids[i].Ignored {
					continue
				}
				p := kids[i].Path
				if kids[i].Dir {
					kids[i].Dirty = dirtyDirs[p]
					kids[i].YourDirty = yourDirtyDirs[p]
				} else {
					kids[i].Status = gs[p]
					kids[i].Staged = staged[p]
					kids[i].Partial = partial[p]
					if yourStatuses != nil {
						kids[i].YourStatus = yourStatuses[p]
					}
				}
			}
			children[dir] = kids
		}
	}

	injectDeletedNodes(children, gs, staged, partial, yourStatuses, dirtyDirs, yourDirtyDirs)

	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })

	ix.mu.Lock()
	ix.gitChanges = len(gitFiles)
	ix.gitFiles = gitFiles
	ix.gitStatusMap = gs
	ix.gitStagedMap = staged
	ix.gitPartialMap = partial
	ix.gitYourStatusMap = yourStatuses
	ix.files, ix.children = files, children
	ix.builtAt, ix.buildMS = time.Now(), time.Since(start).Milliseconds()
	select {
	case <-ix.readyCh:
	default:
		close(ix.readyCh)
	}
	ix.mu.Unlock()
}
