import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { RoomRegistry } from "./rooms.ts";

/** A connection that answers no ping for this long is considered dead and closed. */
const HEARTBEAT_MS = 5000;
/** Largest message accepted from a client (a few KB at most in practice). */
const MAX_PAYLOAD = 16 * 1024;

export interface App {
  server: FastifyInstance;
  rooms: RoomRegistry;
}

export async function buildApp(rooms = new RoomRegistry(() => performance.now())): Promise<App> {
  const server = Fastify({ logger: false });
  await server.register(websocket, { options: { maxPayload: MAX_PAYLOAD } });

  server.get("/health", async () => ({ ok: true, rooms: rooms.size }));

  server.register(async (scoped) => {
    scoped.get("/ws", { websocket: true }, (socket) => {
      // Handlers are attached synchronously, as the @fastify/websocket docs require.
      const handler = rooms.attach({
        send: (message) => socket.send(JSON.stringify(message)),
        close: () => socket.close(),
      });
      let alive = true;
      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, HEARTBEAT_MS);
      socket.on("pong", () => {
        alive = true;
      });
      socket.on("message", (data) => handler.message(data.toString()));
      socket.on("close", () => {
        clearInterval(heartbeat);
        handler.close();
      });
    });
  });

  // injectWS (tests) does not load plugins by itself, unlike inject and listen.
  await server.ready();
  return { server, rooms };
}
