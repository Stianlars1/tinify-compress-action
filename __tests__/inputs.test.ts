import { describe, expect, it } from "vitest";
import { expandBraces, parseInputs, InputError } from "../src/inputs";

describe("expandBraces", () => {
  it("expands a single brace group", () => {
    expect(expandBraces("**/*.{png,jpg}")).toEqual(["**/*.png", "**/*.jpg"]);
  });

  it("expands nested groups recursively", () => {
    expect(expandBraces("{a,b}/*.{png,jpg}")).toEqual([
      "a/*.png",
      "a/*.jpg",
      "b/*.png",
      "b/*.jpg",
    ]);
  });

  it("passes brace-free patterns through", () => {
    expect(expandBraces("images/**/*.png")).toEqual(["images/**/*.png"]);
  });
});

describe("parseInputs", () => {
  const base = { api_key: "tnf_test_x" };

  it("applies documented defaults", () => {
    const inputs = parseInputs(base);
    expect(inputs).toMatchObject({
      apiKey: "tnf_test_x",
      mode: "check",
      comment: false,
      minSavingsBytes: 128,
      failOnError: true,
    });
    expect(inputs.qualityMode).toBeUndefined();
    expect(inputs.baseUrl).toBeUndefined();
    expect(inputs.patterns).toEqual([
      "**/*.png",
      "**/*.jpg",
      "**/*.jpeg",
      "**/*.webp",
      "**/*.avif",
    ]);
  });

  it("requires api_key", () => {
    expect(() => parseInputs({})).toThrow(InputError);
    expect(() => parseInputs({ api_key: "  " })).toThrow(/api_key is required/);
  });

  it("splits patterns on newlines and commas and expands braces", () => {
    const inputs = parseInputs({
      ...base,
      patterns: "assets/*.{png,jpg}\nstatic/logo.webp, img/**/*.avif",
    });
    expect(inputs.patterns).toEqual([
      "assets/*.png",
      "assets/*.jpg",
      "static/logo.webp",
      "img/**/*.avif",
    ]);
  });

  it("validates mode", () => {
    expect(parseInputs({ ...base, mode: "write" }).mode).toBe("write");
    expect(() => parseInputs({ ...base, mode: "dry-run" })).toThrow(/mode must be/);
  });

  it("validates quality_mode", () => {
    expect(parseInputs({ ...base, quality_mode: "lossless" }).qualityMode).toBe(
      "lossless",
    );
    expect(() => parseInputs({ ...base, quality_mode: "ultra" })).toThrow(
      /quality_mode must be one of/,
    );
  });

  it("validates min_savings_bytes and booleans", () => {
    expect(parseInputs({ ...base, min_savings_bytes: "0" }).minSavingsBytes).toBe(0);
    expect(() => parseInputs({ ...base, min_savings_bytes: "-1" })).toThrow(InputError);
    expect(() => parseInputs({ ...base, min_savings_bytes: "lots" })).toThrow(InputError);
    expect(parseInputs({ ...base, fail_on_error: "false" }).failOnError).toBe(false);
    expect(parseInputs({ ...base, comment: "true" }).comment).toBe(true);
    expect(() => parseInputs({ ...base, comment: "yes" })).toThrow(InputError);
  });

  it("keeps base_url only when set", () => {
    expect(parseInputs({ ...base, base_url: "http://localhost:8080" }).baseUrl).toBe(
      "http://localhost:8080",
    );
  });
});
