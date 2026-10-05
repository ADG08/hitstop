import type { FrameInput } from "./input.ts";
import { createInitialState, hashState, type State } from "./state.ts";
import { step } from "./step.ts";

export interface ReplayResult {
  state: State;
  /** Hash of the state after each frame: `hashes[i]` follows `inputs[i]`. */
  hashes: Uint32Array;
}

/** Replays a match from its inputs. The same inputs always produce the same states and hashes. */
export function replay(
  inputs: readonly FrameInput[],
  initial: State = createInitialState(),
): ReplayResult {
  const hashes = new Uint32Array(inputs.length);
  let state = initial;
  inputs.forEach((frameInput, i) => {
    state = step(state, frameInput);
    hashes[i] = hashState(state);
  });
  return { state, hashes };
}
