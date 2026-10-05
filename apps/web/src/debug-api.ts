import type { FrameInput } from "@hitstop/sim";

/** Read-only hooks used by the browser tests (and handy in the console). */
export interface DebugApi {
  frame(): number;
  drawnFrame(): number;
  inputs(): FrameInput[];
  hashes(): number[];
  /** Runs the simulation on the given inputs in this browser, as fast as possible. */
  replay(inputs: readonly FrameInput[]): number[];
}

declare global {
  interface Window {
    hitstop?: DebugApi;
  }
}
