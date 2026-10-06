import { TICK_RATE } from "@hitstop/sim";

/** Above this, the game slows down instead of running a burst of frames (e.g. after a freeze). */
export const MAX_TICKS_PER_UPDATE = 5;

const FRAME_MS = 1000 / TICK_RATE;
/** Absorbs floating point error on timestamps that fall exactly on a frame boundary. */
const EPSILON = 1e-6;

/**
 * Turns display timestamps (requestAnimationFrame, any refresh rate) into a whole number of
 * simulation ticks at exactly TICK_RATE per second. Ticks are counted from a fixed origin
 * rather than by adding up intervals, so rounding never accumulates over a match.
 */
export class FixedStepClock {
  private origin: number | undefined;
  private emitted = 0;

  /** Number of ticks to run for a display frame at `nowMs`. */
  advance(nowMs: number): number {
    if (this.origin === undefined) {
      this.origin = nowMs;
      this.emitted = 0;
      return 0;
    }
    const due = Math.floor((nowMs - this.origin) / FRAME_MS + EPSILON);
    let ticks = due - this.emitted;
    if (ticks > MAX_TICKS_PER_UPDATE) {
      ticks = MAX_TICKS_PER_UPDATE;
      // Drop the time that could not be simulated.
      this.origin = nowMs - (this.emitted + ticks) * FRAME_MS;
    }
    this.emitted += ticks;
    return ticks;
  }

  /** Forgets elapsed time, e.g. when the tab was hidden. */
  reset(): void {
    this.origin = undefined;
  }
}
