import {
  type ClientMessage,
  ConditionedLink,
  type LinkConditions,
  parseServerMessage,
  type ServerMessage,
} from "@hitstop/protocol";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

/** How long to keep trying after the connection is cut (the server keeps the seat 30 s). */
const RECONNECT_FOR_MS = 30_000;
const RECONNECT_EVERY_MS = 1000;

/**
 * WebSocket to the game server, through the network simulator (no effect with default settings).
 * When the connection drops, it reconnects and sends the `rejoin` message given by the match.
 */
export class ServerConnection {
  status: ConnectionStatus = "connecting";
  private socket: WebSocket | undefined;
  private readonly up: ConditionedLink;
  private readonly down: ConditionedLink;
  private rejoin: (() => ClientMessage) | undefined;
  private cutAt = 0;
  private closedOnPurpose = false;
  private readonly url: string;
  private readonly onMessage: (message: ServerMessage) => void;
  private readonly onStatus: (status: ConnectionStatus) => void;

  constructor(
    url: string,
    link: LinkConditions,
    onMessage: (message: ServerMessage) => void,
    onStatus: (status: ConnectionStatus) => void,
  ) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    const now = () => performance.now();
    const schedule = (callback: () => void, delayMs: number) => {
      setTimeout(callback, delayMs);
    };
    this.up = new ConditionedLink(link, Math.random, now, schedule);
    this.down = new ConditionedLink(link, Math.random, now, schedule);
  }

  /** Opens the connection and sends `first` (create, join or rejoin) once it is open. */
  open(first: ClientMessage): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.setStatus("open");
      this.send(first);
    });
    socket.addEventListener("message", (event) => {
      const message = parseServerMessage(String(event.data));
      if (message) this.down.send(() => this.onMessage(message), message.type === "confirm");
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.onClose();
    });
  }

  /** Message to send after a reconnection, once the match has given us a seat. */
  enableReconnection(rejoin: () => ClientMessage): void {
    this.rejoin = rejoin;
  }

  /**
   * Sends through the current socket only: messages written while (re)connecting are dropped,
   * so nothing can reach the server before the create, join or rejoin message.
   */
  send(message: ClientMessage): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    this.up.send(() => {
      if (socket === this.socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    }, message.type === "input");
  }

  /** Cuts the connection as a network failure would (browser tests). */
  drop(): void {
    this.socket?.close();
  }

  close(): void {
    this.closedOnPurpose = true;
    this.rejoin = undefined;
    this.socket?.close();
    this.setStatus("closed");
  }

  private onClose(): void {
    if (this.closedOnPurpose || !this.rejoin) {
      this.setStatus("closed");
      return;
    }
    if (this.status !== "reconnecting") this.cutAt = performance.now();
    if (performance.now() - this.cutAt > RECONNECT_FOR_MS) {
      this.setStatus("closed");
      return;
    }
    this.setStatus("reconnecting");
    const rejoin = this.rejoin;
    setTimeout(() => {
      if (!this.closedOnPurpose) this.open(rejoin());
    }, RECONNECT_EVERY_MS);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}
