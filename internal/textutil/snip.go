package textutil

import (
	"bytes"
	"strings"
	"unicode/utf8"
)

// Snip turns one raw line plus a byte range into a display-ready match,
// dropping indentation and keeping the match itself in view.
func Snip(line []byte, from, to int) Match {
	if from < 0 {
		from = 0
	}
	if from > len(line) {
		from = len(line)
	}
	if to < from {
		to = from
	}
	if to > len(line) {
		to = len(line)
	}
	preBytes := bytes.TrimLeft(line[:from], " \t")
	midBytes := line[from:to]
	postBytes := bytes.TrimRight(line[to:], " \t")

	// Fast path: since utf8.RuneCount <= byte length, if byte lengths fit within
	// snipLead and snipMax, no rune counting or []rune slicing is needed.
	if len(preBytes) <= snipLead && len(preBytes)+len(midBytes)+len(postBytes) <= snipMax {
		return Match{
			Pre:  string(preBytes),
			Mid:  string(midBytes),
			Post: string(postBytes),
		}
	}

	pre, mid, post := string(preBytes), string(midBytes), string(postBytes)
	preRunes := len(pre)
	if preRunes > snipLead {
		preRunes = utf8.RuneCountInString(pre)
		if preRunes > snipLead {
			r := []rune(pre)
			pre = "…" + string(r[preRunes-snipKeep:])
			preRunes = 1 + snipKeep
		}
	}
	midRunes := len(mid)
	if midRunes > snipMax {
		midRunes = utf8.RuneCountInString(mid)
		if midRunes > snipMax {
			mid = string([]rune(mid)[:snipMax]) + "…"
			midRunes = snipMax + 1
		}
	} else if len(preBytes)+len(midBytes)+len(postBytes) > snipMax {
		midRunes = utf8.RuneCountInString(mid)
	}
	if budget := snipMax - preRunes - midRunes; budget > 0 {
		if len(post) > budget && utf8.RuneCountInString(post) > budget {
			post = string([]rune(post)[:budget]) + "…"
		}
	} else {
		post = ""
	}
	return Match{Pre: pre, Mid: mid, Post: strings.TrimRight(post, " \t")}
}

// Match carries the hit already split into the text before it, the matched
// text, and the text after. Sending offsets instead would force the client to
// reconcile Go byte indexes with UTF-16 string indexes, and would not survive
// the snipping we do to keep long lines readable in a narrow panel.
type Match struct {
	Line int    `json:"line"` // 1-based
	Pre  string `json:"pre"`
	Mid  string `json:"mid"`
	Post string `json:"post"`
	Def  bool   `json:"def,omitempty"` // line looks like a declaration
}

const (
	snipLead = 32  // start eliding once the match sits this far into the line
	snipKeep = 16  // runes of lead-in kept when we do elide
	snipMax  = 240 // cap on the whole snippet
)
