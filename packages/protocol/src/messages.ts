import type { FrameInput, Input } from "@hitstop/sim";

/** Bumped on any breaking change to the wire format. Client and server must match. */
export const PROTOCOL_VERSION = 2;

/** Longest list of inputs accepted in one message (about one second). */
export const MAX_INPUTS_PER_MESSAGE = 64;
/** Longest confirmed history sent at once, when a player comes back (a whole match fits). */
export const MAX_HISTORY = 60 * 60 * 15;

export type PlayerIndex = 0 | 1;

/**
 * Client to server. Frame numbers are simulation frames: the input of frame f is the one used
 * by the step that produces the state of frame f (the first frame is 1).
 */
export type ClientMessage =
  | { type: "create"; version: number }
  | { type: "join"; version: number; room: string }
  | { type: "rejoin"; version: number; room: string; token: string }
  /** The sender's inputs for frames first, first + 1, ...; `ack` is the last confirmed frame it has. */
  | { type: "input"; first: number; inputs: Input[]; ack: number }
  | { type: "ping"; time: number };

export type ErrorReason =
  | "version-mismatch"
  | "room-not-found"
  | "room-full"
  | "bad-token"
  | "bad-message"
  | "opponent-left";

/** Server to client. */
export type ServerMessage =
  | { type: "joined"; room: string; player: PlayerIndex; token: string }
  /** The match starts: frame 1 begins when this message is received. */
  | { type: "start"; inputDelay: number }
  /**
   * Inputs of both players for frames first, first + 1, ..., final once sent. `ack` is the last
   * frame of the receiver's own inputs the server has; `serverFrame` is the server's clock.
   */
  | { type: "confirm"; first: number; inputs: FrameInput[]; ack: number; serverFrame: number }
  /** Sent after a reconnection: every confirmed input so far, to rebuild the match. */
  | { type: "resume"; inputs: FrameInput[]; serverFrame: number; inputDelay: number }
  | { type: "opponent"; connected: boolean }
  | { type: "end"; result: number; hash: number; frame: number }
  | { type: "error"; reason: ErrorReason }
  | { type: "pong"; time: number };

const ROOM_CODE = /^[A-Z0-9]{4}$/;
const MAX_INPUT = 0b111111;

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isFrame(value: unknown): value is number {
  return isInt(value, 0, 0x7fffffff);
}

function isInputList(value: unknown, maxLength: number): value is Input[] {
  return (
    Array.isArray(value) &&
    value.length <= maxLength &&
    value.every((input) => isInt(input, 0, MAX_INPUT))
  );
}

function isFrameInputList(value: unknown, maxLength: number): value is FrameInput[] {
  return (
    Array.isArray(value) &&
    value.length <= maxLength &&
    value.every((pair) => isInputList(pair, 2) && pair.length === 2)
  );
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Validates an untrusted message from a client. Returns undefined when it is malformed. */
export function parseClientMessage(text: string): ClientMessage | undefined {
  const m = parseObject(text);
  if (!m) return undefined;
  switch (m.type) {
    case "create":
      return isFrame(m.version) ? { type: "create", version: m.version } : undefined;
    case "join":
      return isFrame(m.version) && typeof m.room === "string" && ROOM_CODE.test(m.room)
        ? { type: "join", version: m.version, room: m.room }
        : undefined;
    case "rejoin":
      return isFrame(m.version) &&
        typeof m.room === "string" &&
        ROOM_CODE.test(m.room) &&
        typeof m.token === "string" &&
        m.token.length <= 64
        ? { type: "rejoin", version: m.version, room: m.room, token: m.token }
        : undefined;
    case "input":
      return isFrame(m.first) && isFrame(m.ack) && isInputList(m.inputs, MAX_INPUTS_PER_MESSAGE)
        ? { type: "input", first: m.first, inputs: m.inputs, ack: m.ack }
        : undefined;
    case "ping":
      return typeof m.time === "number" && Number.isFinite(m.time)
        ? { type: "ping", time: m.time }
        : undefined;
    default:
      return undefined;
  }
}

/** Validates a message from the server. */
export function parseServerMessage(text: string): ServerMessage | undefined {
  const m = parseObject(text);
  if (!m) return undefined;
  switch (m.type) {
    case "joined":
      return typeof m.room === "string" && isInt(m.player, 0, 1) && typeof m.token === "string"
        ? { type: "joined", room: m.room, player: m.player as PlayerIndex, token: m.token }
        : undefined;
    case "start":
      return isInt(m.inputDelay, 0, 30) ? { type: "start", inputDelay: m.inputDelay } : undefined;
    case "confirm":
      return isFrame(m.first) &&
        isFrame(m.ack) &&
        isFrame(m.serverFrame) &&
        isFrameInputList(m.inputs, MAX_HISTORY)
        ? {
            type: "confirm",
            first: m.first,
            inputs: m.inputs,
            ack: m.ack,
            serverFrame: m.serverFrame,
          }
        : undefined;
    case "resume":
      return isFrameInputList(m.inputs, MAX_HISTORY) &&
        isFrame(m.serverFrame) &&
        isInt(m.inputDelay, 0, 30)
        ? {
            type: "resume",
            inputs: m.inputs,
            serverFrame: m.serverFrame,
            inputDelay: m.inputDelay,
          }
        : undefined;
    case "opponent":
      return typeof m.connected === "boolean"
        ? { type: "opponent", connected: m.connected }
        : undefined;
    case "end":
      return isInt(m.result, 0, 3) && isInt(m.hash, 0, 0xffffffff) && isFrame(m.frame)
        ? { type: "end", result: m.result, hash: m.hash, frame: m.frame }
        : undefined;
    case "error":
      return typeof m.reason === "string"
        ? { type: "error", reason: m.reason as ErrorReason }
        : undefined;
    case "pong":
      return typeof m.time === "number" ? { type: "pong", time: m.time } : undefined;
    default:
      return undefined;
  }
}
