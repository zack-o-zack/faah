package notes

import (
	"encoding/json"
	"strings"

	"faah/internal/agents"
)

const openTag = "<faah:"

var tagNames = []string{"annotate", "walkthrough"}

// Tagged is a sink for a harness that writes its tool calls as tagged blocks
// in its reply, each starting a line. Text outside the blocks passes on as it
// arrives; text that may start a block is held until the block closes or turns
// out not to be one. A tag inside a line, such as one quoted in prose, is text.
type Tagged struct {
	sink     agents.Sink
	call     func(name string, args json.RawMessage)
	held     string
	bol      bool // the text passed on so far ends at the start of a line
	streamed bool // text arrived, so the final answer repeats it
}

func NewTagged(sink agents.Sink, call func(name string, args json.RawMessage)) *Tagged {
	return &Tagged{sink: sink, call: call, bol: true}
}

func (t *Tagged) Text(s string, block bool) {
	t.streamed = true
	out := t.take(t.held + s)
	if out != "" {
		t.sink.Text(out, block)
	}
}

func (t *Tagged) Step(label string) { t.sink.Step(label) }

// Result is a whole final answer, so a block in it is complete or not at all.
// After streamed text it repeats what was streamed, and is ignored.
func (t *Tagged) Result(s string) {
	if t.streamed {
		return
	}
	out := t.take(s)
	t.sink.Result(out + t.held)
	t.held = ""
}

// Flush passes on text held for a block that never closed.
func (t *Tagged) Flush() {
	if t.held != "" {
		t.sink.Text(t.held, false)
		t.held = ""
	}
}

// take returns the text that can be passed on now, makes the calls for
// complete blocks, and keeps the rest in t.held.
func (t *Tagged) take(s string) string {
	var out strings.Builder
	emit := func(text string) {
		out.WriteString(text)
		if text == "" {
			return
		}
		rest := text
		nl := strings.LastIndexByte(text, '\n')
		if nl >= 0 {
			rest = text[nl+1:]
		}
		t.bol = (nl >= 0 || t.bol) && strings.TrimLeft(rest, " \t") == ""
	}
	t.held = ""
	for s != "" {
		i := strings.Index(s, openTag)
		if i < 0 {
			keep := partialOpen(s)
			emit(s[:len(s)-keep])
			t.held = s[len(s)-keep:]
			break
		}
		emit(s[:i])
		s = s[i:]
		name, ok := blockName(s)
		if !ok && t.bol && len(s) < len(openTag)+len("walkthrough>") && couldBeBlock(s) {
			t.held = s // too short to tell yet
			break
		}
		if !ok || !t.bol {
			emit(openTag)
			s = s[len(openTag):]
			continue
		}
		start := len(openTag) + len(name) + 1
		end := strings.Index(s[start:], "</faah:"+name+">")
		if end < 0 {
			t.held = s // wait for the close
			break
		}
		t.call(name, json.RawMessage(strings.TrimSpace(s[start:start+end])))
		s = s[start+end+len("</faah:"+name+">"):]
		t.bol = true // the block was a line of its own
	}
	return out.String()
}
func blockName(s string) (string, bool) {
	for _, n := range tagNames {
		if strings.HasPrefix(s, openTag+n+">") {
			return n, true
		}
	}
	return "", false
}

// couldBeBlock reports whether s, which starts with openTag, is the start of
// one of the known tags.
func couldBeBlock(s string) bool {
	for _, n := range tagNames {
		full := openTag + n + ">"
		if strings.HasPrefix(full, s) {
			return true
		}
	}
	return false
}

// partialOpen is how many bytes at the end of s could begin openTag.
func partialOpen(s string) int {
	for k := len(openTag) - 1; k > 0; k-- {
		if strings.HasSuffix(s, openTag[:k]) {
			return k
		}
	}
	return 0
}

func (s *Tagged) Reasoning(text string) { s.sink.Reasoning(text) }
