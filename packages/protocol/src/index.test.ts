import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./index.ts";

describe("@hitstop/protocol", () => {
  it("exposes a positive integer version", () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
