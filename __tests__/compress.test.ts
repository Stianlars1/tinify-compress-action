import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TinifyApiError,
  type ImageResultData,
  type TinifyResponse,
} from "@tinify-dev/client";
import {
  isSupportedImage,
  processFiles,
  type CompressClient,
  type Logger,
} from "../src/compress";
import { buildMarkdownSummary, computeTotals } from "../src/summary";
import { buildCommentBody, COMMENT_MARKER, upsertStickyComment } from "../src/report";

const SMALL_RESULT = new Uint8Array([1, 2, 3]);

function imageResult(
  originalBytes: number,
  resultBytes: number,
  optimized: boolean | null = true,
): TinifyResponse<ImageResultData> {
  return {
    data: {
      job_id: "job",
      status: "succeeded",
      optimized,
      original_bytes: originalBytes,
      result_bytes: resultBytes,
      width: 10,
      height: 10,
      download_url: "https://api.tinify.dev/dl/x",
      expires_at: "2026-07-24T12:00:00Z",
    },
    requestId: "req_1",
    rateLimit: null,
  };
}

function fakeClient(overrides: Partial<CompressClient> = {}): CompressClient {
  return {
    compress: vi.fn(async (input: Uint8Array) =>
      imageResult(input.byteLength, SMALL_RESULT.byteLength),
    ),
    download: vi.fn(async () => new Blob([SMALL_RESULT])),
    ...overrides,
  };
}

const silentLogger: Logger = { info: () => {}, warning: () => {} };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tinify-action-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeFile(name: string, size: number): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, new Uint8Array(size).fill(7));
  return file;
}

describe("processFiles", () => {
  it("writes files in write mode when smaller and above min savings", async () => {
    const file = await makeFile("a.png", 4096);
    const client = fakeClient();
    const [result] = await processFiles(
      [file],
      { mode: "write", minSavingsBytes: 128 },
      client,
      silentLogger,
    );
    expect(result).toMatchObject({
      action: "written",
      originalBytes: 4096,
      resultBytes: 3,
      savedBytes: 4093,
    });
    expect(new Uint8Array(await readFile(file))).toEqual(SMALL_RESULT);
  });

  it("does not touch files in check mode", async () => {
    const file = await makeFile("a.png", 4096);
    const client = fakeClient();
    const [result] = await processFiles(
      [file],
      { mode: "check", minSavingsBytes: 128 },
      client,
      silentLogger,
    );
    expect(result?.action).toBe("would_write");
    expect(result?.savedBytes).toBe(4093);
    expect(client.download).not.toHaveBeenCalled();
    expect((await readFile(file)).length).toBe(4096);
  });

  it("skips honestly when the API reports optimized: false", async () => {
    const file = await makeFile("a.png", 512);
    const client = fakeClient({
      compress: vi.fn(async () => imageResult(512, 512, false)),
    });
    const [result] = await processFiles(
      [file],
      { mode: "write", minSavingsBytes: 128 },
      client,
      silentLogger,
    );
    expect(result).toMatchObject({
      action: "skipped_not_smaller",
      savedBytes: 0,
      optimized: false,
    });
    expect(client.download).not.toHaveBeenCalled();
    expect((await readFile(file)).length).toBe(512);
  });

  it("skips when savings are below min_savings_bytes", async () => {
    const file = await makeFile("a.png", 1024);
    const client = fakeClient({
      compress: vi.fn(async () => imageResult(1024, 1000)),
    });
    const [result] = await processFiles(
      [file],
      { mode: "write", minSavingsBytes: 128 },
      client,
      silentLogger,
    );
    expect(result).toMatchObject({
      action: "skipped_below_min_savings",
      savedBytes: 24,
    });
    expect((await readFile(file)).length).toBe(1024);
  });

  it("skips files over 40 MB with a warning and no API call", async () => {
    const file = path.join(dir, "big.png");
    const handle = await open(file, "w");
    await handle.truncate(41_943_041);
    await handle.close();
    const client = fakeClient();
    const warnings: string[] = [];
    const [result] = await processFiles(
      [file],
      { mode: "write", minSavingsBytes: 128 },
      client,
      { info: () => {}, warning: (message) => warnings.push(message) },
    );
    expect(result?.action).toBe("skipped_too_large");
    expect(client.compress).not.toHaveBeenCalled();
    expect(warnings[0]).toContain("40 MB");
  });

  it("reports failures with code and request_id and keeps going", async () => {
    const bad = await makeFile("bad.png", 2048);
    const good = await makeFile("good.png", 2048);
    const client = fakeClient({
      compress: vi.fn(async (input: Uint8Array, options?: { filename?: string }) => {
        if (options?.filename === "bad.png") {
          throw new TinifyApiError({
            status: 415,
            code: "unsupported_media_type",
            message: "Not an image.",
            requestId: "req_fail_7",
          });
        }
        return imageResult(input.byteLength, 3);
      }),
    });
    const results = await processFiles(
      [bad, good],
      { mode: "write", minSavingsBytes: 128 },
      client,
      silentLogger,
    );
    expect(results[0]?.action).toBe("failed");
    expect(results[0]?.error).toContain("unsupported_media_type");
    expect(results[0]?.error).toContain("req_fail_7");
    expect(results[1]?.action).toBe("written");
  });

  it("preserves input order with concurrency 3", async () => {
    const files = await Promise.all(
      Array.from({ length: 7 }, (_, index) => makeFile(`f${index}.png`, 2048 + index)),
    );
    const client = fakeClient();
    const results = await processFiles(
      files,
      { mode: "check", minSavingsBytes: 128, concurrency: 3 },
      client,
      silentLogger,
    );
    expect(results.map((result) => result.file)).toEqual(files);
    expect(client.compress).toHaveBeenCalledTimes(7);
  });
});

