import { createServer } from "node:http";
import { Server } from "socket.io";
import app from "./app";
import {
  createGameServer,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from "./game/server";
import { setGameStatusProvider } from "./game/status";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(httpServer, {
  path: "/api/socket.io",
});
const gameServer = createGameServer(io);
setGameStatusProvider(gameServer.getStatus);

httpServer.on("error", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
});

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});
