package agents

import (
	"context"

	"github.com/px0-ai/harness"
)

// Exec runs argv through harness.Run, feeding its output through parse.
func Exec(ctx context.Context, name string, t Turn, argv []string, parse func(string) []Event, sink Sink) (Outcome, error) {
	st := NewStream(parse, sink)
	err := harness.Run(ctx, harness.Command{Name: name, Args: argv, Model: t.Model}, t.Prompt, harness.Options{
		Dir:      t.Dir,
		Timeout:  t.Timeout,
		LogBytes: t.LogBytes,
		Stdout:   st,
		Stderr:   t.Stderr,
		Env:      t.Env,
	}).Err
	out, ferr := st.Close()
	if err == nil {
		err = ferr
	}
	return out, err
}
