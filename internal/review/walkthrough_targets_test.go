package review

import "testing"

func TestCollectWalkthroughTargets(t *testing.T) {
	got := collectWalkthroughTargets(WalkthroughOptions{DiffBase: "base", DiffHead: "tip", Statuses: map[string]string{"keep.go": "M"}})
	if got.baseRef != "base" || got.headRef != "tip" || len(got.files) != 1 || got.files[0].status != "M" {
		t.Fatalf("PR targets: %+v", got)
	}
}
