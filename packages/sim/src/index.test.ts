import { describe, expect, it } from "vitest";
import { TICK_RATE } from "./index.ts";

describe("@hitstop/sim", () => {
  it("runs at 60 frames per second", () => {
    expect(TICK_RATE).toBe(60);
  });
});
