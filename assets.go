package main

import (
	"embed"
	"io/fs"
	"os"
)

//go:embed web/index.html web/workbench.html web/dist web/themes web/vendor
//go:embed web/favicon.svg
var embedded embed.FS

// devRoot is a source checkout whose web/ replaces the embedded assets, so
// `npm run dev:desktop` can reload the UI without recompiling.
var devRoot = os.Getenv("FAAH_DEV_ROOT")

// assets is the web/ directory the UI is served from.
var assets = func() fs.FS {
	if devRoot != "" {
		return os.DirFS(devRoot)
	}
	return embedded
}()
