package forge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
)

type glOverviewUser struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Avatar   string `json:"avatar_url"`
}

func (u glOverviewUser) reviewer(state string) PRReviewer {
	id := u.Username
	if id == "" && u.ID != 0 {
		id = strconv.FormatInt(u.ID, 10)
	}
	name := u.Name
	if name == "" {
		name = u.Username
	}
	return PRReviewer{ID: id, Name: name, AvatarURL: u.Avatar, State: state}
}
func (*gitlab) FetchOverview(ctx context.Context, t PRTarget, token, headSHA string) (PROverview, error) {
	a := gitlabAPI(t, token)
	pr := gitlabMRPath(t)
	return loadOverview(ctx, func(ctx context.Context) (overviewDescription, error) {
		var data struct {
			Author    glOverviewUser   `json:"author"`
			CreatedAt string           `json:"created_at"`
			Body      string           `json:"description"`
			Requested []glOverviewUser `json:"reviewers"`
		}
		_, err := a.do(ctx, http.MethodGet, pr, nil, &data)
		out := overviewDescription{PRDescription: PRDescription{Author: data.Author.reviewer("").Name, AvatarURL: data.Author.Avatar, CreatedAt: data.CreatedAt, Body: data.Body}}
		for _, u := range data.Requested {
			out.Requested = append(out.Requested, u.reviewer(ReviewPending))
		}
		return out, err
	}, func(ctx context.Context) (checkList, error) {
		return fetchCheckPages(ctx, a, "/projects/"+gitlabProject(t)+"/repository/commits/"+url.PathEscape(headSHA)+"/statuses?per_page=100", "", 100, func(raw json.RawMessage) (checkRecord, error) {
			var r struct {
				ID     int64  `json:"id"`
				Name   string `json:"name"`
				Status string `json:"status"`
				URL    string `json:"target_url"`
			}
			if err := json.Unmarshal(raw, &r); err != nil {
				return checkRecord{}, err
			}
			return checkRecord{PRCheck: PRCheck{ID: "gitlab:" + r.Name, Name: r.Name, State: checkState(r.Status), URL: r.URL}, RunID: r.ID}, nil
		}, nil)
	}, func(ctx context.Context) ([]PRReviewer, error) {
		var reviews, approvals []PRReviewer
		err := parallel(ctx, func(ctx context.Context) error {
			rows, err := arrayPages[struct {
				User  glOverviewUser `json:"user"`
				State string         `json:"state"`
				At    string         `json:"created_at"`
			}](ctx, a, pr+"/reviewers?per_page=100")
			if err != nil {
				return err
			}
			events := []overviewReview{}
			for _, r := range rows {
				events = append(events, overviewReview{PRReviewer: r.User.reviewer(reviewState(r.State)), At: r.At})
			}
			reviews = latestReviews(events)
			return nil
		}, func(ctx context.Context) error {
			var data struct {
				Approved []struct {
					User glOverviewUser `json:"user"`
				} `json:"approved_by"`
			}
			_, err := a.do(ctx, http.MethodGet, pr+"/approvals", nil, &data)
			for _, r := range data.Approved {
				approvals = append(approvals, r.User.reviewer(ReviewApproved))
			}
			return err
		})
		return combineReviewers(reviews, approvals), err
	})
}
