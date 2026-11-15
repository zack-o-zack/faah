package forge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
)

func (*gitea) FetchOverview(ctx context.Context, t PRTarget, token, headSHA string) (PROverview, error) {
	a := giteaAPI(t, token)
	pr := giteaPRPath(t)
	return loadOverview(ctx, func(ctx context.Context) (overviewDescription, error) {
		var data struct {
			Author    giteaUser   `json:"user"`
			CreatedAt string      `json:"created_at"`
			Body      string      `json:"body"`
			Requested []giteaUser `json:"requested_reviewers"`
		}
		_, err := a.do(ctx, http.MethodGet, pr, nil, &data)
		out := overviewDescription{PRDescription: PRDescription{Author: data.Author.Login, AvatarURL: data.Author.AvatarURL, CreatedAt: data.CreatedAt, Body: data.Body}}
		for _, u := range data.Requested {
			out.Requested = append(out.Requested, PRReviewer{ID: u.Login, Name: u.Login, AvatarURL: u.AvatarURL, State: ReviewPending})
		}
		return out, err
	}, func(ctx context.Context) (checkList, error) {
		return fetchCheckPages(ctx, a, giteaRepoPath(t)+"/commits/"+url.PathEscape(headSHA)+"/statuses?limit=50", "", 50, func(raw json.RawMessage) (checkRecord, error) {
			var r struct {
				ID     int64  `json:"id"`
				Name   string `json:"context"`
				Status string `json:"status"`
				URL    string `json:"target_url"`
			}
			if err := json.Unmarshal(raw, &r); err != nil {
				return checkRecord{}, err
			}
			return checkRecord{PRCheck: PRCheck{ID: "gitea:" + r.Name, Name: r.Name, State: checkState(r.Status), URL: r.URL}, RunID: r.ID}, nil
		}, nil)
	}, func(ctx context.Context) ([]PRReviewer, error) {
		rows, err := giteaPages[struct {
			ID        int64     `json:"id"`
			User      giteaUser `json:"user"`
			State     string    `json:"state"`
			At        string    `json:"submitted_at"`
			Dismissed bool      `json:"dismissed"`
		}](ctx, a, pr+"/reviews")
		if err != nil {
			return nil, err
		}
		events := []overviewReview{}
		for _, r := range rows {
			state := reviewState(r.State)
			if r.Dismissed {
				state = ReviewCommented
			}
			events = append(events, overviewReview{PRReviewer: PRReviewer{ID: r.User.Login, Name: r.User.Login, AvatarURL: r.User.AvatarURL, State: state}, At: r.At, ID: r.ID})
		}
		return latestReviews(events), nil
	})
}
