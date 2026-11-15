package processio

import "sync"

type TailBuffer struct {
	mu  sync.Mutex
	b   []byte
	max int
}

func (t *TailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.b = append(t.b, p...)
	if len(t.b) > t.max {
		t.b = append([]byte(nil), t.b[len(t.b)-t.max:]...)
	}
	return len(p), nil
}

func (t *TailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.b)
}

// NewTailBuffer creates a buffer retaining the last max bytes written.
func NewTailBuffer(max int) *TailBuffer { return &TailBuffer{max: max} }
