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

const FRAMES_PER_RUN = 1500;
const seeds = fc.integer({ min: 0, max: 0x7fffffff });

/**
 * Plays `inputs` from the initial state, and the transformed inputs from the transformed initial
 * state. On every frame, transforming the first run must give exactly the second one.
 */
function checkInvariance(
  seed: number,
  transformState: (state: State) => State,
  transformInput: (input: FrameInput) => FrameInput,
): void {
  let original = createInitialState();
  let transformed = transformState(original);
  for (const input of randomInputs(seed, FRAMES_PER_RUN)) {
    original = step(original, input);
    transformed = step(transformed, transformInput(input));
    const expected = transformState(original);
    if (hashState(transformed) !== hashState(expected)) {
      expect(transformed).toEqual(expected);
    }
  }
}

describe("symmetry", () => {
  it("plays the same in a mirror (no left/right side advantage)", () => {
    fc.assert(
      fc.property(seeds, (seed) => checkInvariance(seed, mirrorState, mirrorFrameInput)),
      { numRuns: 40 },
    );
  });

  it("plays the same with players exchanged (no player 1/player 2 advantage)", () => {
    fc.assert(
      fc.property(seeds, (seed) => checkInvariance(seed, swapState, swapFrameInput)),
      { numRuns: 40 },
    );
  });
});
