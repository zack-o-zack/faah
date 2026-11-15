# Review the change, not the noise

This update makes pull request reviews easier to scan. It keeps **the PR's own changes** separate from local work, and brings the description, checks, and reviewer decisions together.

## What changed

- A focused overview for each pull request.
  - Read the description with document typography.
  - Keep CI and reviewer decisions in view.
- Shared diff preferences across the editor and walkthrough.

### Validation

- [x] Keep local commits out of the PR diff
- [x] Check all four forge adapters
- [ ] Finish the final visual review

| Surface         | Behavior                          | Verification                   |
| --------------- | --------------------------------- | ------------------------------ |
| Overview        | Description, checks and reviewers | Component and provider tests   |
| Changed files   | Only changes in the PR            | Frozen base-to-head comparison |
| Review pipeline | Run the configured review steps   | Existing workflow coverage     |

> A review should make the important decisions easy to find.

## Implementation example

Use the shared `highlightChangedWords` preference:

```go
func reviewReady(checks int) bool {
    return checks > 0
}
```

See #47 and @zack for context. More details: https://example.test/review-guide.
The code reference `#48` stays plain text.

![Review flow](https://images.test/diagram.png)

<details>
<summary>Additional verification notes</summary>

The same review data is normalized for GitHub, GitLab, Gitea and Bitbucket.

</details>

## Why this matters

The status column stays available while you read a long description. Failed and running checks remain visible. Successful checks can be expanded when you need their details.

### Follow-up

Keep this layout quiet, readable and useful in everyday code reviews.
