package agy

import "testing"

func TestWorkflowQuirk(t *testing.T) {
	for _, v := range []string{"1.4.2", "1.4.3", "1.4.4", "1.4.5"} {
		if !workflowQuirk(v) {
			t.Fatal(v)
		}
	}
	for _, v := range []string{"1.4.1", "1.4.6", "1.5.5", "2.4.3", "unknown"} {
		if workflowQuirk(v) {
			t.Fatal(v)
		}
	}
}
