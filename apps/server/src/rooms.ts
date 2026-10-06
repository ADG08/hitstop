import { randomInt, randomUUID } from "node:crypto";
import {
  type ClientMessage,
  type ErrorReason,
  FixedStepClock,
  INPUT_DELAY,
  type PlayerIndex,
  PROTOCOL_VERSION,
  parseClientMessage,
  ServerMatch,
  type ServerMessage,
} from "@hitstop/protocol";
import { hashState } from "@hitstop/sim";

/** What the rooms need from a transport: send a message, close the connection. */
export interface Connection {
  send(message: ServerMessage): void;
  close(): void;
}

/** Callbacks the transport calls for one connection. */
export interface ConnectionHandler {
  message(text: string): void;
  close(): void;
}

export interface RoomOptions {
  /** How long a disconnected player's seat is kept before the room is closed. */
  reconnectTimeoutMs: number;
  /** How long a finished or abandoned room is kept for late reconnections. */
  finishedRoomTtlMs: number;
  createCode: () => string;
  createToken: () => string;
}

/** Letters and digits that cannot be mistaken for one another (no 0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomRoomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  reconnectTimeoutMs: 30_000,
  finishedRoomTtlMs: 60_000,
  createCode: randomRoomCode,
  createToken: randomUUID,
};

interface Seat {
  token: string;
  connection: Connection | undefined;
  disconnectedAt: number;
}

interface Room {
  code: string;
  seats: [Seat | undefined, Seat | undefined];
  match: ServerMatch | undefined;
  clock: FixedStepClock;
  endedAt: number | undefined;
}

/**
 * Rooms and their matches, independent of the transport. Two players meet with a room code;
 * the match is played on the server clock, paused while a player is disconnected, and a player
 * who comes back with their token gets the whole confirmed history to rebuild the match.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly options: RoomOptions;
  private readonly now: () => number;

  constructor(now: () => number, options: Partial<RoomOptions> = {}) {
    this.now = now;
    this.options = { ...DEFAULT_ROOM_OPTIONS, ...options };
  }

  get size(): number {
    return this.rooms.size;
  }

  attach(connection: Connection): ConnectionHandler {
    let seat: { room: Room; player: PlayerIndex } | undefined;
    const fail = (reason: ErrorReason) => connection.send({ type: "error", reason });

    return {
      message: (text) => {
        const message = parseClientMessage(text);
        if (!message) return fail("bad-message");
        if (!seat) {
          seat = this.enter(connection, message, fail);
          return;
        }
        if (message.type === "input") {
          seat.room.match?.receive(seat.player, message.first, message.inputs, message.ack);
        } else if (message.type === "ping") {
          connection.send({ type: "pong", time: message.time });
        } else {
          fail("bad-message");
        }
      },
      close: () => {
        if (seat) this.leave(seat.room, seat.player, connection);
      },
    };
  }

  /** Advances every running match to `nowMs` and sends the updates. */
  tick(nowMs: number): void {
    for (const room of this.rooms.values()) {
      if (this.expired(room, nowMs)) continue;
      const match = room.match;
      if (!match || room.endedAt !== undefined) continue;
      if (!room.seats.every((s) => s?.connection)) {
        room.clock.reset(); // paused: the time away is not played
        continue;
      }
      const ticks = room.clock.advance(nowMs);
      if (ticks === 0) continue;
      for (let i = 0; i < ticks; i++) match.tick();
      this.broadcast(room, (player) => match.update(player));
      if (match.over) {
        room.endedAt = nowMs;
        const end: ServerMessage = {
          type: "end",
          result: match.state.result,
          hash: hashState(match.state),
          frame: match.state.frame,
        };
        this.broadcast(room, () => end);
      }
    }
  }

  private enter(
    connection: Connection,
    message: ClientMessage,
    fail: (reason: ErrorReason) => void,
  ): { room: Room; player: PlayerIndex } | undefined {
    if (message.type === "input" || message.type === "ping") {
      return undefined; // sent before a (re)join completed: nothing to do with it yet
    }
    if (message.version !== PROTOCOL_VERSION) {
      fail("version-mismatch");
      return undefined;
    }
    if (message.type === "create") {
      const room = this.createRoom();
      return this.seat(room, 0, connection);
    }
    const room = this.rooms.get(message.room);
    if (!room) {
      fail("room-not-found");
      return undefined;
    }
    if (message.type === "join") {
      if (room.seats[1]) {
        fail("room-full");
        return undefined;
      }
      const entered = this.seat(room, 1, connection);
      this.startMatch(room);
      return entered;
    }
    const player = room.seats.findIndex((s) => s?.token === message.token);
    if (player === -1) {
      fail("bad-token");
      return undefined;
    }
    return this.reconnect(room, player as PlayerIndex, connection);
  }

  private createRoom(): Room {
    let code = this.options.createCode();
    while (this.rooms.has(code)) code = this.options.createCode();
    const room: Room = {
      code,
      seats: [undefined, undefined],
      match: undefined,
      clock: new FixedStepClock(),
      endedAt: undefined,
    };
    this.rooms.set(code, room);
    return room;
  }

  private seat(room: Room, player: PlayerIndex, connection: Connection) {
    const token = this.options.createToken();
    room.seats[player] = { token, connection, disconnectedAt: 0 };
    connection.send({ type: "joined", room: room.code, player, token });
    return { room, player };
  }

  private startMatch(room: Room): void {
    room.match = new ServerMatch();
    room.clock.reset();
    this.broadcast(room, () => ({ type: "start", inputDelay: INPUT_DELAY }));
  }

  private reconnect(room: Room, player: PlayerIndex, connection: Connection) {
    const seat = room.seats[player];
    if (!seat) return undefined;
    seat.connection?.close();
    seat.connection = connection;
    connection.send({ type: "joined", room: room.code, player, token: seat.token });
    const match = room.match;
    if (match) {
      connection.send({
        type: "resume",
        inputs: match.confirmed,
        serverFrame: match.serverFrame,
        inputDelay: INPUT_DELAY,
      });
    }
    room.seats[player === 0 ? 1 : 0]?.connection?.send({ type: "opponent", connected: true });
    return { room, player };
  }

  private leave(room: Room, player: PlayerIndex, connection: Connection): void {
    const seat = room.seats[player];
    if (!seat || seat.connection !== connection) return; // already replaced by a reconnection
    seat.connection = undefined;
    seat.disconnectedAt = this.now();
    if (!room.match) {
      this.rooms.delete(room.code); // nobody joined yet: nothing to keep
      return;
    }
    room.seats[player === 0 ? 1 : 0]?.connection?.send({ type: "opponent", connected: false });
  }

  /** Closes rooms whose player did not come back in time, or finished long ago. */
  private expired(room: Room, nowMs: number): boolean {
    const finished =
      room.endedAt !== undefined && nowMs - room.endedAt > this.options.finishedRoomTtlMs;
    const abandoned = room.seats.some(
      (s) => s && !s.connection && nowMs - s.disconnectedAt > this.options.reconnectTimeoutMs,
    );
    if (!finished && !(abandoned && room.endedAt === undefined)) return false;
    if (!finished) {
      this.broadcast(room, () => ({ type: "error", reason: "opponent-left" }));
    }
    for (const s of room.seats) s?.connection?.close();
    this.rooms.delete(room.code);
    return true;
  }

  private broadcast(room: Room, message: (player: PlayerIndex) => ServerMessage): void {
    room.seats.forEach((s, player) => {
      s?.connection?.send(message(player as PlayerIndex));
    });
  }
}
