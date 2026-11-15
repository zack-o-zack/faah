package forge

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	CheckPassed            = "passed"
	CheckFailed            = "failed"
	CheckRunning           = "running"
	CheckSkipped           = "skipped"
	CheckNeutral           = "neutral"
	ReviewApproved         = "approved"
	ReviewChangesRequested = "changes_requested"
	ReviewCommented        = "commented"
	ReviewPending          = "pending"
)

type PRDescription struct {
	Author    string `json:"author"`
	AvatarURL string `json:"avatarUrl"`
	CreatedAt string `json:"createdAt"`
	Body      string `json:"body"`
	BodyHTML  string `json:"bodyHtml"`
}
type PRCheck struct {
	ID    string `json:"id"`
	App   string `json:"app,omitempty"`
	Name  string `json:"name"`
	State string `json:"state"`
	URL   string `json:"url,omitempty"`
}
type PRReviewer struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	State     string `json:"state"`
}
type PROverview struct {
	TotalChecks int           `json:"totalChecks"`
	Truncated   bool          `json:"truncated"`
	Description PRDescription `json:"description"`
	Checks      []PRCheck     `json:"checks"`
	Reviewers   []PRReviewer  `json:"reviewers"`
}

type overviewDescription struct {
	PRDescription
	Requested []PRReviewer
}
type overviewReview struct {
	PRReviewer
	At string
	ID int64
}

// parallel cancels sibling requests on the first error and waits for them to release their bodies.
func parallel(ctx context.Context, tasks ...func(context.Context) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var wg sync.WaitGroup
	var once sync.Once
	var first error
	for _, task := range tasks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := task(ctx); err != nil {
				once.Do(func() { first = err; cancel() })
			}
		}()
	}
	wg.Wait()
	return first
}
func loadOverview(ctx context.Context, body func(context.Context) (overviewDescription, error), checks func(context.Context) (checkList, error), reviews func(context.Context) ([]PRReviewer, error)) (PROverview, error) {
	var description overviewDescription
	var cs checkList
	var rs []PRReviewer
	err := parallel(ctx, func(ctx context.Context) (err error) { description, err = body(ctx); return }, func(ctx context.Context) (err error) { cs, err = checks(ctx); return }, func(ctx context.Context) (err error) { rs, err = reviews(ctx); return })
	if err != nil {
		return PROverview{}, err
	}
	if cs.Checks == nil {
		cs.Checks = []PRCheck{}
	}
	return PROverview{Description: description.PRDescription, Checks: cs.Checks, TotalChecks: cs.Total, Truncated: cs.Truncated, Reviewers: combineReviewers(description.Requested, rs)}, nil
}
func checkState(state string) string {
	switch strings.ToLower(state) {
	case "success", "successful", "passed":
		return CheckPassed
	case "failure", "failed", "error", "timed_out", "action_required", "startup_failure":
		return CheckFailed
	case "pending", "running", "in_progress", "inprogress", "queued", "waiting", "requested", "created", "preparing", "scheduled", "manual":
		return CheckRunning
	case "skipped", "cancelled", "canceled", "stopped":
		return CheckSkipped
	default:
		return CheckNeutral
	}
}
func reviewState(state string) string {
	switch strings.ToLower(state) {
	case "approved":
		return ReviewApproved
	case "changes_requested", "request_changes", "requested_changes":
		return ReviewChangesRequested
	case "pending", "request_review", "unreviewed", "review_requested", "review_started":
		return ReviewPending
	default:
		return ReviewCommented
	}
}
func combineReviewers(groups ...[]PRReviewer) []PRReviewer {
	byID := map[string]PRReviewer{}
	for _, group := range groups {
		for _, r := range group {
			if r.ID == "" {
				continue
			}
			if r.Name == "" {
				r.Name = r.ID
			}
			if r.AvatarURL == "" {
				r.AvatarURL = byID[r.ID].AvatarURL
			}
			byID[r.ID] = r
		}
	}
	result := make([]PRReviewer, 0, len(byID))
	for _, r := range byID {
		result = append(result, r)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Name != result[j].Name {
			return result[i].Name < result[j].Name
		}
		return result[i].ID < result[j].ID
	})
	return result
}
func latestReviews(events []overviewReview) []PRReviewer {
	sort.SliceStable(events, func(i, j int) bool {
		a, _ := time.Parse(time.RFC3339Nano, events[i].At)
		b, _ := time.Parse(time.RFC3339Nano, events[j].At)
		if !a.Equal(b) {
			return a.Before(b)
		}
		return events[i].ID < events[j].ID
	})
	rows := make([]PRReviewer, 0, len(events))
	for _, event := range events {
		rows = append(rows, event.PRReviewer)
	}
	return combineReviewers(rows)
}
func arrayPages[T any](ctx context.Context, a api, path string) ([]T, error) {
	raw, err := a.linkPages(ctx, path)
	if err != nil {
		return nil, err
	}
	items := make([]T, 0, len(raw))
	for _, r := range raw {
		var item T
		if err := json.Unmarshal(r, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}
