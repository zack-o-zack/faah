package codeintel

import (
	"strconv"
	"unicode/utf8"
)

func LineRef(l1, l2 int) string {
	if l1 == l2 {
		return strconv.Itoa(l1)
	}
	return strconv.Itoa(l1) + "-" + strconv.Itoa(l2)
}

// UTF16ToByte converts a column measured in UTF-16 code units (what JavaScript
// string indexes count) into a byte offset into the same line.
func UTF16ToByte(line string, u16 int) int {
	if u16 <= 0 {
		return 0
	}
	units, bytes := 0, 0
	for _, r := range line {
		if units >= u16 {
			break
		}
		if r >= 0x10000 {
			units += 2
		} else {
			units++
		}
		bytes += utf8.RuneLen(r)
	}
	if bytes > len(line) {
		return len(line)
	}
	return bytes
}
