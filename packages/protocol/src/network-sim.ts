/** Network conditions for one direction of a connection. */
export interface LinkConditions {
  /** One-way delay added to every message, in milliseconds. */
  latencyMs: number;
  /** Extra random delay, between 0 and this value, in milliseconds. */
  jitterMs: number;
  /** Probability (0 to 1) of losing a message that can be lost. */
  loss: number;
}

export const PERFECT_LINK: LinkConditions = { latencyMs: 0, jitterMs: 0, loss: 0 };

/** Runs `callback` after `delayMs` (setTimeout in the browser, a fake clock in tests). */
export type Scheduler = (callback: () => void, delayMs: number) => void;

/**
 * Simulates a slow or unreliable network on one direction of a connection, for tests and for
 * trying the game in bad conditions. Messages stay in order, as over a WebSocket. Only
 * messages marked as losable are dropped: inputs and confirmations, which are sent again until
 * acknowledged.
 */
export class ConditionedLink {
  private lastDeliveryAt = Number.NEGATIVE_INFINITY;
  private readonly conditions: LinkConditions;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly schedule: Scheduler;

  constructor(
    conditions: LinkConditions,
    random: () => number,
    now: () => number,
    schedule: Scheduler,
  ) {
    this.conditions = conditions;
    this.random = random;
    this.now = now;
    this.schedule = schedule;
  }

  send(deliver: () => void, losable: boolean): void {
    const { latencyMs, jitterMs, loss } = this.conditions;
    if (losable && loss > 0 && this.random() < loss) return;
    const now = this.now();
    const deliveryAt = Math.max(now + latencyMs + this.random() * jitterMs, this.lastDeliveryAt);
    this.lastDeliveryAt = deliveryAt;
    if (deliveryAt <= now) deliver();
    else this.schedule(deliver, deliveryAt - now);
  }
}
