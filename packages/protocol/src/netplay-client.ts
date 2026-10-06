import {
  createInitialState,
  type FrameInput,
  hashState,
  type Input,
  type State,
  step,
} from "@hitstop/sim";
import { type ClientMessage, MAX_INPUTS_PER_MESSAGE, type PlayerIndex } from "./messages.ts";

/** The client stops advancing when it is this many frames ahead of the last confirmed frame. */
export const MAX_PREDICTION = 20;

/**
 * Client side of an online match. The local player's inputs are applied `inputDelay` frames
 * after they are entered; the opponent's unknown inputs are predicted (same as their last known
 * input). Each time the server confirms frames, the client resimulates from the last confirmed
 * state, so the displayed state is always the best guess and converges to the server's.
 */
export class NetplayClient {
  /** confirmed[f - 1] holds the inputs of frame f, as decided by the server. */
  readonly confirmed: FrameInput[] = [];
  /**
   * Last state that only depends on confirmed inputs: final, identical on the server and both
   * clients. It never goes past `current`, even when the server confirmed frames further ahead.
   */
  confirmedState: State;
  /** Best guess of the current state, the one to display. */
  current: State;
  /** Times a confirmation changed the predicted state (for the debug view). */
  rollbacks = 0;
  /** Last server clock received, used to keep this client in step with the server. */
  serverFrame = 0;

  private readonly ownInputs = new Map<number, Input>();
  /** Last frame of our own inputs the server has acknowledged. */
  private serverAck = 0;

  readonly player: PlayerIndex;
  readonly inputDelay: number;

  constructor(player: PlayerIndex, inputDelay: number, history: readonly FrameInput[] = []) {
    this.player = player;
    this.inputDelay = inputDelay;
    let state = createInitialState();
    for (const inputs of history) {
      state = step(state, inputs);
      this.confirmed.push(inputs);
    }
    this.confirmedState = state;
    this.current = state;
    // Inputs that would have been entered before the first frame: nothing pressed.
    const start = this.confirmedFrame + 1;
    for (let frame = start; frame < start + inputDelay; frame++) this.ownInputs.set(frame, 0);
    this.serverAck = this.confirmedFrame;
  }

  get confirmedFrame(): number {
    return this.confirmed.length;
  }

  /** Frames simulated ahead of the server's confirmation. */
  get prediction(): number {
    return this.current.frame - this.confirmedFrame;
  }

  /**
   * Advances one frame with the input entered now. Returns false, without advancing, when the
   * client is too far ahead of the confirmed frames and must wait for the server.
   */
  tick(input: Input): boolean {
    if (this.prediction >= MAX_PREDICTION) return false;
    const frame = this.current.frame + 1;
    this.ownInputs.set(frame + this.inputDelay, input);
    this.current = step(this.current, this.inputsFor(frame));
    if (frame <= this.confirmedFrame) this.confirmedState = this.current;
    return true;
  }

  /** Applies confirmed inputs from the server, then resimulates the predicted frames. */
  confirm(first: number, inputs: readonly FrameInput[], ack: number, serverFrame: number): void {
    this.serverFrame = Math.max(this.serverFrame, serverFrame);
    this.serverAck = Math.max(this.serverAck, ack);
    const known = this.confirmedFrame;
    if (first > known + 1) return; // a gap: the server will send these frames again
    const fresh = inputs.slice(known + 1 - first);
    if (fresh.length === 0) return;

    this.confirmed.push(...fresh);

    // Replay the frames already displayed with the corrected inputs. Frames confirmed beyond the
    // current one are applied later, when the client's own clock reaches them.
    const predicted = this.current;
    let state = this.confirmedState;
    while (state.frame < predicted.frame) {
      state = step(state, this.inputsFor(state.frame + 1));
      if (state.frame <= this.confirmedFrame) this.confirmedState = state;
    }
    if (hashState(state) !== hashState(predicted)) this.rollbacks++;
    this.current = state;
    this.forgetOwnInputsBefore(Math.min(this.serverAck, this.confirmedFrame));
  }

  /** State after every confirmed frame, whatever the client's clock: the server's state. */
  settledState(): State {
    let state = this.confirmedState;
    while (state.frame < this.confirmedFrame) {
      state = step(state, this.inputsFor(state.frame + 1));
    }
    return state;
  }

  /** Message carrying every input the server has not acknowledged yet. */
  outgoing(): ClientMessage {
    const first = this.serverAck + 1;
    const inputs: Input[] = [];
    for (let frame = first; inputs.length < MAX_INPUTS_PER_MESSAGE; frame++) {
      const input = this.ownInputs.get(frame);
      if (input === undefined) break;
      inputs.push(input);
    }
    return { type: "input", first, inputs, ack: this.confirmedFrame };
  }

  /** Confirmed inputs when known, otherwise our own input and a prediction for the opponent. */
  private inputsFor(frame: number): FrameInput {
    const confirmed = this.confirmed[frame - 1];
    if (confirmed) return confirmed;
    const last = this.confirmed.at(-1) ?? [0, 0];
    const own = this.ownInputs.get(frame) ?? last[this.player];
    const opponent = last[this.player === 0 ? 1 : 0];
    return this.player === 0 ? [own, opponent] : [opponent, own];
  }

  private forgetOwnInputsBefore(frame: number): void {
    for (const key of this.ownInputs.keys()) if (key <= frame) this.ownInputs.delete(key);
  }
}
