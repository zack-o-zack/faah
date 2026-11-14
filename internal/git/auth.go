package git

import (
	"os"
	"os/exec"
	"strings"
)

// Auth is how plain git authenticates to a forge over https: one extra
// header, scoped to the forge's URL prefix and passed in the environment
// (AuthCmd), so the token never appears in argv, remote config or URLs.
// The zero value is no auth.
type Auth struct {
	Prefix string // URL prefix the header applies to, e.g. "https://gitlab.com/"
	Header string // e.g. "Authorization: Basic ..."
	Token  string // the raw token, only to redact it from git's error text
}

// AuthCmd builds a git command that authenticates to the forge over
// https with its token -- what a token-in-the-URL does, minus the token in the
// URL (and so in argv, in git's remote config, and in error text). The header
// travels in the environment, scoped to the forge's URL prefix, and terminal
// prompts are off so a bad or missing token fails fast instead of hanging on a
// password prompt. With no auth it is plain git.
func AuthCmd(auth Auth, args ...string) *exec.Cmd {
	cmd := exec.Command("git", args...)
	env := append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if auth.Header != "" {
		env = append(env,
			"GIT_CONFIG_COUNT=1",
			"GIT_CONFIG_KEY_0=http."+auth.Prefix+".extraheader",
			"GIT_CONFIG_VALUE_0="+auth.Header,
		)
	}
	cmd.Env = env
	return cmd
}

// LocalThenToken runs git as the local clone is set up to, and only if
// that fails and there is a token, again with the token: a clone's own
// credentials may well reach more than the token does.
func LocalThenToken(auth Auth, args ...string) ([]byte, error) {
	out, err := AuthCmd(Auth{}, args...).CombinedOutput()
	if err != nil && auth.Header != "" {
		out, err = AuthCmd(auth, args...).CombinedOutput()
	}
	return out, err
}

func RedactToken(s, token string) string {
	if token == "" {
		return s
	}
	return strings.ReplaceAll(s, token, "***")
}

// Redact strips the token from text git printed.
func (a Auth) Redact(s string) string { return RedactToken(s, a.Token) }
