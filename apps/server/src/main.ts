import { buildApp } from "./app.ts";

/** Rooms are advanced on this period; the fixed-step clock turns it into exact 60 Hz frames. */
const TICK_INTERVAL_MS = 4;

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const { server, rooms } = await buildApp();
const ticker = setInterval(() => rooms.tick(performance.now()), TICK_INTERVAL_MS);

const shutdown = async () => {
  clearInterval(ticker);
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.listen({ port, host });
console.log(`Hitstop server listening on http://${host}:${port}`);
