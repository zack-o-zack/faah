package forge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxOverviewChecks = 1000
const checkPageConcurrency = 4

type checkRecord struct {
	PRCheck
	RunID   int64
	Updated string
}
type checkList struct {
	Checks    []PRCheck
	Total     int
	Truncated bool
}
type checkPage struct {
	Records []checkRecord
	Total   int
	Known   bool
	Next    string
}
type checkReader func(json.RawMessage) (checkRecord, error)

func checkPageURL(path string, page int) string {
	u, _ := url.Parse(path)
	q := u.Query()
	q.Set("page", strconv.Itoa(page))
	u.RawQuery = q.Encode()
	return u.String()
}

// Check pages have a strict payload/request cap. Known totals let independent
// pages load concurrently; opaque next links are followed only up to the cap.
func fetchCheckPages(ctx context.Context, a api, path, field string, size int, read checkReader, slots chan struct{}) (checkList, error) {
	if slots == nil {
		slots = make(chan struct{}, checkPageConcurrency)
	}
	fetch := func(ctx context.Context, path string) (checkPage, error) {
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			return checkPage{}, ctx.Err()
		}
		defer func() { <-slots }()
		resp, err := a.request(ctx, http.MethodGet, path, nil)
		if err != nil {
			return checkPage{}, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			return checkPage{}, fmt.Errorf("%s: checks: %s: %s", a.name, resp.Status, strings.TrimSpace(string(body)))
		}
		page := checkPage{}
		for _, header := range []string{"X-Total", "X-Total-Count"} {
			if n, err := strconv.Atoi(resp.Header.Get(header)); err == nil {
				page.Total = n
				page.Known = true
			}
		}
		if m := githubLinkNextRe.FindStringSubmatch(resp.Header.Get("Link")); m != nil {
			page.Next = m[1]
		}
		var raw []json.RawMessage
		if field == "" {
			err = json.NewDecoder(resp.Body).Decode(&raw)
		} else {
			var envelope map[string]json.RawMessage
			if err = json.NewDecoder(resp.Body).Decode(&envelope); err == nil {
				err = json.Unmarshal(envelope[field], &raw)
				for _, key := range []string{"total_count", "size"} {
					if value, ok := envelope[key]; ok {
						if json.Unmarshal(value, &page.Total) == nil {
							page.Known = true
						}
					}
				}
				if value, ok := envelope["next"]; ok {
					_ = json.Unmarshal(value, &page.Next)
				}
			}
		}
		if err != nil {
			return page, err
		}
		for _, value := range raw {
			record, err := read(value)
			if err != nil {
				return page, err
			}
			page.Records = append(page.Records, record)
		}
		return page, nil
	}
	first, err := fetch(ctx, path)
	if err != nil {
		return checkList{}, err
	}
	pages := []checkPage{first}
	if first.Known {
		count := (min(first.Total, maxOverviewChecks) + size - 1) / size
		if count > 1 {
			pages = make([]checkPage, count)
			pages[0] = first
			tasks := make([]func(context.Context) error, 0, count-1)
			for i := 1; i < count; i++ {
				tasks = append(tasks, func(ctx context.Context) error {
					page, err := fetch(ctx, checkPageURL(path, i+1))
					pages[i] = page
					return err
				})
			}
			if err := parallel(ctx, tasks...); err != nil {
				return checkList{}, err
			}
		}
	} else {
		for n := 1; n*size < maxOverviewChecks; n++ {
			previous := pages[len(pages)-1]
			next := previous.Next
			if next == "" && len(previous.Records) >= size {
				next = checkPageURL(path, n+1)
			}
			if next == "" {
				break
			}
			page, err := fetch(ctx, next)
			if err != nil {
				return checkList{}, err
			}
			pages = append(pages, page)
		}
	}
	records := []checkRecord{}
	for _, page := range pages {
		records = append(records, page.Records...)
	}
	last := pages[len(pages)-1]
	truncated := len(records) > maxOverviewChecks || first.Known && first.Total > maxOverviewChecks || !first.Known && len(records) >= maxOverviewChecks && (last.Next != "" || len(last.Records) >= size)
	records = records[:min(len(records), maxOverviewChecks)]
	byID := map[string]checkRecord{}
	order := []string{}
	for _, record := range records {
		old, exists := byID[record.ID]
		if !exists {
			order = append(order, record.ID)
		}
		a, _ := time.Parse(time.RFC3339Nano, record.Updated)
		b, _ := time.Parse(time.RFC3339Nano, old.Updated)
		if !exists || record.RunID > old.RunID || record.RunID == old.RunID && !a.Before(b) {
			byID[record.ID] = record
		}
	}
	checks := make([]PRCheck, 0, len(order))
	for _, id := range order {
		checks = append(checks, byID[id].PRCheck)
	}
	total := len(checks)
	if truncated {
		total = 0
		if first.Known {
			total = first.Total
		}
	}
	return checkList{Checks: checks, Total: total, Truncated: truncated}, nil
}
func combineChecks(groups ...checkList) checkList {
	result := checkList{Checks: []PRCheck{}}
	known := true
	for _, group := range groups {
		result.Checks = append(result.Checks, group.Checks...)
		result.Truncated = result.Truncated || group.Truncated
		result.Total += group.Total
		if group.Truncated && group.Total == 0 {
			known = false
		}
	}
	if len(result.Checks) > maxOverviewChecks {
		result.Truncated = true
		result.Checks = result.Checks[:maxOverviewChecks]
	}
	if !known {
		result.Total = 0
	}
	return result
}
