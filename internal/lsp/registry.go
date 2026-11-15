package lsp

import (
	"path/filepath"
	"strings"
)

// ---------------------------------------------------------------- servers & manager

// serverDef describes one language server we know how to drive. Nothing here
// is required for faah to work; a server is used only if its binary is found on
// PATH or in one of the folders installers commonly use (binDirs).
type serverDef struct {
	Name        string
	Lang        string // language name, shown when offering to install the server
	Cmd         []string
	Exts        []string          // file extensions this server handles
	langIDs     map[string]string // ext -> LSP languageId, when it differs
	DefaultLang string
	initOptions map[string]any
	Install     []install // ways to get the binary, best first
}

func (d serverDef) languageID(rel string) string {
	ext := strings.ToLower(filepath.Ext(rel))
	if id, ok := d.langIDs[ext]; ok {
		return id
	}
	return d.DefaultLang
}

// registry is ordered: the first entry whose binary exists wins for a given
// extension, so a more capable server listed earlier takes precedence.
var registry = []serverDef{
	{
		Name: "gopls", Lang: "Go", Cmd: []string{"gopls"},
		Exts: []string{".go"}, DefaultLang: "go",
		Install: []install{
			{Cmd: []string{"go", "install", "golang.org/x/tools/gopls@latest"}, Auto: true},
			{OS: "darwin", Cmd: []string{"brew", "install", "gopls"}, Auto: true},
		},
	},
	{
		Name: "rust-analyzer", Lang: "Rust", Cmd: []string{"rust-analyzer"},
		Exts: []string{".rs"}, DefaultLang: "rust",
		Install: []install{
			{Cmd: []string{"rustup", "component", "add", "rust-analyzer"}, Auto: true},
			{OS: "darwin", Cmd: []string{"brew", "install", "rust-analyzer"}, Auto: true},
		},
	},
	{
		Name: "pyright", Lang: "Python", Cmd: []string{"pyright-langserver", "--stdio"},
		Exts: []string{".py", ".pyi"}, DefaultLang: "python",
		Install: []install{
			{Cmd: []string{"npm", "install", "-g", "pyright"}, Auto: true},
			{OS: "darwin", Cmd: []string{"brew", "install", "pyright"}, Auto: true},
		},
	},
	{
		Name: "pylsp", Lang: "Python", Cmd: []string{"pylsp"},
		Exts: []string{".py", ".pyi"}, DefaultLang: "python",
		Install: []install{
			{Cmd: []string{"pipx", "install", "python-lsp-server"}, Auto: true},
			{OS: "darwin", Cmd: []string{"brew", "install", "python-lsp-server"}, Auto: true},
		},
	},
	{
		// Not offered for install: it lints, but answers no call hierarchy.
		Name: "ruff", Lang: "Python", Cmd: []string{"ruff", "server"},
		Exts: []string{".py"}, DefaultLang: "python",
	},
	{
		Name: "typescript", Lang: "TypeScript and JavaScript", Cmd: []string{"typescript-language-server", "--stdio"},
		Exts:        []string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"},
		langIDs:     map[string]string{".ts": "typescript", ".tsx": "typescriptreact", ".jsx": "javascriptreact"},
		DefaultLang: "javascript",
		Install: []install{
			{Cmd: []string{"npm", "install", "-g", "typescript-language-server", "typescript"}, Auto: true},
			{OS: "darwin", Cmd: []string{"brew", "install", "typescript-language-server"}, Auto: true},
		},
	},
	{
		Name: "clangd", Lang: "C and C++", Cmd: []string{"clangd", "--background-index"},
		Exts:        []string{".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".m", ".mm"},
		langIDs:     map[string]string{".c": "c", ".h": "c"},
		DefaultLang: "cpp",
		Install: []install{
			{OS: "darwin", Cmd: []string{"brew", "install", "llvm"}, Auto: true},
			// System package managers want an administrator: shown, not run.
			{OS: "linux", Cmd: []string{"sudo", "apt", "install", "clangd"}},
			{OS: "windows", Cmd: []string{"winget", "install", "LLVM.LLVM"}},
		},
	},
	{
		Name: "zls", Lang: "Zig", Cmd: []string{"zls"},
		Exts: []string{".zig"}, DefaultLang: "zig",
		Install: []install{
			{OS: "darwin", Cmd: []string{"brew", "install", "zls"}, Auto: true},
		},
	},
	{
		Name: "lua", Lang: "Lua", Cmd: []string{"lua-language-server"},
		Exts: []string{".lua"}, DefaultLang: "lua",
		Install: []install{
			{OS: "darwin", Cmd: []string{"brew", "install", "lua-language-server"}, Auto: true},
		},
	},
	{
		Name: "solargraph", Lang: "Ruby", Cmd: []string{"solargraph", "stdio"},
		Exts: []string{".rb"}, DefaultLang: "ruby",
		Install: []install{
			{Cmd: []string{"gem", "install", "solargraph"}, Auto: true},
			{OS: "darwin", Cmd: []string{"brew", "install", "solargraph"}, Auto: true},
		},
	},
	{
		Name: "jdtls", Lang: "Java", Cmd: []string{"jdtls"},
		Exts: []string{".java"}, DefaultLang: "java",
		Install: []install{
			{OS: "darwin", Cmd: []string{"brew", "install", "jdtls"}, Auto: true},
		},
	},
	{
		Name: "omnisharp", Lang: "C#", Cmd: []string{"omnisharp", "-lsp"},
		Exts: []string{".cs"}, DefaultLang: "csharp",
	},
	{
		Name: "texlab", Lang: "LaTeX", Cmd: []string{"texlab"},
		Exts: []string{".tex"}, DefaultLang: "latex",
		Install: []install{
			{OS: "darwin", Cmd: []string{"brew", "install", "texlab"}, Auto: true},
		},
	},
}
