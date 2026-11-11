package notes

import "strings"

// Locate finds text in lines as they are now: the occurrence nearest the line
// it was saved at. ok is false when the text is gone.
func Locate(lines []string, text string, near int) (l1, l2 int, ok bool) {
	want := strings.Split(text, "\n")
	best := 0
	for i := 0; i+len(want) <= len(lines); i++ {
		match := true
		for j, w := range want {
			if lines[i+j] != w {
				match = false
				break
			}
		}
		if match && (best == 0 || abs(i+1-near) < abs(best-near)) {
			best = i + 1
		}
	}
	if best == 0 {
		return 0, 0, false
	}
	return best, best + len(want) - 1, true
}
