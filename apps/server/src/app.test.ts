import { PROTOCOL_VERSION, parseServerMessage, type ServerMessage } from "@hitstop/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type App, buildApp } from "./app.ts";

let app: App | undefined;
afterEach(async () => {
  await app?.server.close();
});

/** Collects the server messages of a test WebSocket, and waits for a given type. */
function inbox(socket: { on(event: "message", listener: (data: Buffer) => void): unknown }) {
  const messages: ServerMessage[] = [];
  const waiting: { type: string; resolve: (m: ServerMessage) => void }[] = [];
  socket.on("message", (data) => {
    const message = parseServerMessage(data.toString());
    if (!message) return;
    messages.push(message);
    const index = waiting.findIndex((w) => w.type === message.type);
    if (index !== -1) waiting.splice(index, 1)[0]?.resolve(message);
  });
  return {
    next: (type: ServerMessage["type"]) =>
      new Promise<ServerMessage>((resolve) => {
        const found = messages.find((m) => m.type === type);
        if (found) resolve(found);
        else waiting.push({ type, resolve });
      }),
  };
}

describe("WebSocket server", () => {
  it("answers the health check", async () => {
    app = await buildApp();
    const response = await app.server.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ ok: true, rooms: 0 });
  });

  it("lets two clients meet in a room and start a match", async () => {
    app = await buildApp();
    const host = await app.server.injectWS("/ws");
    const hostInbox = inbox(host);
    host.send(JSON.stringify({ type: "create", version: PROTOCOL_VERSION }));
    const joined = await hostInbox.next("joined");
    if (joined.type !== "joined") throw new Error("unexpected message");

    const guest = await app.server.injectWS("/ws");
    const guestInbox = inbox(guest);
    guest.send(JSON.stringify({ type: "join", version: PROTOCOL_VERSION, room: joined.room }));
    expect(await guestInbox.next("start")).toEqual({ type: "start", inputDelay: 2 });
    expect(await hostInbox.next("start")).toEqual({ type: "start", inputDelay: 2 });
    host.terminate();
    guest.terminate();
  });
});
