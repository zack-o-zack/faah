package agents

import (
	"strings"
	"testing"
)

type recSink struct{ log []string }

func (r *recSink) Text(s string, block bool) {
	if block {
		r.log = append(r.log, "block:"+s)
	} else {
		r.log = append(r.log, "text:"+s)
	}
}
func (r *recSink) Step(s string)   { r.log = append(r.log, "step:"+s) }
func (r *recSink) Result(s string) { r.log = append(r.log, "result:"+s) }

func TestStreamSplitsLinesAndReportsSession(t *testing.T) {
	parse := func(l string) []Event {
		switch l {
		case "S":
			return []Event{{Kind: EventSession, Text: "id1"}}
		case "T":
			return []Event{{Kind: EventTool, Text: "Read a.go"}}
		case "R":
			return []Event{{Kind: EventResult, Text: "done"}}
		}
		return []Event{{Kind: EventText, Text: l, Block: true}}
	}
	sink := &recSink{}
	st := NewStream(parse, sink)
	st.Write([]byte("S\nhel"))
	st.Write([]byte("lo\r\nT\nR\ntail"))
	out, err := st.Close()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(sink.log, " "); got != "block:hello step:Read a.go result:done block:tail" {
		t.Fatalf("log = %q", got)
	}
	if !out.Live || out.SessionID != "id1" {
		t.Fatalf("outcome = %+v", out)
	}
}

func TestStreamFailureBecomesError(t *testing.T) {
	st := NewStream(func(string) []Event { return []Event{{Kind: EventError, Text: "bad key"}} }, &recSink{})
	st.Write([]byte("x\n"))
	if _, err := st.Close(); err == nil || err.Error() != "bad key" {
		t.Fatalf("err = %v", err)
	}
}

func TestPlainTextKeepsLines(t *testing.T) {
	sink := &recSink{}
	st := NewStream(PlainText, sink)
	st.Write([]byte("a\nb"))
	out, _ := st.Close()
	if got := strings.Join(sink.log, "|"); got != "text:a\n|text:b\n" {
		t.Fatalf("log = %q", got)
	}
	if out.Live {
		t.Fatal("plain text never starts a session")
	}
}
