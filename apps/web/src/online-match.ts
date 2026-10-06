import {
  type ErrorReason,
  type LinkConditions,
  NetplayClient,
  type PlayerIndex,
  PROTOCOL_VERSION,
  ServerClock,
  type ServerMessage,
} from "@hitstop/protocol";
import { createInitialState, type FrameInput, hashState, type State } from "@hitstop/sim";
import { type ConnectionStatus, ServerConnection } from "./connection.ts";
import type { MatchSource } from "./game.ts";

/** Seat kept in the tab's session storage, to come back after a reload. */
interface SavedSeat {
  room: string;
  token: string;
}

const SAVED_SEAT = "hitstop.seat";
const PING_EVERY_FRAMES = 30;
const INITIAL_STATE = createInitialState();

export function savedSeat(room: string): SavedSeat | undefined {
  try {
    const seat = JSON.parse(sessionStorage.getItem(SAVED_SEAT) ?? "null") as SavedSeat | null;
    return seat?.room === room ? seat : undefined;
  } catch {
    return undefined;
  }
}

function saveSeat(seat: SavedSeat): void {
  try {
    sessionStorage.setItem(SAVED_SEAT, JSON.stringify(seat));
  } catch {
    // Storage unavailable (private mode): reconnection still works while the tab stays open.
  }
}

/** Everything the lobby and the tests need to know about an online match. */
export interface OnlineStatus {
  connection: ConnectionStatus;
  room: string | undefined;
  player: PlayerIndex | undefined;
  started: boolean;
  opponentConnected: boolean;
  error: ErrorReason | undefined;
  confirmedFrame: number;
  rollbacks: number;
  roundTripMs: number;
  /** Set once the server announced the end and every confirmed frame arrived. */
  end:
    | { hash: number; frame: number; result: number; settledHash: number; verified: boolean }
    | undefined;
}

/**
 * Online match seen from this browser: the connection, the seat, and the netcode client.
 * The local player plays with either keyboard side or the first gamepad.
 */
export class OnlineMatch implements MatchSource {
  private client: NetplayClient | undefined;
  private readonly connection: ServerConnection;
  private readonly serverClock = new ServerClock();
  private room: string | undefined;
  private player: PlayerIndex | undefined;
  private opponentConnected = true;
  private error: ErrorReason | undefined;
  private announcedEnd: Extract<ServerMessage, { type: "end" }> | undefined;
  private frames = 0;
  private endShown = false;
  private readonly onChange: () => void;

  constructor(url: string, link: LinkConditions, onChange: () => void) {
    this.onChange = onChange;
    this.connection = new ServerConnection(
      url,
      link,
      (message) => this.handle(message),
      () => onChange(),
    );
  }

  create(): void {
    this.connection.open({ type: "create", version: PROTOCOL_VERSION });
  }

  join(room: string): void {
    const seat = savedSeat(room);
    this.connection.open(
      seat
        ? { type: "rejoin", version: PROTOCOL_VERSION, room, token: seat.token }
        : { type: "join", version: PROTOCOL_VERSION, room },
    );
  }

  leave(): void {
    this.connection.close();
  }

  /** Cuts the connection as a network failure would (browser tests). */
  dropConnection(): void {
    this.connection.drop();
  }

  get state(): State {
    return this.client?.current ?? INITIAL_STATE;
  }

  get inputs(): readonly FrameInput[] {
    return this.client?.confirmed ?? [];
  }

  ticksFor(ticks: number, nowMs: number): number {
    return this.client ? this.serverClock.correct(ticks, this.client.current.frame, nowMs) : 0;
  }

  tick([keyboardLeft, keyboardRight]: FrameInput): void {
    this.client?.tick(keyboardLeft | keyboardRight);
  }

  /**
   * Sends our inputs once per display frame, however many ticks ran (up to hundreds when
   * catching up): each message carries every unacknowledged input anyway.
   */
  afterTicks(): void {
    const client = this.client;
    if (!client) return;
    this.connection.send(client.outgoing());
    if (++this.frames % PING_EVERY_FRAMES === 0) {
      this.connection.send({ type: "ping", time: performance.now() });
    }
  }

  status(): OnlineStatus {
    const client = this.client;
    const end = this.announcedEnd;
    let ended: OnlineStatus["end"];
    if (client && end && client.confirmedFrame >= end.frame) {
      const settledHash = hashState(client.settledState());
      ended = { ...end, settledHash, verified: settledHash === end.hash };
    }
    return {
      connection: this.connection.status,
      room: this.room,
      player: this.player,
      started: client !== undefined,
      opponentConnected: this.opponentConnected,
      error: this.error,
      confirmedFrame: client?.confirmedFrame ?? 0,
      rollbacks: client?.rollbacks ?? 0,
      roundTripMs: Math.round(this.serverClock.roundTripMs),
      end: ended,
    };
  }

  debugLines(): string[] {
    const s = this.status();
    return [
      `en ligne  J${(s.player ?? 0) + 1}  salon ${s.room ?? "-"}  ${s.connection}`,
      `ping ${s.roundTripMs} ms  confirmée ${s.confirmedFrame}  avance ${this.client?.prediction ?? 0}  rollbacks ${s.rollbacks}`,
    ];
  }

  private handle(message: ServerMessage): void {
    const now = performance.now();
    switch (message.type) {
      case "joined":
        this.room = message.room;
        this.player = message.player;
        saveSeat({ room: message.room, token: message.token });
        this.connection.enableReconnection(() => ({
          type: "rejoin",
          version: PROTOCOL_VERSION,
          room: message.room,
          token: message.token,
        }));
        break;
      case "start":
        if (this.player !== undefined) {
          this.client = new NetplayClient(this.player, message.inputDelay);
          this.serverClock.sync(0, now);
        }
        break;
      case "resume":
        if (this.player !== undefined) {
          this.client = new NetplayClient(this.player, message.inputDelay, message.inputs);
          this.serverClock.sync(message.serverFrame, now);
        }
        break;
      case "confirm":
        this.client?.confirm(message.first, message.inputs, message.ack, message.serverFrame);
        this.serverClock.onServerFrame(message.serverFrame, now);
        // Frequent: only tell the lobby when the end of the match can finally be checked.
        if (!this.endShown && this.status().end) break;
        return;
      case "pong":
        this.serverClock.onPong(message.time, now);
        return;
      case "opponent":
        this.opponentConnected = message.connected;
        break;
      case "end":
        this.announcedEnd = message;
        break;
      case "error":
        this.error = message.reason;
        break;
    }
    if (this.status().end) this.endShown = true;
    this.onChange();
  }
}
