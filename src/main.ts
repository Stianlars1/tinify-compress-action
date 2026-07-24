import { realpathSync } from "node:fs";
import path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import * as glob from "@actions/glob";
import { TinifyClient } from "@tinify-dev/client";
import { isSupportedImage, processFiles } from "./compress";
import { parseInputs, type ActionInputs } from "./inputs";
import { buildMarkdownSummary, computeTotals, formatBytes } from "./summary";
import { upsertStickyComment } from "./report";

const INPUT_NAMES = [
  "api_key",
  "patterns",
  "mode",
  "quality_mode",
  "comment",
  "github_token",
  "min_savings_bytes",
  "fail_on_error",
  "base_url",
] as const;

function readRawInputs(): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const name of INPUT_NAMES) {
    raw[name] = core.getInput(name);
  }
  return raw;
}

/** Absolute paths of the matched images. I/O always uses absolute paths. */
async function matchFiles(inputs: ActionInputs): Promise<string[]> {
  const globber = await glob.create(inputs.patterns.join("\n"), {
    followSymbolicLinks: false,
    matchDirectories: false,
  });
  const matches = await globber.glob();
  return matches.filter((file) => isSupportedImage(file)).sort();
}

/** Workspace-relative name for tables/outputs; falls back to the absolute path. */
function displayName(file: string, workspace: string): string {
  const relative = path.relative(workspace, file);
  return relative === "" || relative.startsWith("..") ? file : relative;
}

function resolveWorkspace(): string {
  const workspace = process.env["GITHUB_WORKSPACE"] ?? process.cwd();
  try {
    return realpathSync(workspace);
  } catch {
    return workspace;
  }
}

export async function run(): Promise<void> {
  let inputs: ActionInputs;
  try {
    inputs = parseInputs(readRawInputs());
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
    return;
  }
  core.setSecret(inputs.apiKey);

  const files = await matchFiles(inputs);
  core.info(
    `Matched ${files.length} image(s) for patterns: ${inputs.patterns.join(", ")}`,
  );

  const client = new TinifyClient({
    apiKey: inputs.apiKey,
    ...(inputs.baseUrl !== undefined ? { baseUrl: inputs.baseUrl } : {}),
  });

  const absoluteResults = await processFiles(
    files,
    {
      mode: inputs.mode,
      qualityMode: inputs.qualityMode,
      minSavingsBytes: inputs.minSavingsBytes,
      concurrency: 3,
    },
    client,
    { info: core.info, warning: core.warning },
  );

  const workspace = resolveWorkspace();
  const results = absoluteResults.map((result) => ({
    ...result,
    file: displayName(result.file, workspace),
  }));

  const totals = computeTotals(results);
  const markdown = buildMarkdownSummary(results, inputs.mode);

  core.setOutput("files_processed", totals.processed);
  core.setOutput("files_changed", totals.changed);
  core.setOutput("total_saved_bytes", totals.savedBytes);
  core.setOutput(
    "summary_json",
    JSON.stringify(
      results.map((result) => ({
        file: result.file,
        original_bytes: result.originalBytes,
        result_bytes: result.resultBytes,
        saved_bytes: result.savedBytes,
        action: result.action,
        ...(result.optimized !== undefined ? { optimized: result.optimized } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      })),
    ),
  );

  await core.summary.addRaw(markdown, true).write();

  if (inputs.comment) {
    const pullRequest = github.context.payload.pull_request;
    if (pullRequest === undefined) {
      core.info("comment: true but this is not a pull_request event; skipping comment.");
    } else if (inputs.githubToken === "") {
      core.warning("comment: true but github_token is empty; skipping comment.");
    } else {
      const octokit = github.getOctokit(inputs.githubToken);
      try {
        const outcome = await upsertStickyComment(
          octokit.rest.issues,
          {
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issueNumber: pullRequest.number,
          },
          markdown,
        );
        core.info(`Sticky PR comment ${outcome}.`);
      } catch (error) {
        // A comment failure (fork PR with a read-only token, missing
        // pull-requests: write permission, etc.) must not fail an otherwise
        // successful compression run.
        core.warning(
          `Could not post the PR comment (compression still succeeded): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  core.info(
    `${totals.processed} processed, ${totals.changed} ` +
      `${inputs.mode === "write" ? "written" : "would be written"}, ` +
      `${formatBytes(totals.savedBytes)} ${inputs.mode === "write" ? "saved" : "to save"}.`,
  );

  if (totals.failed > 0 && inputs.failOnError) {
    const failures = results
      .filter((result) => result.action === "failed")
      .map((result) => `${result.file}: ${result.error ?? "unknown error"}`);
    core.setFailed(
      `${totals.failed} file(s) failed to compress:\n${failures.join("\n")}`,
    );
  }
}

/* istanbul ignore next -- entrypoint */
if (require.main === module) {
  run().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
  });
}
