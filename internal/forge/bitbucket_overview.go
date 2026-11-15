package forge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
)

type bbOverviewUser struct {
	bbUser
	UUID string `json:"uuid"`
}

func (u bbOverviewUser) reviewer(state string) PRReviewer {
	id := u.UUID
	if id == "" {
		id = u.Nickname
	}
	return PRReviewer{ID: id, Name: u.name(), AvatarURL: u.Links.Avatar.Href, State: state}
}
func (*bitbucket) FetchOverview(ctx context.Context, t PRTarget, token, headSHA string) (PROverview, error) {
	a := bitbucketAPI(token)
	pr := bitbucketPRPath(t)
	// Bitbucket includes current approvals, change requests and requested reviewers
	// in the PR itself. Fetch it once, concurrently with the PR head's build statuses.
	var data struct {
		Author       bbOverviewUser   `json:"author"`
		CreatedAt    string           `json:"created_on"`
		Body         string           `json:"description"`
		Requested    []bbOverviewUser `json:"reviewers"`
		Participants []struct {
			User     bbOverviewUser `json:"user"`
			Approved bool           `json:"approved"`
			State    string         `json:"state"`
			At       string         `json:"participated_on"`
		} `json:"participants"`
	}
	var checks checkList
	err := parallel(ctx, func(ctx context.Context) error { _, err := a.do(ctx, http.MethodGet, pr, nil, &data); return err }, func(ctx context.Context) error {
		var err error
		checks, err = fetchCheckPages(ctx, a, bitbucketRepoPath(t.Owner+"/"+t.Repo)+"/commit/"+url.PathEscape(headSHA)+"/statuses?pagelen=100", "values", 100, func(raw json.RawMessage) (checkRecord, error) {
			var r struct {
				Key     string `json:"key"`
				Name    string `json:"name"`
				State   string `json:"state"`
				URL     string `json:"url"`
				Updated string `json:"updated_on"`
			}
			if err := json.Unmarshal(raw, &r); err != nil {
				return checkRecord{}, err
			}
			name := r.Name
			if name == "" {
				name = r.Key
			}
			key := r.Key
			if key == "" {
				key = name
			}
			return checkRecord{PRCheck: PRCheck{ID: "bitbucket:" + key, Name: name, State: checkState(r.State), URL: r.URL}, Updated: r.Updated}, nil
		}, nil)
		return err
	})
	if err != nil {
		return PROverview{}, err
	}
	requested := []PRReviewer{}
	for _, u := range data.Requested {
		requested = append(requested, u.reviewer(ReviewPending))
	}
	events := []overviewReview{}
	for _, r := range data.Participants {
		state := ReviewPending
		if r.Approved || r.State == "approved" {
			state = ReviewApproved
		} else if r.State == "changes_requested" {
			state = ReviewChangesRequested
		} else if r.At != "" {
			state = ReviewCommented
		}
		events = append(events, overviewReview{PRReviewer: r.User.reviewer(state), At: r.At})
	}
	return PROverview{Description: PRDescription{Body: data.Body, Author: data.Author.name(), AvatarURL: data.Author.Links.Avatar.Href, CreatedAt: data.CreatedAt}, Checks: checks.Checks, TotalChecks: checks.Total, Truncated: checks.Truncated, Reviewers: combineReviewers(requested, latestReviews(events))}, nil
}
