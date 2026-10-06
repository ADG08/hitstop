import { TICK_RATE } from "@hitstop/sim";

const FRAME_MS = 1000 / TICK_RATE;
/** Drift tolerated before the client runs one tick more or less per display frame. */
const MAX_DRIFT = 2;
/**
 * Further behind than this (e.g. back from a hidden tab), the client catches up at once rather
 * than one extra tick per display frame. Those frames are usually confirmed, so it is cheap.
 */
export const CATCH_UP_DRIFT = 30;
const MAX_CATCH_UP_TICKS = 600;

/**
 * Estimates the server clock from the frame numbers it sends and the measured round trip, so
 * the client can run in step with the server and its inputs arrive in time.
 */
export class ServerClock {
  private frame = 0;
  /** When `frame` was received; undefined until the server gave a reference. */
  private receivedAt: number | undefined;
  private rttMs = 0;

  get roundTripMs(): number {
    return this.rttMs;
  }

  /** Sets the reference: the server is at `frame` now (match start or resume). */
  sync(frame: number, nowMs: number): void {
    this.frame = frame;
    this.receivedAt = nowMs;
  }

  onServerFrame(frame: number, nowMs: number): void {
    if (this.receivedAt !== undefined && frame <= this.frame) return;
    this.sync(frame, nowMs);
  }

  onPong(sentAtMs: number, nowMs: number): void {
    const sample = nowMs - sentAtMs;
    this.rttMs = this.rttMs === 0 ? sample : this.rttMs * 0.8 + sample * 0.2;
  }

  /** Server frame now: the last one received, plus the time since, plus half a round trip. */
  estimate(nowMs: number): number | undefined {
    if (this.receivedAt === undefined) return undefined;
    return this.frame + (nowMs - this.receivedAt + this.rttMs / 2) / FRAME_MS;
  }

  /**
   * Ticks to run instead of `ticks` to stay near the server: one more or one less when slightly
   * off, every missing frame at once when far behind.
   */
  correct(ticks: number, clientFrame: number, nowMs: number): number {
    const estimate = this.estimate(nowMs);
    if (estimate === undefined) return ticks;
    const drift = clientFrame - estimate;
    if (drift < -CATCH_UP_DRIFT) return ticks + Math.min(Math.floor(-drift), MAX_CATCH_UP_TICKS);
    if (drift > MAX_DRIFT) return Math.max(0, ticks - 1);
    if (drift < -MAX_DRIFT) return ticks + 1;
    return ticks;
  }
}
