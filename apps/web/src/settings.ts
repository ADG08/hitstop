import { type LinkConditions, PERFECT_LINK } from "@hitstop/protocol";

/** Options read from the page address, e.g. `?room=K7QF&latency=100&loss=0.05`. */
export interface Settings {
  /** Room to join on arrival (from a shared link). */
  room: string | undefined;
  /**
   * Simulated network, applied to each direction. `latency` is the added round trip in ms
   * (half in each direction), `jitter` the extra random round trip, `loss` a probability.
   */
  link: LinkConditions;
  /** Seed of a scripted player replacing the keyboard (browser tests). */
  bot: number | undefined;
}

function number(params: URLSearchParams, name: string): number | undefined {
  const value = Number(params.get(name));
  return params.has(name) && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function readSettings(search: string): Settings {
  const params = new URLSearchParams(search);
  const room = params.get("room")?.toUpperCase();
  return {
    room: room && /^[A-Z0-9]{4}$/.test(room) ? room : undefined,
    link: {
      latencyMs: (number(params, "latency") ?? PERFECT_LINK.latencyMs) / 2,
      jitterMs: (number(params, "jitter") ?? PERFECT_LINK.jitterMs) / 2,
      loss: Math.min(1, number(params, "loss") ?? PERFECT_LINK.loss),
    },
    bot: number(params, "bot"),
  };
}

/** Link to share for a room, keeping the simulated network options. */
export function roomLink(location: Location, room: string): string {
  const params = new URLSearchParams(location.search);
  params.delete("bot");
  params.set("room", room);
  return `${location.origin}${location.pathname}?${params}`;
}
