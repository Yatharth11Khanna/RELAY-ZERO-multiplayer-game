import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { io as createClient, type Socket } from "socket.io-client";
import { Server } from "socket.io";
import {
  createGameServer,
  type Ack,
  type ChatMessage,
  type ClientToServerEvents,
  type GameSocketServer,
  type PublicRoomState,
  type ServerToClientEvents,
  type SocketData,
} from "./server";
import {
  solveClues,
  type PuzzleClue,
  type SignalSymbol,
} from "./puzzle";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type RoomResponse = Parameters<
  Ack<{ room: PublicRoomState; player: { id: string; reconnectToken: string } }>
>[0];
type BasicResponse = Parameters<Ack>[0];
type SubmitResponse = Parameters<
  Ack<{ duplicate?: boolean; attemptsRemaining?: number }>
>[0];
type ChatResponse = Parameters<Ack<{ message: ChatMessage }>>[0];

function createFixture(options?: {
  roundDurationMs?: number;
  reconnectGraceMs?: number;
}): Promise<{
  connect: () => Promise<Client>;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const httpServer = createHttpServer();
    const io = new Server<
      ClientToServerEvents,
      ServerToClientEvents,
      Record<string, never>,
      SocketData
    >(httpServer, { path: "/api/socket.io" });
    const game = createGameServer(io as GameSocketServer, options);
    const clients: Client[] = [];

    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      if (!address || typeof address === "string") {
        reject(new Error("The test server did not bind to a TCP port."));
        return;
      }

      const connect = async (): Promise<Client> => {
        const client = createClient(`http://127.0.0.1:${address.port}`, {
          path: "/api/socket.io",
          transports: ["websocket"],
          reconnection: false,
        });
        clients.push(client);
        await new Promise<void>((connected, connectionError) => {
          const timer = setTimeout(
            () => connectionError(new Error("Socket client connection timed out.")),
            2_000,
          );
          client.once("connect", () => {
            clearTimeout(timer);
            connected();
          });
          client.once("connect_error", (error) => {
            clearTimeout(timer);
            connectionError(error);
          });
        });
        return client;
      };

      const close = async (): Promise<void> => {
        game.dispose();
        clients.forEach((client) => client.disconnect());
        await new Promise<void>((closed) => io.close(() => closed()));
      };

      resolve({ connect, close });
    });
  });
}

function onceRoomState(
  client: Client,
  predicate: (value: PublicRoomState) => boolean,
): Promise<PublicRoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for room state.")),
      2_000,
    );
    const listener = (value: PublicRoomState) => {
      if (predicate(value)) {
        clearTimeout(timer);
        client.off("room:state", listener);
        resolve(value);
      }
    };
    client.on("room:state", listener);
  });
}

function oncePrivateClues(
  client: Client,
): Promise<{ roundId: string; clues: PuzzleClue[] }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for private clues.")),
      2_000,
    );
    const listener = (value: { roundId: string; clues: PuzzleClue[] }) => {
      clearTimeout(timer);
      client.off("game:private", listener);
      resolve(value);
    };
    client.on("game:private", listener);
  });
}

function onceChatMessage(
  client: Client,
  predicate: (value: ChatMessage) => boolean,
): Promise<ChatMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for a chat message.")),
      2_000,
    );
    const listener = (value: ChatMessage) => {
      if (predicate(value)) {
        clearTimeout(timer);
        client.off("chat:message", listener);
        resolve(value);
      }
    };
    client.on("chat:message", listener);
  });
}

function createRoom(client: Client, name: string): Promise<RoomResponse> {
  return new Promise((resolve) => {
    client.emit("room:create", { name }, resolve);
  });
}

function joinRoom(
  client: Client,
  code: string,
  name: string,
): Promise<RoomResponse> {
  return new Promise((resolve) => {
    client.emit("room:join", { code, name }, resolve);
  });
}

function startGame(client: Client, roomCode: string): Promise<BasicResponse> {
  return new Promise((resolve) => {
    client.emit("game:start", { roomCode }, resolve);
  });
}

function submit(
  client: Client,
  payload: {
    roomCode: string;
    roundId: string;
    attemptId: string;
    sequence: string[];
  },
): Promise<SubmitResponse> {
  return new Promise((resolve) => {
    client.emit("game:submit", payload, resolve);
  });
}

function sendChat(
  client: Client,
  roomCode: string,
  message: string,
): Promise<ChatResponse> {
  return new Promise((resolve) => {
    client.emit("chat:send", { roomCode, message }, resolve);
  });
}

function cluesFrom(privateClues: readonly PuzzleClue[]): SignalSymbol[] {
  const solutions = solveClues(privateClues);
  return solutions[0] ?? [];
}

