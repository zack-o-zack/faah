package forge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

func (*GitHub) FetchOverview(ctx context.Context, t PRTarget, token, headSHA string) (PROverview, error) {
	a := githubAPI(token)
	pr := fmt.Sprintf("/repos/%s/%s/pulls/%d", t.Owner, t.Repo, t.Number)
	return loadOverview(ctx, func(ctx context.Context) (overviewDescription, error) {
		var data struct {
			Author    ghUser   `json:"user"`
			CreatedAt string   `json:"created_at"`
			Body      string   `json:"body"`
			Requested []ghUser `json:"requested_reviewers"`
		}
		_, err := a.do(ctx, http.MethodGet, pr, nil, &data)
		out := overviewDescription{PRDescription: PRDescription{Author: data.Author.Login, AvatarURL: data.Author.AvatarURL, CreatedAt: data.CreatedAt, Body: data.Body}}
		for _, u := range data.Requested {
			out.Requested = append(out.Requested, PRReviewer{ID: u.Login, Name: u.Login, AvatarURL: u.AvatarURL, State: ReviewPending})
		}
		return out, err
	}, func(ctx context.Context) (checkList, error) {
		base := "/repos/" + t.Owner + "/" + t.Repo + "/commits/" + url.PathEscape(headSHA)
		slots := make(chan struct{}, checkPageConcurrency)
		var runs, statuses checkList
		err := parallel(ctx, func(ctx context.Context) (err error) {
			runs, err = fetchCheckPages(ctx, a, base+"/check-runs?per_page=100", "check_runs", 100, func(raw json.RawMessage) (checkRecord, error) {
				var r struct {
					ID         int64  `json:"id"`
					Name       string `json:"name"`
					Status     string `json:"status"`
					Conclusion string `json:"conclusion"`
					URL        string `json:"html_url"`
					App        struct {
						ID   int64  `json:"id"`
						Name string `json:"name"`
						Slug string `json:"slug"`
					} `json:"app"`
				}
				if err := json.Unmarshal(raw, &r); err != nil {
					return checkRecord{}, err
				}
				state := CheckRunning
				if r.Status == "completed" {
					state = checkState(r.Conclusion)
				}
				app := r.App.Name
				if app == "" {
					app = r.App.Slug
				}
				return checkRecord{PRCheck: PRCheck{ID: "github:check:" + strconv.FormatInt(r.App.ID, 10) + ":" + r.Name, App: app, Name: r.Name, State: state, URL: r.URL}, RunID: r.ID}, nil
			}, slots)
			return
		}, func(ctx context.Context) (err error) {
			statuses, err = fetchCheckPages(ctx, a, base+"/status?per_page=100", "statuses", 100, func(raw json.RawMessage) (checkRecord, error) {
				var r struct {
					ID    int64  `json:"id"`
					Name  string `json:"context"`
					State string `json:"state"`
					URL   string `json:"target_url"`
				}
				if err := json.Unmarshal(raw, &r); err != nil {
					return checkRecord{}, err
				}
				return checkRecord{PRCheck: PRCheck{ID: "github:status:" + r.Name, Name: r.Name, State: checkState(r.State), URL: r.URL}, RunID: r.ID}, nil
			}, slots)
			return
		})
		return combineChecks(runs, statuses), err
	}, func(ctx context.Context) ([]PRReviewer, error) {
		rows, err := arrayPages[struct {
			ID    int64  `json:"id"`
			User  ghUser `json:"user"`
			State string `json:"state"`
			At    string `json:"submitted_at"`
		}](ctx, a, pr+"/reviews?per_page=100")
		if err != nil {
			return nil, err
		}
		events := []overviewReview{}
		for _, r := range rows {
			events = append(events, overviewReview{PRReviewer: PRReviewer{ID: r.User.Login, Name: r.User.Login, AvatarURL: r.User.AvatarURL, State: reviewState(r.State)}, At: r.At, ID: r.ID})
		}
		return latestReviews(events), nil
	})
}
