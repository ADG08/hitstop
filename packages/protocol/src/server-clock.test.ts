import { describe, expect, it } from "vitest";
import { CATCH_UP_DRIFT, ServerClock } from "./server-clock.ts";

const FRAME_MS = 1000 / 60;

describe("ServerClock", () => {
  it("estimates the server frame from the last one received and half the round trip", () => {
    const clock = new ServerClock();
    clock.onPong(0, 100);
    clock.onServerFrame(600, 1000);
    expect(clock.estimate(1000 + 10 * FRAME_MS)).toBeCloseTo(613, 5);
  });

  it("nudges by one tick when slightly off, and does nothing when in step", () => {
    const clock = new ServerClock();
    clock.onServerFrame(100, 0);
    expect(clock.correct(1, 100, 0)).toBe(1);
    expect(clock.correct(1, 105, 0)).toBe(0);
    expect(clock.correct(1, 95, 0)).toBe(2);
  });

  it("leaves the ticks alone until the server gave a reference", () => {
    const clock = new ServerClock();
    expect(clock.estimate(5000)).toBeUndefined();
    expect(clock.correct(1, 0, 5000)).toBe(1);
    clock.sync(0, 5000);
    expect(clock.correct(1, 0, 5000)).toBe(1);
  });

  it("catches up at once when far behind, e.g. back from a hidden tab", () => {
    const clock = new ServerClock();
    clock.onServerFrame(1000, 0);
    expect(clock.correct(1, 1000 - CATCH_UP_DRIFT - 70, 0)).toBe(1 + CATCH_UP_DRIFT + 70);
  });
});
