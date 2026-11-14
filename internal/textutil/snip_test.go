package textutil

import "testing"

func TestSnipBoundsChecks(t *testing.T) {
	// Negative from, out of bounds to, inverted range
	m1 := Snip([]byte("hello world"), -5, 100)
	if m1.Mid != "hello world" {
		t.Errorf("expected clamped mid 'hello world', got %q", m1.Mid)
	}

	m2 := Snip([]byte("hello world"), 8, 3)
	if m2.Mid != "" {
		t.Errorf("expected empty mid for inverted range, got %q", m2.Mid)
	}
}

func BenchmarkSnip(b *testing.B) {
	rawLine := []byte("    func handleSearchRequest(w http.ResponseWriter, r *http.Request, query string) (SearchResult, error) {")
	from := 9
	to := 28

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Snip(rawLine, from, to)
	}
}
