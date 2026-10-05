import {
  createInitialState,
  type FrameInput,
  hashState,
  Phase,
  type State,
  step,
} from "@hitstop/sim";

/** A local match: the current state plus everything needed to replay and check it. */
export class Session {
  state: State = createInitialState();
  readonly inputs: FrameInput[] = [];
  readonly hashes: number[] = [];

  /** Advances one frame. Once the match is over nothing changes, so nothing is recorded. */
  tick(input: FrameInput): void {
    if (this.state.phase === Phase.MatchOver) return;
    this.state = step(this.state, input);
    this.inputs.push(input);
    this.hashes.push(hashState(this.state));
  }
}
