package forge

import (
	"errors"
)

// PRTarget identifies a pull request or merge request across any git forge.
type PRTarget struct {
	Provider string // "github", "gitlab", etc.
	Host     string // the forge's web host, e.g. "github.com" or a self-hosted "gitlab.example.com"
	Owner    string // namespace/owner; GitLab groups nest, so this may contain "/"
	Repo     string // project/repo name
	Number   int    // PR/MR number
	URL      string // original URL
}

// PRMeta holds the normalized metadata faah needs to check out a PR,
// compute diffs, and label the review UI.
type PRMeta struct {
	Number           int
	Title            string
	Author           string
	State            string
	Merged           bool
	MergedAt         string
	Draft            bool
	BaseRef          string
	HeadRef          string
	HeadSHA          string
	HeadRepoCloneURL string
	HeadIsFork       bool
}

// PRComment is a comment already posted on the pull request, fetched
// read-only from the forge -- distinct from pr.go's DraftComment, which is a
// draft held in memory until a review is submitted. Kind is "issue" (a
// top-level PR conversation comment) or "review" (anchored to a diff line).
type PRComment struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	Path      string `json:"path,omitempty"`
	Line      int    `json:"line,omitempty"`
	Side      string `json:"side,omitempty"`
	InReplyTo int64  `json:"inReplyTo,omitempty"`
	Author    string `json:"author"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	Body      string `json:"body"`
	BodyHTML  string `json:"bodyHtml,omitempty"` // Body rendered as Markdown; the page sanitizes it
	CreatedAt string `json:"createdAt"`
	URL       string `json:"url"`
}

// Merge methods, named for what lands on the base branch rather than for any
// one forge's API. Each provider maps them onto its own vocabulary (GitHub's
// merge/squash/rebase, GitLab's squash flag plus merge-method setting,
// Bitbucket's merge_commit/squash/fast_forward, Gitea's Do field).
const (
	MergeMethodMerge  = "merge"  // a merge commit joining the head into the base
	MergeMethodSquash = "squash" // the PR's commits squashed into one commit
	MergeMethodRebase = "rebase" // each commit replayed onto the base, no merge commit
)

// Merge states, normalized across forges. PRMergeStatus.State is one of these.
const (
	mergeStateClean     = "clean"     // mergeable, nothing in the way
	mergeStateUnstable  = "unstable"  // mergeable, but some non-required checks are failing
	mergeStateConflicts = "conflicts" // the head conflicts with the base branch
	mergeStateBehind    = "behind"    // no conflicts, but the base requires the head to be up to date
	mergeStateBlocked   = "blocked"   // branch protection (required reviews or checks) refuses it
	mergeStateDraft     = "draft"     // still a draft
	mergeStateUnknown   = "unknown"   // the forge hasn't computed it yet; ask again shortly
	mergeStateClosed    = "closed"
	mergeStateMerged    = "merged"
)

// PRMergeStatus is whether, and how, the PR can be merged right now.
type PRMergeStatus struct {
	State    string   `json:"state"`
	Reason   string   `json:"reason,omitempty"` // the forge's own detail, when it gives one
	Methods  []string `json:"methods"`          // allowed on this repository, in the forge's display order
	CanMerge bool     `json:"canMerge"`         // the token has the rights to merge
	HeadSHA  string   `json:"headSha"`          // the head the status was computed for
}

// PRMergeRequest is one merge, as the reviewer confirmed it.
type PRMergeRequest struct {
	Method  string
	Title   string // commit title; ignored for MergeMethodRebase
	Message string // commit body; ignored for MergeMethodRebase
	HeadSHA string // the head the reviewer saw; a PR that has moved past it must not be merged
}

// PRMergeResult is what the forge reports back about a completed merge.
type PRMergeResult struct {
	SHA     string `json:"sha"`
	Message string `json:"message,omitempty"`
}

// Errors a provider's Merge wraps, so callers can tell a stale head or a PR
// that can't merge from a transport failure without parsing forge text.
var (
	ErrPRHeadMoved    = errors.New("the PR head moved since it was loaded")
	ErrPRNotMergeable = errors.New("the PR cannot be merged")
)

// DraftComment is a review comment held in memory only for the life of the
// process (pr.go's prSession) until submitReview posts it. Side matches
// GitHub's review-comment API: "LEFT" (the base) or "RIGHT" (the PR head).
type DraftComment struct {
	ID   int64  `json:"id"`
	Path string `json:"path"`
	Line int    `json:"line"`
	Side string `json:"side"`
	Body string `json:"body"`
}

// Info is what the UI needs to name the forge and send the user to the
// right token setting.
type Info struct {
	Name          string `json:"name"`          // provider name, e.g. "gitlab"
	Label         string `json:"label"`         // display name, e.g. "GitLab"
	TokenKey      string `json:"tokenKey"`      // the faah setting holding its token
	TokenCategory string `json:"tokenCategory"` // that setting's Settings category
	TokenHint     string `json:"tokenHint"`     // where else a token is picked up from
}
