export type Mode = "check" | "write";
export type QualityMode = "balanced" | "best_quality" | "lossless";

export interface ActionInputs {
  apiKey: string;
  /** Newline-separated glob patterns, braces already expanded. */
  patterns: string[];
  mode: Mode;
  qualityMode?: QualityMode;
  comment: boolean;
  githubToken: string;
  minSavingsBytes: number;
  failOnError: boolean;
  baseUrl?: string;
}

export class InputError extends Error {}

const QUALITY_MODES: readonly string[] = ["balanced", "best_quality", "lossless"];

/**
 * Expands single-level brace groups (`a/*.{png,jpg}` -> `a/*.png`, `a/*.jpg`)
 * because @actions/glob does not support brace expansion itself.
 */
export function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (!match || match[1] === undefined) return [pattern];
  const head = pattern.slice(0, match.index);
  const tail = pattern.slice(match.index + match[0].length);
  return match[1]
    .split(",")
    .map((alt) => `${head}${alt.trim()}${tail}`)
    .flatMap((expanded) => expandBraces(expanded));
}

/**
 * Splits a patterns input on newlines and commas, but leaves commas inside
 * brace groups alone (`*.{png,jpg}` is ONE pattern).
 */
export function splitPatterns(raw: string): string[] {
  const patterns: string[] = [];
  for (const line of raw.split("\n")) {
    let depth = 0;
    let current = "";
    for (const char of line) {
      if (char === "{") depth++;
      else if (char === "}") depth = Math.max(0, depth - 1);
      if (char === "," && depth === 0) {
        patterns.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    patterns.push(current);
  }
  return patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern !== "");
}

function parseBoolean(name: string, raw: string, fallback: boolean): boolean {
  if (raw === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InputError(`${name} must be "true" or "false", got "${raw}".`);
}

/** Pure parser over raw string inputs so tests need no @actions/core mocking. */
export function parseInputs(raw: Record<string, string>): ActionInputs {
  const apiKey = (raw["api_key"] ?? "").trim();
  if (apiKey === "") {
    throw new InputError(
      "api_key is required. Create a key at https://tinify.dev/developers and pass it as a secret.",
    );
  }

  const patternList = splitPatterns(raw["patterns"] ?? "");
  const patterns = [
    ...new Set(
      (patternList.length > 0
        ? patternList
        : ["**/*.{png,jpg,jpeg,webp,avif}"]
      ).flatMap(expandBraces),
    ),
  ];

  const modeRaw = (raw["mode"] ?? "").trim() || "check";
  if (modeRaw !== "check" && modeRaw !== "write") {
    throw new InputError(`mode must be "check" or "write", got "${modeRaw}".`);
  }

  const qualityRaw = (raw["quality_mode"] ?? "").trim();
  if (qualityRaw !== "" && !QUALITY_MODES.includes(qualityRaw)) {
    throw new InputError(
      `quality_mode must be one of ${QUALITY_MODES.join(", ")}, got "${qualityRaw}".`,
    );
  }

  const minSavingsRaw = (raw["min_savings_bytes"] ?? "").trim();
  const minSavingsBytes = minSavingsRaw === "" ? 128 : Number(minSavingsRaw);
  if (!Number.isInteger(minSavingsBytes) || minSavingsBytes < 0) {
    throw new InputError(
      `min_savings_bytes must be a non-negative integer, got "${minSavingsRaw}".`,
    );
  }

  const baseUrl = (raw["base_url"] ?? "").trim();

  return {
    apiKey,
    patterns,
    mode: modeRaw,
    ...(qualityRaw !== "" ? { qualityMode: qualityRaw as QualityMode } : {}),
    comment: parseBoolean("comment", raw["comment"] ?? "", false),
    githubToken: (raw["github_token"] ?? "").trim(),
    minSavingsBytes,
    failOnError: parseBoolean("fail_on_error", raw["fail_on_error"] ?? "", true),
    ...(baseUrl !== "" ? { baseUrl } : {}),
  };
}
