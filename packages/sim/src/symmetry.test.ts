import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FrameInput } from "./input.ts";
import { createInitialState, hashState, type State } from "./state.ts";
import { step } from "./step.ts";
import {
  mirrorFrameInput,
  mirrorState,
  randomInputs,
  swapFrameInput,
  swapState,
} from "./test-support.ts";

const seeds = fc.integer({ min: 0, max: 0x7fffffff });

type Transform = [state: (state: State) => State, input: (input: FrameInput) => FrameInput];

const mirror: Transform = [mirrorState, mirrorFrameInput];
const swap: Transform = [swapState, swapFrameInput];
/** Mirroring and exchanging the players leaves the starting positions unchanged. */
const mirrorAndSwap: Transform = [
  (state) => mirrorState(swapState(state)),
  (input) => mirrorFrameInput(swapFrameInput(input)),
];

/**
 * Plays random inputs from the initial state, and the transformed inputs from the transformed
 * initial state. On every frame, transforming the first run must give exactly the second one.
 * Returns the last round reached.
 */
function checkInvariance(
  seed: number,
  frames: number,
  [transformState, transformInput]: Transform,
  stopAtNextRound: boolean,
): number {
  let original = createInitialState();
  let transformed = transformState(original);
  for (const input of randomInputs(seed, frames)) {
    original = step(original, input);
    transformed = step(transformed, transformInput(input));
    if (stopAtNextRound && original.round > 1) break;
    const expected = transformState(original);
    if (hashState(transformed) !== hashState(expected)) {
      expect(transformed).toEqual(expected);
    }
  }
  return original.round;
}

describe("symmetry", () => {
  // A new round always puts player 1 on the left, so a mirror alone (or a swap alone) only holds
  // within a round.
  it("plays the same in a mirror within a round (no left/right side advantage)", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        checkInvariance(seed, 1500, mirror, true);
      }),
      // 1811530767 reaches a second round: it once failed when the test did not stop there.
      { numRuns: 40, examples: [[1811530767]] },
    );
  });

  it("plays the same with players exchanged within a round (no player 1/player 2 advantage)", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        checkInvariance(seed, 1500, swap, true);
      }),
      { numRuns: 40 },
    );
  });

  it("plays whole matches the same when mirrored and exchanged, rounds included", () => {
    let roundsChanged = 0;
    fc.assert(
      fc.property(seeds, (seed) => {
        if (checkInvariance(seed, 8000, mirrorAndSwap, false) > 1) roundsChanged++;
      }),
      { numRuns: 15, examples: [[1811530767]] },
    );
    expect(roundsChanged, "runs that went past the first round").toBeGreaterThan(0);
  });
});
