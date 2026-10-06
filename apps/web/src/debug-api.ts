import type { FrameInput } from "@hitstop/sim";
import type { OnlineStatus } from "./online-match.ts";

/** Read-only hooks used by the browser tests (and handy in the console). */
export interface DebugApi {
  frame(): number;
  drawnFrame(): number;
  /** Inputs played so far: recorded locally, or confirmed by the server online. */
  inputs(): FrameInput[];
  /** Hash after each frame (local matches only). */
  hashes(): number[];
  /** Runs the simulation on the given inputs in this browser, as fast as possible. */
  replay(inputs: readonly FrameInput[]): number[];
  /** State of the online match, if one is running. */
  online(): OnlineStatus | undefined;
  /** Cuts the connection as a network failure would. */
  dropConnection(): void;
}

declare global {
  interface Window {
    hitstop?: DebugApi;
  }
}
