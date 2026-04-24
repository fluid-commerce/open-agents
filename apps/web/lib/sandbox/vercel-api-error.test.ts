import { describe, expect, test } from "bun:test";
import { extractVercelApiErrorMessage } from "./vercel-api-error";

describe("extractVercelApiErrorMessage", () => {
  test("returns the nested error.message when present", () => {
    const err = {
      message: "Status code 404 is not ok",
      json: { error: { code: "not_found", message: "Snapshot not found" } },
    };

    expect(extractVercelApiErrorMessage(err)).toBe("Snapshot not found");
  });

  test("returns undefined for non-object errors", () => {
    expect(extractVercelApiErrorMessage(null)).toBeUndefined();
    expect(extractVercelApiErrorMessage(undefined)).toBeUndefined();
    expect(extractVercelApiErrorMessage("Status code 500")).toBeUndefined();
  });

  test("returns undefined when json is missing or malformed", () => {
    expect(
      extractVercelApiErrorMessage({ message: "Status code 500" }),
    ).toBeUndefined();
    expect(extractVercelApiErrorMessage({ json: null })).toBeUndefined();
    expect(extractVercelApiErrorMessage({ json: "nope" })).toBeUndefined();
  });

  test("returns undefined when error.message is missing or empty", () => {
    expect(extractVercelApiErrorMessage({ json: {} })).toBeUndefined();
    expect(
      extractVercelApiErrorMessage({ json: { error: {} } }),
    ).toBeUndefined();
    expect(
      extractVercelApiErrorMessage({ json: { error: { message: "" } } }),
    ).toBeUndefined();
    expect(
      extractVercelApiErrorMessage({ json: { error: { message: 42 } } }),
    ).toBeUndefined();
  });
});
