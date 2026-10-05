import { describe, expect, it } from "vitest";
import { FixedStepClock, MAX_TICKS_PER_UPDATE } from "./loop.ts";

/** Total ticks produced by `seconds` of display frames at `hz`. */
function ticksOver(seconds: number, hz: number): number {
  const clock = new FixedStepClock();
  let total = clock.advance(0);
  const frames = Math.round(seconds * hz);
  for (let i = 1; i <= frames; i++) total += clock.advance((i * 1000) / hz);
  return total;
}

describe("FixedStepClock", () => {
  it("runs exactly 60 ticks per second whatever the display refresh rate", () => {
    for (const hz of [30, 60, 75, 120, 144, 165, 240]) {
      expect(ticksOver(60, hz)).toBe(3600);
    }
  });

  it("does not drift over a full match at 144 Hz", () => {
    expect(ticksOver(10 * 60, 144)).toBe(36_000);
  });

  it("caps a long freeze instead of running a burst of frames", () => {
    const clock = new FixedStepClock();
    clock.advance(0);
    expect(clock.advance(5000)).toBe(MAX_TICKS_PER_UPDATE);
    expect(clock.advance(5000 + 1000 / 60)).toBe(1);
  });

  it("forgets elapsed time after a reset", () => {
    const clock = new FixedStepClock();
    clock.advance(0);
    clock.reset();
    expect(clock.advance(10_000)).toBe(0);
    expect(clock.advance(10_000 + 1000 / 60)).toBe(1);
  });
});
