import type { FileAction, FileResult } from "./compress";
import type { Mode } from "./inputs";

export interface Totals {
  processed: number;
  changed: number;
  savedBytes: number;
  failed: number;
}

const ACTION_LABELS: Record<FileAction, string> = {
  written: "written",
  would_write: "would write (mode: check)",
  skipped_not_smaller: "skipped - not smaller (optimized: false)",
  skipped_below_min_savings: "skipped - below min_savings_bytes",
  skipped_too_large: "skipped - over 40 MB",
  failed: "failed",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function computeTotals(results: FileResult[]): Totals {
  const changed = results.filter(
    (result) => result.action === "written" || result.action === "would_write",
  );
  return {
    processed: results.length,
    changed: changed.length,
    savedBytes: changed.reduce((sum, result) => sum + result.savedBytes, 0),
    failed: results.filter((result) => result.action === "failed").length,
  };
}

/** Markdown results table used for both the job summary and the PR comment. */
export function buildMarkdownSummary(results: FileResult[], mode: Mode): string {
  const totals = computeTotals(results);
  const lines: string[] = [];
  lines.push("### Tinify.dev compression");
  lines.push("");
  if (results.length === 0) {
    lines.push("No matching images found.");
    return lines.join("\n");
  }
  lines.push(`Mode: \`${mode}\``);
  lines.push("");
  lines.push("| File | Before | After | Δ | Action |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  for (const result of results) {
    const before = formatBytes(result.originalBytes);
    const after = result.resultBytes === null ? " - " : formatBytes(result.resultBytes);
    const delta =
      result.resultBytes === null || result.originalBytes === 0
        ? " - "
        : `${((-result.savedBytes / result.originalBytes) * 100).toFixed(1)}%`;
    const action =
      result.action === "failed" && result.error !== undefined
        ? `${ACTION_LABELS[result.action]}: ${result.error}`
        : ACTION_LABELS[result.action];
    lines.push(`| \`${result.file}\` | ${before} | ${after} | ${delta} | ${action} |`);
  }
  lines.push("");
  const verb = mode === "write" ? "changed" : "would change";
  lines.push(
    `**${totals.processed} file(s) processed, ${totals.changed} ${verb}, ` +
      `${formatBytes(totals.savedBytes)} ${mode === "write" ? "saved" : "to save"}.**` +
      (totals.failed > 0 ? ` ${totals.failed} failed.` : ""),
  );
  return lines.join("\n");
}
