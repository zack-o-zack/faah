package opencode

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

type durableMessage struct {
	ID      string                        `json:"id"`
	Type    string                        `json:"type"`
	Content []struct{ Type, Text string } `json:"content"`
	Error   struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (s *session) recoverTurn(ctx context.Context, promptID string) (string, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	lost := func(err error) (string, bool, error) {
		return "", false, fmt.Errorf("lost connection to opencode events: %w", err)
	}
	var active map[string]struct {
		Type string `json:"type"`
	}
	if err := s.server.call(ctx, "GET", "/api/session/active", nil, &active); err != nil {
		return lost(err)
	}
	if active[s.id].Type == "running" {
		return "", false, nil
	}
	var native struct {
		Outcome string `json:"outcome"`
	}
	if err := s.server.call(ctx, "GET", s.path(), nil, &native); err != nil {
		return lost(err)
	}
	var messages []durableMessage
	query := url.Values{"limit": {"100"}, "order": {"desc"}}
	seen := map[string]bool{}
	found := false
	for !found {
		var page []durableMessage
		var next string
		if err := s.server.callCursor(ctx, "GET", s.path()+"/message?"+query.Encode(), nil, &page, &next); err != nil {
			return lost(err)
		}
		for _, message := range page {
			if message.ID == promptID {
				found = true
				break
			}
			if message.Type == "user" {
				return lost(errors.New("current prompt is not the latest turn"))
			}
			if message.Type == "assistant" {
				messages = append(messages, message)
			}
		}
		if found {
			break
		}
		if next == "" || seen[next] {
			return lost(errors.New("current prompt is missing from durable messages"))
		}
		seen[next] = true
		query.Del("order")
		query.Set("cursor", next)
	}
	switch native.Outcome {
	case "succeeded":
		var text strings.Builder
		for index := len(messages) - 1; index >= 0; index-- {
			for _, content := range messages[index].Content {
				if content.Type == "text" {
					text.WriteString(content.Text)
				}
			}
		}
		return text.String(), true, nil
	case "failed":
		for _, message := range messages {
			if message.Error.Message != "" {
				return "", true, fmt.Errorf("opencode execution failed: %s", message.Error.Message)
			}
		}
		return "", true, errors.New("opencode execution failed while disconnected")
	case "interrupted":
		return "", true, context.Canceled
	default:
		return lost(fmt.Errorf("unknown durable execution outcome %q", native.Outcome))
	}
}
