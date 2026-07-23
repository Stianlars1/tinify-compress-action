# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-07-24

### Added

- Initial release: node20 JavaScript action that compresses PNG, JPEG, WebP,
  and AVIF images with the Tinify.dev API.
- `mode: check` (report only) and `mode: write` (rewrite files that get
  smaller); files are only rewritten when the result is smaller AND the
  savings reach `min_savings_bytes` (default 128).
- Files over 40 MB are skipped with a warning (API limit).
- Job summary table (file, before, after, delta, action, totals) and an
  optional sticky PR comment (marker `<!-- tinify-compress-action -->`).
- Outputs: `files_processed`, `files_changed`, `total_saved_bytes`,
  `summary_json`.
- Honest reporting of the API's `optimized: false` results.