describe("isSupportedImage", () => {
  it("accepts the supported extensions case-insensitively", () => {
    expect(isSupportedImage("a/b/c.PNG")).toBe(true);
    expect(isSupportedImage("x.jpeg")).toBe(true);
    expect(isSupportedImage("x.avif")).toBe(true);
    expect(isSupportedImage("x.gif")).toBe(false);
    expect(isSupportedImage("x.svg")).toBe(false);
  });
});

describe("summary", () => {
  const results = [
    {
      file: "img/hero.png",
      originalBytes: 319_897,
      resultBytes: 99_430,
      savedBytes: 220_467,
      action: "written" as const,
      optimized: true,
    },
    {
      file: "img/logo.jpg",
      originalBytes: 5_000,
      resultBytes: 5_000,
      savedBytes: 0,
      action: "skipped_not_smaller" as const,
      optimized: false,
    },
    {
      file: "img/broken.webp",
      originalBytes: 100,
      resultBytes: null,
      savedBytes: 0,
      action: "failed" as const,
      error: "internal_error (HTTP 500): boom [request_id: req_9]",
    },
  ];

  it("computes totals over changed files only", () => {
    expect(computeTotals(results)).toEqual({
      processed: 3,
      changed: 1,
      savedBytes: 220_467,
      failed: 1,
    });
  });

  it("renders a markdown table with per-file rows and totals", () => {
    const markdown = buildMarkdownSummary(results, "write");
    expect(markdown).toContain("### Tinify.dev compression");
    expect(markdown).toContain("| File | Before | After | Δ | Action |");
    expect(markdown).toContain("| `img/hero.png` | 312.4 KB | 97.1 KB | -68.9% | written |");
    expect(markdown).toContain("skipped - not smaller (optimized: false)");
    expect(markdown).toContain("request_id: req_9");
    expect(markdown).toContain("**3 file(s) processed, 1 changed, 215.3 KB saved.** 1 failed.");
  });

  it("says would change in check mode", () => {
    const markdown = buildMarkdownSummary(
      [{ ...results[0]!, action: "would_write" as const }],
      "check",
    );
    expect(markdown).toContain("1 would change");
    expect(markdown).toContain("to save");
  });
});

describe("sticky comment", () => {
  it("prefixes the body with the marker", () => {
    expect(buildCommentBody("hello")).toBe(`${COMMENT_MARKER}\nhello`);
  });

  it("creates when no marked comment exists, updates when it does", async () => {
    const created: string[] = [];
    const updated: Array<{ id: number; body: string }> = [];
    const issues = {
      listComments: vi.fn(async () => ({
        data: [{ id: 1, body: "unrelated" }],
      })),
      createComment: vi.fn(async (params: { body: string }) => {
        created.push(params.body);
        return {};
      }),
      updateComment: vi.fn(
        async (params: { comment_id: number; body: string }) => {
          updated.push({ id: params.comment_id, body: params.body });
          return {};
        },
      ),
    };
    const target = { owner: "tinify-dev", repo: "compress-action", issueNumber: 5 };

    await expect(upsertStickyComment(issues, target, "table")).resolves.toBe("created");
    expect(created[0]).toContain(COMMENT_MARKER);

    issues.listComments = vi.fn(async () => ({
      data: [{ id: 42, body: `${COMMENT_MARKER}\nold` }],
    }));
    await expect(upsertStickyComment(issues, target, "new table")).resolves.toBe(
      "updated",
    );
    expect(updated[0]).toEqual({ id: 42, body: `${COMMENT_MARKER}\nnew table` });
  });
});
