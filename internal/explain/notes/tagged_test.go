package notes

import (
	"encoding/json"
	"strings"
	"testing"
)

type textSink struct{ text, result strings.Builder }

func (s *textSink) Text(t string, _ bool) { s.text.WriteString(t) }
func (s *textSink) Step(string)           {}
func (s *textSink) Result(t string)       { s.result.WriteString(t) }

func TestTaggedPullsBlocksOutOfText(t *testing.T) {
	sink := &textSink{}
	var calls []string
	tg := NewTagged(sink, func(name string, args json.RawMessage) { calls = append(calls, name+" "+string(args)) })
	for _, chunk := range []string{"Here.\n<fa", "ah:annotate>{\"notes\":[]}</faah:ann", "otate>\nAnd\n  <faah:walkthrough>{\"title\":\"x\"}</faah:walkthrough>\ndone. a < b <faah:other>x</faah:other>"} {
		tg.Text(chunk, false)
	}
	tg.Flush()
	if got := sink.text.String(); got != "Here.\n\nAnd\n  \ndone. a < b <faah:other>x</faah:other>" {
		t.Fatalf("text = %q", got)
	}
	if strings.Join(calls, "|") != `annotate {"notes":[]}|walkthrough {"title":"x"}` {
		t.Fatalf("calls = %v", calls)
	}
}

func TestTaggedFlushKeepsAnUnclosedBlock(t *testing.T) {
	sink := &textSink{}
	tg := NewTagged(sink, func(string, json.RawMessage) { t.Fatal("no call expected") })
	tg.Text("start <faah:annotate>{\"notes\"", false)
	tg.Flush()
	if got := sink.text.String(); got != "start <faah:annotate>{\"notes\"" {
		t.Fatalf("text = %q", got)
	}
}

func TestTaggedResult(t *testing.T) {
	sink := &textSink{}
	var n int
	tg := NewTagged(sink, func(string, json.RawMessage) { n++ })
	tg.Result("Done.\n<faah:annotate>{\"notes\":[]}</faah:annotate>")
	if n != 1 || strings.TrimSpace(sink.result.String()) != "Done." {
		t.Fatalf("result = %q, calls %d", sink.result.String(), n)
	}
}

// agy streams its reply and then sends it again as the result.
func TestTaggedIgnoresResultAfterText(t *testing.T) {
	sink := &textSink{}
	var n int
	tg := NewTagged(sink, func(string, json.RawMessage) { n++ })
	reply := "Done.\n<faah:annotate>{\"notes\":[]}</faah:annotate>"
	tg.Text(reply, false)
	tg.Result(reply)
	tg.Flush()
	if n != 1 || sink.result.Len() != 0 || strings.TrimSpace(sink.text.String()) != "Done." {
		t.Fatalf("calls %d, text %q, result %q", n, sink.text.String(), sink.result.String())
	}
}

// A tag inside a line is quoted, not called, even when split across chunks.
func TestTaggedLeavesInlineTags(t *testing.T) {
	sink := &textSink{}
	tg := NewTagged(sink, func(name string, _ json.RawMessage) { t.Fatalf("called %s", name) })
	text := "Write `<faah:annotate>{\"notes\":[]}</faah:annotate>` on its own line."
	for _, c := range []string{text[:9], text[9:14], text[14:]} {
		tg.Text(c, false)
	}
	tg.Flush()
	if got := sink.text.String(); got != text {
		t.Fatalf("text = %q", got)
	}
}

// A block still open when the final answer arrives is passed on as text.
func TestTaggedUnclosedBlockThenResult(t *testing.T) {
	sink := &textSink{}
	tg := NewTagged(sink, func(string, json.RawMessage) { t.Fatal("no call expected") })
	tg.Text("Done.\n<faah:annotate>{\"notes\"", false)
	tg.Result("Done.\n<faah:annotate>{\"notes\"")
	tg.Flush()
	if got := sink.text.String(); got != "Done.\n<faah:annotate>{\"notes\"" || sink.result.Len() != 0 {
		t.Fatalf("text %q, result %q", got, sink.result.String())
	}
}
