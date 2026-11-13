# Contributing to faah

Thank you for your interest in improving faah.

## How to Contribute

### Report a Bug

If you encounter unexpected behavior, memory leaks, navigation bugs, or performance issues:

- Check existing [GitHub Issues](https://github.com/zack-o-zack/faah/issues) first to avoid duplicates.
- Open a new issue using our [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md).
- Provide comprehensive context: operating system, browser, workspace size, steps to reproduce, expected vs. observed behavior, logs, and screenshots if applicable.

### Suggest a Feature or Improvement

Have an idea to make reading and navigating code faster or smoother?

- Open a new issue using our [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.md).
- Explain the motivation: what problem does this solve, why would it benefit users, and how would it fit faah's reads-first, minimal-footprint philosophy?

## Code quality checks

After `npm ci`, run `npx --no-install aislop-tools` once to install optional
engines inside `node_modules` (no system-wide tools), then `npm run aislop`.
The 0–100 score includes accepted findings; higher is better. Run
`npm run aislop -- -d` for file and rule details. `npm run aislop:ci` rejects
new findings and scores below 70, using `.aislop/ci-baseline.json`.

After fixing findings, run `npx aislop baseline prune` and commit the smaller
baseline. Use `npx aislop baseline write` only to accept reviewed remaining
findings; it also accepts any new findings, so inspect the diff before committing.
Frontend findings remain baselined during the SolidJS migration.
Four React-specific rules are disabled for `web/src` because they misread Solid's
component lifecycle; other lint and accessibility checks stay enabled.

Coverage limits in aislop 0.20.1: Biome formatting and knip need repo
configuration; the bundled golangci-lint v2 rejects the scanner's `--out-format`
flag; Go dependency audits need a separately available `govulncheck`.
CI uses pnpm 10.28.1 for audits of the tracked pnpm lockfile.

## Upstream

faah is a fork of [px0](https://github.com/px0-ai/px0). Report bugs here first, including bugs that may also exist upstream.

Thank you for helping make faah better.
