import { type FrameInput, hashState, Phase, replay, step, TICK_RATE } from "@hitstop/sim";
import { randomInputs, seededRandom } from "@hitstop/sim/testing";
import { describe, expect, it } from "vitest";
import type { ClientMessage, PlayerIndex, ServerMessage } from "./messages.ts";
import { MAX_PREDICTION, NetplayClient } from "./netplay-client.ts";
import { ConditionedLink, type LinkConditions, PERFECT_LINK } from "./network-sim.ts";
import { ServerClock } from "./server-clock.ts";
import { INPUT_DELAY, ServerMatch } from "./server-match.ts";

const FRAME_MS = 1000 / TICK_RATE;
const MAX_MATCH_MS = 20 * 60 * 1000;

/** Discrete event loop with a fake clock, so a whole match runs in milliseconds of real time. */
class EventLoop {
  now = 0;
  private events: { at: number; order: number; run: () => void }[] = [];
  private order = 0;

  schedule = (run: () => void, delayMs: number): void => {
    this.events.push({ at: this.now + delayMs, order: this.order++, run });
  };

  /** Runs events in time order until `until` returns true or time runs out. */
  runUntil(until: () => boolean, limitMs: number): void {
    while (!until() && this.now < limitMs) {
      this.events.sort((a, b) => a.at - b.at || a.order - b.order);
      const next = this.events.shift();
      if (!next) return;
      this.now = next.at;
      next.run();
    }
  }
}

interface Result {
  serverHash: number;
  clientHashes: number[];
  /** Whether the state each client displays equals the server's state at the same frame. */
  displayedMatches: boolean[];
  frames: number;
  rollbacks: number[];
  stalls: number[];
}

/**
 * Plays a full online match between two scripted players. Each client ticks on its own clock,
 * kept in step with the server clock, exactly like the browser client.
 */
function playOnline(seed: number, links: [LinkConditions, LinkConditions]): Result {
  const loop = new EventLoop();
  const random = seededRandom(seed);
  const unit = () => random() / 0x100000000;
  const now = () => loop.now;
  const server = new ServerMatch();
  const script = randomInputs(seed, 200_000);
  const linkPair = (conditions: LinkConditions) => ({
    up: new ConditionedLink(conditions, unit, now, loop.schedule),
    down: new ConditionedLink(conditions, unit, now, loop.schedule),
  });
  const network = [linkPair(links[0]), linkPair(links[1])] as const;
  const clients: (NetplayClient | undefined)[] = [undefined, undefined];
  const clocks = [new ServerClock(), new ServerClock()] as const;
  const stalls = [0, 0];

  const toServer = (player: PlayerIndex, message: ClientMessage) => {
    network[player].up.send(() => {
      if (message.type === "input") {
        server.receive(player, message.first, message.inputs, message.ack);
      } else if (message.type === "ping") {
        toClient(player, { type: "pong", time: message.time });
      }
    }, message.type === "input");
  };

  const toClient = (player: PlayerIndex, message: ServerMessage) => {
    network[player].down.send(() => onServerMessage(player, message), message.type === "confirm");
  };

  const onServerMessage = (player: PlayerIndex, message: ServerMessage) => {
    if (message.type === "start") {
      const client = new NetplayClient(player, message.inputDelay);
      clients[player] = client;
      clocks[player].sync(0, loop.now);
      startClient(player, client);
    } else if (message.type === "confirm") {
      clients[player]?.confirm(message.first, message.inputs, message.ack, message.serverFrame);
      clocks[player].onServerFrame(message.serverFrame, loop.now);
    } else if (message.type === "pong") {
      clocks[player].onPong(message.time, loop.now);
    }
  };

  const startClient = (player: PlayerIndex, client: NetplayClient) => {
    const startedAt = loop.now;
    let ticks = 0;
    let scriptIndex = 0;
    const tick = () => {
      ticks++;
      // Same rule as the browser: stay close to the estimated server clock.
      const runs = clocks[player].correct(1, client.current.frame, loop.now);
      for (let i = 0; i < runs; i++) {
        const input = (script[scriptIndex] as FrameInput)[player];
        if (client.tick(input)) scriptIndex++;
        else stalls[player] = (stalls[player] ?? 0) + 1;
      }
      toServer(player, client.outgoing());
      if (ticks % 30 === 0) toServer(player, { type: "ping", time: loop.now });
      if (!server.over) loop.schedule(tick, startedAt + ticks * FRAME_MS - loop.now + FRAME_MS);
    };
    loop.schedule(tick, FRAME_MS);
  };

  // The match starts for both players at the same server time.
  toClient(0, { type: "start", inputDelay: INPUT_DELAY });
  toClient(1, { type: "start", inputDelay: INPUT_DELAY });
  let serverTicks = 0;
  const serverTick = () => {
    serverTicks++;
    server.tick();
    toClient(0, server.update(0));
    toClient(1, server.update(1));
    if (!server.over) loop.schedule(serverTick, serverTicks * FRAME_MS + FRAME_MS - loop.now);
  };
  loop.schedule(serverTick, FRAME_MS);

  const settled = () =>
    server.over &&
    clients.every((client) => client && client.confirmedFrame === server.confirmedFrame);
  // Keep delivering the last confirmations after the match ends.
  loop.runUntil(() => server.over, MAX_MATCH_MS);
  const flush = () => {
    toClient(0, server.update(0));
    toClient(1, server.update(1));
    if (!settled()) loop.schedule(flush, FRAME_MS);
  };
  flush();
  loop.runUntil(settled, loop.now + 10_000);

  return {
    serverHash: hashState(server.state),
    clientHashes: clients.map((client) => (client ? hashState(client.settledState()) : -1)),
    displayedMatches: clients.map((client) => {
      if (!client) return false;
      let reference = replay(server.confirmed.slice(0, client.current.frame)).state;
      // A client may predict a few frames past the end: a finished match only counts frames.
      while (reference.frame < client.current.frame && reference.phase === Phase.MatchOver) {
        reference = step(reference, [0, 0]);
      }
      return hashState(client.current) === hashState(reference);
    }),
    frames: server.confirmedFrame,
    rollbacks: clients.map((client) => client?.rollbacks ?? -1),
    stalls,
  };
}

