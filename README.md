# Tinify.dev Compress Action

Compress PNG, JPEG, WebP, and AVIF images in your repository with the [Tinify.dev](https://tinify.dev/developers) API.

- **Honest by design** — files are only rewritten when the API actually made them smaller (and by at least `min_savings_bytes`). When the API cannot shrink a file it says so (`optimized: false`) instead of touching it.
- **Never grows a file** — the Tinify.dev API never returns more bytes than it received.
- **Job summary table** on every run, plus an optional sticky PR comment.
- **No hidden git pushes** — the action only edits files in the workspace; pair it with a commit action (example below) so you stay in control.

> Not affiliated with TinyPNG. This action talks to the Tinify.dev API. Free tier: 500 operations/month, no card — create a key at [tinify.dev/developers](https://tinify.dev/developers) and store it as the `TINIFY_API_KEY` secret.

## Quick start: report savings on every PR

```yaml
name: Image check
on: pull_request

permissions:
  contents: read
  pull-requests: write # only needed for comment: true

jobs:
  tinify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: tinify-dev/compress-action@v1
        with:
          api_key: ${{ secrets.TINIFY_API_KEY }}
          mode: check
          comment: true
```

## Compress and auto-commit

```yaml
name: Compress images
on:
  push:
    branches: [main]
    paths: ["**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp", "**/*.avif"]

permissions:
  contents: write

jobs:
  tinify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: tinify-dev/compress-action@v1
        with:
          api_key: ${{ secrets.TINIFY_API_KEY }}
          mode: write
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: compress images with Tinify.dev"
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `api_key` | — (required) | Tinify.dev API key (`tnf_live_*` / `tnf_test_*`). Use a secret. |
| `patterns` | `**/*.{png,jpg,jpeg,webp,avif}` | Glob pattern(s), newline- or comma-separated. Brace groups are supported. |
| `mode` | `check` | `check` reports what would change; `write` rewrites files that get smaller. |
| `quality_mode` | API default (`balanced`) | `balanced`, `best_quality`, or `lossless` (lossless is rejected for JPEG). |
| `comment` | `false` | Post/update one sticky PR comment with the results table. |
| `github_token` | `${{ github.token }}` | Token for the PR comment. |
| `min_savings_bytes` | `128` | Savings below this are reported but never written. |
| `fail_on_error` | `true` | Fail the step when any file fails to compress. |
| `base_url` | `https://api.tinify.dev` | Advanced: override the API origin. |

Files over **40 MB** (the API limit) are skipped with a warning.

## Outputs

| Output | Description |
| --- | --- |
| `files_processed` | Files matched and processed (including skips and failures). |
| `files_changed` | Files written (`mode: write`) or that would be written (`mode: check`). |
| `total_saved_bytes` | Bytes saved across changed files. |
| `summary_json` | JSON array of per-file results: `{file, original_bytes, result_bytes, saved_bytes, action, optimized?, error?}`. |

Example gate — fail a PR that ships uncompressed images:

```yaml
      - uses: tinify-dev/compress-action@v1
        id: tinify
        with:
          api_key: ${{ secrets.TINIFY_API_KEY }}
          mode: check
      - if: steps.tinify.outputs.files_changed != '0'
        run: |
          echo "Images could save ${{ steps.tinify.outputs.total_saved_bytes }} bytes. Run the compress workflow."
          exit 1
```

## Privacy and limits

- Images are uploaded to Tinify.dev for processing and deleted after **2 hours**.
- Max 40 MB / 50 MP per image; PNG, JPEG, WebP, AVIF.
- The action masks `api_key` in logs and needs no permissions beyond `contents: read` (`pull-requests: write` only for `comment: true`).

## Development

`dist/index.js` is the bundled entrypoint (built with `@vercel/ncc`) and is **committed**; CI verifies it matches `src/` (`npm run build && git diff --exit-code dist/`).

```sh
npm install
npm test
npm run build
```

## License

MIT © Stian Larsen
