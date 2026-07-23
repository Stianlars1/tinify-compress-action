import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_FILE_BYTES,
  TinifyApiError,
  type CompressOptions,
  type ImageResultData,
  type TinifyResponse,
} from "@tinify-dev/client";
import type { Mode, QualityMode } from "./inputs";

export const SUPPORTED_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".avif",
] as const;

export type FileAction =
  | "written"
  | "would_write"
  | "skipped_not_smaller"
  | "skipped_below_min_savings"
  | "skipped_too_large"
  | "failed";

export interface FileResult {
  file: string;
  originalBytes: number;
  resultBytes: number | null;
  savedBytes: number;
  action: FileAction;
  /** false when the API returned the original bytes (could not shrink). */
  optimized?: boolean | null;
  error?: string;
}

/** The subset of the SDK the action uses; tests inject a fake. */
export interface CompressClient {
  compress(
    input: Uint8Array,
    options?: CompressOptions & { filename?: string },
  ): Promise<TinifyResponse<ImageResultData>>;
  download(resultOrUrl: TinifyResponse<ImageResultData>): Promise<Blob>;
}

export interface Logger {
  info(message: string): void;
  warning(message: string): void;
}

export interface ProcessOptions {
  mode: Mode;
  qualityMode?: QualityMode | undefined;
  minSavingsBytes: number;
  concurrency?: number;
}

export function isSupportedImage(file: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(
    path.extname(file).toLowerCase(),
  );
}

/**
 * Compresses `files` with up to `concurrency` (default 3) parallel API calls.
 * A file is rewritten only when ALL of the following hold: the result is
 * smaller, the savings reach `minSavingsBytes`, and `mode` is `write`.
 * Results come back in input order.
 */
export async function processFiles(
  files: string[],
  options: ProcessOptions,
  client: CompressClient,
  logger: Logger,
): Promise<FileResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const results: FileResult[] = new Array(files.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      const file = files[index];
      if (file === undefined) return;
      results[index] = await processOne(file, options, client, logger);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, () => worker()),
  );
  return results;
}

async function processOne(
  file: string,
  options: ProcessOptions,
  client: CompressClient,
  logger: Logger,
): Promise<FileResult> {
  let originalBytes = 0;
  try {
    const stats = await stat(file);
    originalBytes = stats.size;
    if (originalBytes > MAX_FILE_BYTES) {
      logger.warning(
        `${file}: ${originalBytes} bytes exceeds the 40 MB API limit (${MAX_FILE_BYTES}); skipping.`,
      );
      return {
        file,
        originalBytes,
        resultBytes: null,
        savedBytes: 0,
        action: "skipped_too_large",
      };
    }

    const bytes = new Uint8Array(await readFile(file));
    const result = await client.compress(bytes, {
      ...(options.qualityMode !== undefined
        ? { quality_mode: options.qualityMode }
        : {}),
      filename: path.basename(file),
    });
    const data = result.data;
    const resultBytes = data.result_bytes;
    const savedBytes = originalBytes - resultBytes;

    if (data.optimized === false || savedBytes <= 0) {
      logger.info(`${file}: already as small as the API can make it (optimized: false).`);
      return {
        file,
        originalBytes,
        resultBytes,
        savedBytes: 0,
        action: "skipped_not_smaller",
        optimized: data.optimized,
      };
    }

    if (savedBytes < options.minSavingsBytes) {
      logger.info(
        `${file}: would only save ${savedBytes} bytes (< min_savings_bytes=${options.minSavingsBytes}); leaving as is.`,
      );
      return {
        file,
        originalBytes,
        resultBytes,
        savedBytes,
        action: "skipped_below_min_savings",
        optimized: data.optimized,
      };
    }

    if (options.mode === "write") {
      const blob = await client.download(result);
      const output = new Uint8Array(await blob.arrayBuffer());
      await writeFile(file, output);
      logger.info(`${file}: ${originalBytes} -> ${resultBytes} bytes (saved ${savedBytes}).`);
      return {
        file,
        originalBytes,
        resultBytes,
        savedBytes,
        action: "written",
        optimized: data.optimized,
      };
    }

    logger.info(
      `${file}: would save ${savedBytes} bytes (${originalBytes} -> ${resultBytes}); run with mode: write to apply.`,
    );
    return {
      file,
      originalBytes,
      resultBytes,
      savedBytes,
      action: "would_write",
      optimized: data.optimized,
    };
  } catch (error) {
    const message =
      error instanceof TinifyApiError
        ? `${error.code} (HTTP ${error.status}): ${error.message} [request_id: ${error.requestId}]`
        : error instanceof Error
          ? error.message
          : String(error);
    logger.warning(`${file}: failed - ${message}`);
    return {
      file,
      originalBytes,
      resultBytes: null,
      savedBytes: 0,
      action: "failed",
      error: message,
    };
  }
}
