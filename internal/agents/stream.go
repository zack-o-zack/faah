package agents

import (
	"bytes"
	"errors"
)

// Event kinds a parser reports.
const (
	EventSession = "session" // the harness started a session; Text is its id when it names one
	EventText    = "text"
	EventTool    = "tool"
	EventResult  = "result"
	EventError   = "error" // the harness's own error result
)

// Event is one thing a harness's output line means.
type Event struct {
	Kind  string
	Text  string
	Block bool
}

// PlainText is the parser for harnesses whose output is the answer itself.
func PlainText(line string) []Event {
	return []Event{{Kind: EventText, Text: line + "\n"}}
}

// Stream turns harness output into sink calls, one line at a time.
type Stream struct {
	parse   func(string) []Event
	sink    Sink
	buf     []byte
	out     Outcome
	failure string
}

func NewStream(parse func(string) []Event, sink Sink) *Stream {
	return &Stream{parse: parse, sink: sink}
}

func (s *Stream) Write(p []byte) (int, error) {
	s.buf = append(s.buf, p...)
	for {
		i := bytes.IndexByte(s.buf, '\n')
		if i < 0 {
			break
		}
		line := s.buf[:i]
		s.buf = s.buf[i+1:]
		s.line(string(bytes.TrimRight(line, "\r")))
	}
	return len(p), nil
}

// Close handles a last line without a newline. The error is the harness's own
// error result, if it reported one.
func (s *Stream) Close() (Outcome, error) {
	if len(bytes.TrimSpace(s.buf)) > 0 {
		s.line(string(s.buf))
	}
	s.buf = nil
	if s.failure != "" {
		return s.out, errors.New(s.failure)
	}
	return s.out, nil
}

func (s *Stream) line(l string) {
	for _, ev := range s.parse(l) {
		switch ev.Kind {
		case EventSession:
			s.out.Live = true
			if ev.Text != "" {
				s.out.SessionID = ev.Text
			}
		case EventText:
			s.sink.Text(ev.Text, ev.Block)
		case EventTool:
			s.sink.Step(ev.Text)
		case EventError:
			s.failure = ev.Text
		case EventResult:
			s.sink.Result(ev.Text)
		}
	}
}
