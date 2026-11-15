package review

import (
	"path"
	"strings"
)

// Rules are evaluated in precedence order. Globs apply to the base name;
// segments match entire directory names, never substrings.
var fileGroupRules = []struct {
	group    string
	names    string
	segments string
}{
	{"generated", "package-lock.json yarn.lock pnpm-lock.yaml bun.lock bun.lockb go.sum Cargo.lock poetry.lock uv.lock Gemfile.lock composer.lock *.min.js *.min.css *.map *.snap *.pb.go *_generated.go *.gen.go", "dist build vendor node_modules __snapshots__"},
	{"tests", "*_test.go *.test.* *.spec.* test_*.py *_test.py *_test.rb *_spec.rb *Test.java *Tests.java *Test.kt *Tests.swift", "test tests __tests__ spec testdata fixtures e2e __mocks__"},
	{"docs", "*.md *.mdx *.rst *.adoc *.txt LICENSE* CHANGELOG* README* CONTRIBUTING* NOTICE*", "docs doc"},
	{"config", "*.json *.yaml *.yml *.toml *.ini *.cfg .env* go.mod Dockerfile* Makefile *.mk *.config.* .*", ".github .gitlab .circleci"},
}

func fileGroup(file string) string {
	base := strings.ToLower(path.Base(file))
	dirs := strings.Split(strings.ToLower(path.Dir(file)), "/")
	for _, rule := range fileGroupRules {
		for _, pattern := range strings.Fields(rule.names) {
			if match, _ := path.Match(strings.ToLower(pattern), base); match {
				return rule.group
			}
		}
		for _, segment := range strings.Fields(rule.segments) {
			for _, dir := range dirs {
				if dir == segment {
					return rule.group
				}
			}
		}
	}
	return "core"
}

func groupRank(group string) int {
	switch group {
	case "core":
		return 0
	case "tests":
		return 1
	case "config":
		return 2
	case "docs":
		return 3
	default:
		return 4
	}
}
