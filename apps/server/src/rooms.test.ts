import { PROTOCOL_VERSION, type ServerMessage } from "@hitstop/protocol";
import { describe, expect, it } from "vitest";
import { type Connection, RoomRegistry, randomRoomCode } from "./rooms.ts";

const FRAME_MS = 1000 / 60;

class FakeConnection implements Connection {
  readonly received: ServerMessage[] = [];
  closed = false;
  send(message: ServerMessage): void {
    this.received.push(message);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.received.findLast((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

function setup() {
  let now = 0;
  let codes = 0;
  let tokens = 0;
  const rooms = new RoomRegistry(() => now, {
    createCode: () => ["ABCD", "EFGH", "JKMN"][codes++] ?? "ZZZZ",
    createToken: () => `token-${tokens++}`,
    reconnectTimeoutMs: 1000,
  });
  const advance = (ms: number) => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 4);
      rooms.tick(now);
    }
  };
  const connect = () => {
    const connection = new FakeConnection();
    const handler = rooms.attach(connection);
    const send = (message: object) => handler.message(JSON.stringify(message));
    return { connection, handler, send };
  };
  return { rooms, advance, connect };
}

/** Two players in a started match. */
function startedMatch() {
  const world = setup();
  const host = world.connect();
  host.send({ type: "create", version: PROTOCOL_VERSION });
  const guest = world.connect();
  guest.send({ type: "join", version: PROTOCOL_VERSION, room: "ABCD" });
  world.rooms.tick(0); // the first tick sets the clock origin
  return { ...world, host, guest };
}

describe("RoomRegistry", () => {
  it("creates a room with a code, then starts the match when a second player joins", () => {
    const { host, guest } = startedMatch();
    expect(host.connection.received[0]).toMatchObject({ type: "joined", room: "ABCD", player: 0 });
    expect(guest.connection.received[0]).toMatchObject({ type: "joined", room: "ABCD", player: 1 });
    expect(host.connection.last("start")).toEqual({ type: "start", inputDelay: 2 });
    expect(guest.connection.last("start")).toEqual({ type: "start", inputDelay: 2 });
  });

  it("rejects unknown rooms, full rooms, old clients and malformed messages", () => {
    const { connect } = startedMatch();
    const stranger = connect();
    stranger.send({ type: "join", version: PROTOCOL_VERSION, room: "WXYZ" });
    stranger.send({ type: "join", version: PROTOCOL_VERSION, room: "ABCD" });
    stranger.send({ type: "create", version: PROTOCOL_VERSION - 1 });
    stranger.send({ type: "input", first: 1, inputs: [1], ack: 0 }); // not seated yet: ignored
    stranger.handler.message("not json");
    expect(stranger.connection.received.map((m) => m.type === "error" && m.reason)).toEqual([
      "room-not-found",
      "room-full",
      "version-mismatch",
      "bad-message",
    ]);
  });

  it("runs the match on the server clock and confirms the inputs it receives", () => {
    const { host, guest, advance } = startedMatch();
    host.send({ type: "input", first: 1, inputs: [1, 1, 1], ack: 0 });
    guest.send({ type: "input", first: 1, inputs: [4, 4], ack: 0 });
    advance(10 * FRAME_MS);
    const update = host.connection.last("confirm");
    expect(update?.serverFrame).toBe(10);
    expect(update?.inputs.slice(0, 2)).toEqual([
      [1, 4],
      [1, 4],
    ]);
    expect(update?.ack).toBe(3);
  });

  it("pauses while a player is away and resumes them with the whole history", () => {
    const { host, guest, advance, connect } = startedMatch();
    advance(30 * FRAME_MS);
    const token =
      guest.connection.received[0]?.type === "joined" && guest.connection.received[0].token;
    guest.handler.close();
    expect(host.connection.last("opponent")).toEqual({ type: "opponent", connected: false });

    const frameWhenLeft = host.connection.last("confirm")?.serverFrame;
    advance(500);
    expect(host.connection.last("confirm")?.serverFrame).toBe(frameWhenLeft);

    const back = connect();
    back.send({ type: "rejoin", version: PROTOCOL_VERSION, room: "ABCD", token });
    expect(back.connection.received[0]).toMatchObject({ type: "joined", player: 1 });
    const resume = back.connection.last("resume");
    expect(resume?.serverFrame).toBe(frameWhenLeft);
    expect(resume?.inputs.length).toBeGreaterThan(0);
    expect(host.connection.last("opponent")).toEqual({ type: "opponent", connected: true });
    advance(10 * FRAME_MS);
    expect(host.connection.last("confirm")?.serverFrame).toBeGreaterThan(frameWhenLeft ?? 0);
  });

  it("refuses a wrong token and closes the room when a player never comes back", () => {
    const { rooms, host, guest, advance, connect } = startedMatch();
    guest.handler.close();
    const impostor = connect();
    impostor.send({ type: "rejoin", version: PROTOCOL_VERSION, room: "ABCD", token: "nope" });
    expect(impostor.connection.last("error")).toEqual({ type: "error", reason: "bad-token" });
    advance(1500);
    expect(host.connection.last("error")).toEqual({ type: "error", reason: "opponent-left" });
    expect(host.connection.closed).toBe(true);
    expect(rooms.size).toBe(0);
  });

  it("forgets a room left before anyone joined", () => {
    const { rooms, connect } = setup();
    const host = connect();
    host.send({ type: "create", version: PROTOCOL_VERSION });
    expect(rooms.size).toBe(1);
    host.handler.close();
    expect(rooms.size).toBe(0);
  });
});

describe("randomRoomCode", () => {
  it("makes 4-character codes without ambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(randomRoomCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}$/);
  });
});
