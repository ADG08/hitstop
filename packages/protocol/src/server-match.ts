import {
  createInitialState,
  type FrameInput,
  type Input,
  Phase,
  type State,
  step,
} from "@hitstop/sim";
import { MAX_INPUTS_PER_MESSAGE, type PlayerIndex, type ServerMessage } from "./messages.ts";

/** Frames of delay between a key press and its effect, on both sides. */
export const INPUT_DELAY = 2;
/**
 * A frame is confirmed as soon as both inputs are known, or this many frames after the server
 * reached it: a late player then keeps its previous input for that frame.
 */
export const CONFIRM_DEADLINE = 12;
/** Inputs for frames further ahead of the server clock are ignored. */
export const MAX_LEAD = 60;

/**
 * Authoritative side of a match. The server decides the input of every player for every frame,
 * runs the simulation on those inputs, and sends them to both clients.
 */
export class ServerMatch {
  state: State = createInitialState();
  /** confirmed[f - 1] holds the inputs of frame f. */
  readonly confirmed: FrameInput[] = [];
  /** Server clock, in frames since the start. */
  serverFrame = 0;
  private readonly pending: [Map<number, Input>, Map<number, Input>] = [new Map(), new Map()];
  /** Last confirmed frame each client says it has received. */
  private readonly clientAck: [number, number] = [0, 0];

  get confirmedFrame(): number {
    return this.confirmed.length;
  }

  get over(): boolean {
    return this.state.phase === Phase.MatchOver;
  }

  receive(player: PlayerIndex, first: number, inputs: readonly Input[], ack: number): void {
    this.clientAck[player] = Math.min(Math.max(this.clientAck[player], ack), this.confirmedFrame);
    const pending = this.pending[player];
    inputs.forEach((input, i) => {
      const frame = first + i;
      const isOpen = frame > this.confirmedFrame && frame <= this.serverFrame + MAX_LEAD;
      if (isOpen && !pending.has(frame)) pending.set(frame, input);
    });
  }

  /** Advances the server clock by one frame and confirms every frame that can be. */
  tick(): void {
    this.serverFrame++;
    while (!this.over) {
      const frame = this.confirmedFrame + 1;
      const a = this.pending[0].get(frame);
      const b = this.pending[1].get(frame);
      const late = this.serverFrame - frame >= CONFIRM_DEADLINE;
      if ((a === undefined || b === undefined) && !late) break;
      const previous = this.confirmed.at(-1) ?? [0, 0];
      const inputs: FrameInput = [a ?? previous[0], b ?? previous[1]];
      this.confirmed.push(inputs);
      this.pending[0].delete(frame);
      this.pending[1].delete(frame);
      this.state = step(this.state, inputs);
    }
  }

  /** Last frame of `player`'s inputs the server has without a gap (or that is already final). */
  receivedUpTo(player: PlayerIndex): number {
    let frame = this.confirmedFrame;
    while (this.pending[player].has(frame + 1)) frame++;
    return frame;
  }

  /** Update for one client: confirmed inputs it has not acknowledged yet, and its input ack. */
  update(player: PlayerIndex): ServerMessage {
    const first = this.clientAck[player] + 1;
    return {
      type: "confirm",
      first,
      inputs: this.confirmed.slice(first - 1, first - 1 + MAX_INPUTS_PER_MESSAGE * 4),
      ack: this.receivedUpTo(player),
      serverFrame: this.serverFrame,
    };
  }
}