function link(latencyMs: number, jitterMs = 0, loss = 0): LinkConditions {
  return { latencyMs, jitterMs, loss };
}

describe("online match over a simulated network", () => {
  it("needs no rollback on a perfect network thanks to the input delay", () => {
    const result = playOnline(1, [PERFECT_LINK, PERFECT_LINK]);
    expect(result.clientHashes).toEqual([result.serverHash, result.serverHash]);
    expect(result.displayedMatches).toEqual([true, true]);
    expect(result.rollbacks).toEqual([0, 0]);
  });

  it("ends identical on both clients and the server with 100 ms of round trip", () => {
    const result = playOnline(2, [link(50, 5), link(50, 5)]);
    expect(result.clientHashes).toEqual([result.serverHash, result.serverHash]);
    expect(result.displayedMatches).toEqual([true, true]);
    expect(result.rollbacks[0]).toBeGreaterThan(0);
    expect(result.frames).toBeGreaterThan(1000);
  });

  it("stays identical with very different latencies, jitter and lost messages", () => {
    for (const [seed, links] of [
      [3, [link(100, 30, 0.05), link(10, 2, 0.05)]],
      [4, [link(75, 50, 0.2), link(75, 50, 0.2)]],
      [5, [link(150, 0, 0), link(0, 0, 0.3)]],
    ] as const) {
      const result = playOnline(seed, [...links]);
      expect(result.clientHashes, `seed ${seed}`).toEqual([result.serverHash, result.serverHash]);
      expect(result.displayedMatches).toEqual([true, true]);
    }
  });

  it("keeps predictions short: the client rarely has to wait for the server", () => {
    const result = playOnline(6, [link(50, 5), link(50, 5)]);
    expect(Math.max(...result.stalls)).toBeLessThan(result.frames / 100);
    expect(MAX_PREDICTION).toBeGreaterThan(INPUT_DELAY);
  });
});

describe("NetplayClient", () => {
  it("rebuilds a match from the confirmed history (reconnection)", () => {
    const inputs = randomInputs(7, 3000);
    const server = new ServerMatch();
    for (const [i, [a, b]] of inputs.entries()) {
      server.receive(0, i + 1, [a], 0);
      server.receive(1, i + 1, [b], 0);
      server.tick();
    }
    const rebuilt = new NetplayClient(1, INPUT_DELAY, server.confirmed);
    expect(rebuilt.confirmedFrame).toBe(server.confirmedFrame);
    expect(rebuilt.current.frame).toBe(server.confirmedFrame);
    expect(hashState(rebuilt.confirmedState)).toBe(hashState(server.state));
  });

  it("stops advancing when too far ahead of the confirmed frames", () => {
    const client = new NetplayClient(0, INPUT_DELAY);
    let advanced = 0;
    for (let i = 0; i < 100; i++) if (client.tick(0)) advanced++;
    expect(advanced).toBe(MAX_PREDICTION);
  });

  it("sends every unacknowledged input, starting with the frames covered by the input delay", () => {
    const client = new NetplayClient(0, INPUT_DELAY);
    client.tick(5);
    client.tick(6);
    expect(client.outgoing()).toEqual({ type: "input", first: 1, inputs: [0, 0, 5, 6], ack: 0 });
    client.confirm(1, [], 3, 0);
    expect(client.outgoing()).toEqual({ type: "input", first: 4, inputs: [6], ack: 0 });
  });
});

describe("ServerMatch", () => {
  it("confirms a frame once both inputs are in, and keeps the previous input after the deadline", () => {
    const server = new ServerMatch();
    server.receive(0, 1, [1, 2], 0);
    server.tick();
    expect(server.confirmedFrame).toBe(0);
    server.receive(1, 1, [8], 0);
    server.tick();
    expect(server.confirmed).toEqual([[1, 8]]);
    for (let i = 0; i < 20; i++) server.tick();
    expect(server.confirmed[1]).toEqual([2, 8]);
    expect(server.confirmed.at(-1)).toEqual([2, 8]);
  });

  it("ignores inputs for frames already confirmed or too far ahead", () => {
    const server = new ServerMatch();
    server.receive(0, 1, [1], 0);
    server.receive(1, 1, [2], 0);
    server.tick();
    server.receive(0, 1, [7], 0);
    expect(server.confirmed[0]).toEqual([1, 2]);
    server.receive(0, 10_000, [1], 0);
    expect(server.receivedUpTo(0)).toBe(1);
    expect(server.state.phase).toBe(Phase.Intro);
  });
});