test("two socket sessions complete a round, consume attempts, score, and rematch", async (context) => {
  const fixture = await createFixture();
  context.after(fixture.close);

  const host = await fixture.connect();
  const teammate = await fixture.connect();
  const created = await createRoom(host, "Signal Host");
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const joined = await joinRoom(teammate, created.room.roomCode, "Cipher");
  assert.equal(joined.ok, true);
  if (!joined.ok) {
    return;
  }

  const hostPrivate = oncePrivateClues(host);
  const teammatePrivate = oncePrivateClues(teammate);
  const startedState = onceRoomState(
    host,
    (state: PublicRoomState) => state.phase === "playing",
  );
  const started = await startGame(host, created.room.roomCode);
  assert.equal(started.ok, true);

  const [hostClues, teammateClues, playing] = await Promise.all([
    hostPrivate,
    teammatePrivate,
    startedState,
  ]);
  assert.equal(hostClues.roundId, playing.roundId);
  assert.equal(teammateClues.roundId, playing.roundId);
  assert.ok(hostClues.clues.length > 0);
  assert.ok(teammateClues.clues.length > 0);

  const chatOnTeammate = onceChatMessage(
    teammate,
    (message: ChatMessage) => message.message === "I have a position clue.",
  );
  const chatResponse = await sendChat(
    host,
    created.room.roomCode,
    "  I have a position clue.  ",
  );
  assert.equal(chatResponse.ok, true);
  assert.equal((await chatOnTeammate).playerName, "Signal Host");
  if (!chatResponse.ok) {
    return;
  }

  const clues = [...hostClues.clues, ...teammateClues.clues];
  const answer = cluesFrom(clues);
  assert.equal(answer.length, 4);
  assert.equal(solveClues(clues).length, 1);

  const invalid = await submit(host, {
    roomCode: created.room.roomCode,
    roundId: playing.roundId ?? "",
    attemptId: "invalid-shape",
    sequence: ["◆", "◆", "▲", "■"],
  });
  assert.equal(invalid.ok, false);

  const wrongSequence = [answer[1], answer[2], answer[3], answer[0]];
  const failedState = onceRoomState(
    teammate,
    (state: PublicRoomState) =>
      state.phase === "playing" && state.attemptsRemaining === 2,
  );
  const firstSubmission = await submit(host, {
    roomCode: created.room.roomCode,
    roundId: playing.roundId ?? "",
    attemptId: "attempt-one",
    sequence: wrongSequence,
  });
  assert.equal(firstSubmission.ok, true);
  if (!firstSubmission.ok) {
    return;
  }
  assert.equal(firstSubmission.attemptsRemaining, 2);
  await failedState;

  const duplicate = await submit(host, {
    roomCode: created.room.roomCode,
    roundId: playing.roundId ?? "",
    attemptId: "attempt-one",
    sequence: wrongSequence,
  });
  assert.equal(duplicate.ok, true);
  if (duplicate.ok) {
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.attemptsRemaining, 2);
  }

  const resultState = onceRoomState(
    teammate,
    (state: PublicRoomState) => state.phase === "won",
  );
  const winningSubmission = await submit(host, {
    roomCode: created.room.roomCode,
    roundId: playing.roundId ?? "",
    attemptId: "attempt-two",
    sequence: answer,
  });
  assert.equal(winningSubmission.ok, true);
  const won = await resultState;
  assert.equal(won.result?.reason, "solved");
  assert.equal(won.result?.scoreDelta, 100);
  assert.equal(won.score, 100);
  assert.deepEqual(won.result?.answer, answer);

  const rematchPrivate = oncePrivateClues(host);
  const rematchState = onceRoomState(
    host,
    (state: PublicRoomState) => state.phase === "playing" && state.roundNumber === 2,
  );
  const rematch = await new Promise<BasicResponse>((resolve) => {
    host.emit("game:rematch", { roomCode: created.room.roomCode }, resolve);
  });
  assert.equal(rematch.ok, true);
  const [rematchClues, roundTwo] = await Promise.all([
    rematchPrivate,
    rematchState,
  ]);
  assert.equal(rematchClues.roundId, roundTwo.roundId);
  assert.equal(roundTwo.attemptsRemaining, 3);
  assert.equal(roundTwo.score, 100);
});

test("six players each receive private clues and the room rejects a seventh player", async (context) => {
  const fixture = await createFixture();
  context.after(fixture.close);

  const clients = await Promise.all(
    Array.from({ length: 7 }, () => fixture.connect()),
  );
  const created = await createRoom(clients[0], "Host");
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  for (let index = 1; index < 6; index += 1) {
    const joined = await joinRoom(
      clients[index],
      created.room.roomCode,
      `Player ${index}`,
    );
    assert.equal(joined.ok, true);
  }

  const seventh = await joinRoom(
    clients[6],
    created.room.roomCode,
    "Seventh",
  );
  assert.equal(seventh.ok, false);

  const clueEvents = clients.slice(0, 6).map(oncePrivateClues);
  const started = await startGame(clients[0], created.room.roomCode);
  assert.equal(started.ok, true);
  const clues = await Promise.all(clueEvents);

  assert.ok(clues.every((payload) => payload.clues.length > 0));
  assert.equal(new Set(clues.map((payload) => payload.roundId)).size, 1);
  assert.equal(clues.flatMap((payload) => payload.clues).length, 10);
});

test("the server ends a round when time expires and reveals the answer only afterward", async (context) => {
  const fixture = await createFixture({ roundDurationMs: 35 });
  context.after(fixture.close);

  const host = await fixture.connect();
  const teammate = await fixture.connect();
  const created = await createRoom(host, "Host");
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const joined = await joinRoom(teammate, created.room.roomCode, "Teammate");
  assert.equal(joined.ok, true);

  const privateClue = oncePrivateClues(host);
  const resultState = onceRoomState(
    teammate,
    (state: PublicRoomState) => state.phase === "lost",
  );
  const started = await startGame(host, created.room.roomCode);
  assert.equal(started.ok, true);

  const [privateData, result] = await Promise.all([privateClue, resultState]);
  assert.equal(privateData.roundId, result.roundId);
  assert.equal(result.result?.reason, "timeout");
  assert.equal(result.result?.answer.length, 4);
});
