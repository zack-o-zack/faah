package forge

import (
	"context"

	"faah/internal/git"
	"faah/internal/settings"
)

// Provider abstracts forge-specific operations (GitHub, GitLab, etc.)
// for pull/merge request reviews.
type Provider interface {
	// Name returns the provider name (e.g. "github", "gitlab").
	Name() string

	// Info names the forge and its token setting for the UI.
	Info() Info

	// TokenSetup says how to create a token for host (the forge's own host
	// for a single-host forge).
	TokenSetup(host string) TokenSetup

	// MatchRemote reports whether a git remote URL points at this forge, so
	// a plain workspace knows which token it would need.
	MatchRemote(remoteURL string) bool

	// CloneURL is the https clone URL of the target's repository.
	CloneURL(target PRTarget) string

	// PRHeadRef is the ref the forge publishes the PR head under
	// (refs/pull/N/head, refs/merge-requests/N/head), or "" when it has none
	// and the head branch itself must be fetched.
	PRHeadRef(target PRTarget) string

	// GitAuth is how git authenticates to the forge with token.
	GitAuth(target PRTarget, token string) git.Auth

	// MatchURL reports whether this provider recognizes and handles the given URL.
	MatchURL(rawURL string) bool

	// ParseURL extracts the PR target from the URL.
	ParseURL(rawURL string) (PRTarget, error)

	// ResolveToken looks for an auth token across settings, env vars, and CLI tools.
	// An empty return means the session stays read-only.
	ResolveToken(cfg settings.Settings, target PRTarget) (token, source string)

	// FetchPR fetches pull/merge request metadata from the forge API.
	FetchPR(ctx context.Context, target PRTarget, token string) (PRMeta, error)

	// CheckPushAccess reports whether the authenticated user has push access to the repository.
	CheckPushAccess(ctx context.Context, target PRTarget, token string) bool

	// SubmitReview posts draft comments and the overall review verdict back to the forge.
	SubmitReview(ctx context.Context, target PRTarget, token, headSHA string, comments []DraftComment, event, body string) error

	// FetchComments returns every comment already posted on the PR: top-level
	// ("issue") comments and inline ("review") comments anchored to a diff line.
	FetchComments(ctx context.Context, target PRTarget, token string) (issue, review []PRComment, err error)

	// PostIssueComment posts a new top-level PR comment immediately. GitHub has
	// no threading for these, so "replying" to one is just posting a new one.
	PostIssueComment(ctx context.Context, target PRTarget, token, body string) (PRComment, error)

	// ReplyToReviewComment posts an immediate, threaded reply to an existing
	// inline review comment.
	ReplyToReviewComment(ctx context.Context, target PRTarget, token string, commentID int64, body string) (PRComment, error)

	// FetchOverview reads the description, checks on headSHA, and current reviewer states.
	FetchOverview(ctx context.Context, target PRTarget, token, headSHA string) (PROverview, error)

	// MergeStatus reports whether the PR can merge right now and which merge
	// methods the repository allows. A forge that computes mergeability
	// lazily reports mergeStateUnknown until it has.
	MergeStatus(ctx context.Context, target PRTarget, token string) (PRMergeStatus, error)

	// Merge merges the PR on the forge. It must refuse, wrapping
	// ErrPRHeadMoved, when the PR head is no longer req.HeadSHA, and wrap
	// ErrPRNotMergeable when the forge refuses the merge itself.
	Merge(ctx context.Context, target PRTarget, token string, req PRMergeRequest) (PRMergeResult, error)
}

var defaultProviders = []Provider{
	&GitHub{},
	&gitlab{},
	&bitbucket{},
	// Last: its URL shape (host/owner/repo/pulls/N) is the loosest.
	&gitea{},
}
