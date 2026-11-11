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
	for _, chunk := range []string{"Here.\n<fa", "ah:annotate>{\"notes\":[]}</faah:ann", "otate>\nAnd <faah:walkthrough>{\"title\":\"x\"}</faah:walkthrough> done. a < b <faah:other>x</faah:other>"} {
		tg.Text(chunk, false)
	}
	tg.Flush()
	if got := sink.text.String(); got != "Here.\n\nAnd  done. a < b <faah:other>x</faah:other>" {
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
