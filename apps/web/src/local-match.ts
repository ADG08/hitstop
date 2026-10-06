import {
  createInitialState,
  type FrameInput,
  hashState,
  Phase,
  type State,
  step,
} from "@hitstop/sim";
import type { MatchSource } from "./game.ts";

/** Two players on one machine: the state plus everything needed to replay and check it. */
export class LocalMatch implements MatchSource {
  state: State = createInitialState();
  readonly inputs: FrameInput[] = [];
  readonly hashes: number[] = [];

  ticksFor(ticks: number): number {
    return ticks;
  }

  /** Advances one frame. Once the match is over nothing changes, so nothing is recorded. */
  tick(input: FrameInput): void {
    if (this.state.phase === Phase.MatchOver) return;
    this.state = step(this.state, input);
    this.inputs.push(input);
    this.hashes.push(hashState(this.state));
  }

  debugLines(): string[] {
    return [`local  empreinte ${(this.hashes.at(-1) ?? 0).toString(16).padStart(8, "0")}`];
  }
}
