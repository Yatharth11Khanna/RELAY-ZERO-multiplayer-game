import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  generatePuzzle,
  type PuzzleClue,
  type SignalSymbol,
} from "./puzzle";

export type RoomPhase = "lobby" | "playing" | "won" | "lost";

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
}

export interface RoomResult {
  reason: "solved" | "timeout" | "attempts";
  answer: SignalSymbol[];
  scoreDelta: number;
  score: number;
}

export interface PublicSubmission {
  attemptId: string;
  playerId: string;
  playerName: string;
  correct: boolean;
}

export interface PublicRoomState {
  roomCode: string;
  phase: RoomPhase;
  hostPlayerId: string;
  players: PublicPlayer[];
  roundId: string | null;
  roundNumber: number;
  deadlineAt: number | null;
  attemptsRemaining: number;
  score: number;
  result: RoomResult | null;
  lastSubmission: PublicSubmission | null;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  createdAt: number;
}

export interface PlayerCredentials {
  id: string;
  reconnectToken: string;
}

export type Ack<T extends object = {}> = (
  response: ({ ok: true } & T) | { ok: false; error: string },
) => void;

export interface ClientToServerEvents {
  "room:create": (payload: { name: string }, ack: Ack<{ room: PublicRoomState; player: PlayerCredentials }>) => void;
  "room:join": (payload: { code: string; name: string }, ack: Ack<{ room: PublicRoomState; player: PlayerCredentials }>) => void;
  "room:reconnect": (
    payload: { code: string; playerId: string; reconnectToken: string },
    ack: Ack<{ room: PublicRoomState; player: PlayerCredentials }>,
  ) => void;
  "game:start": (payload: { roomCode: string }, ack: Ack) => void;
  "game:submit": (
    payload: { roomCode: string; roundId: string; attemptId: string; sequence: string[] },
    ack: Ack<{ duplicate?: boolean; attemptsRemaining?: number }>,
  ) => void;
  "chat:send": (payload: { roomCode: string; message: string }, ack: Ack<{ message: ChatMessage }>) => void;
  "game:rematch": (payload: { roomCode: string }, ack: Ack) => void;
  "room:leave": (payload: { roomCode: string }, ack: Ack) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: PublicRoomState) => void;
  "game:private": (payload: { roundId: string; clues: PuzzleClue[] }) => void;
  "chat:message": (message: ChatMessage) => void;
  "game:submission": (payload: {
    roundId: string;
    attemptId: string;
    playerId: string;
    playerName: string;
    correct: boolean;
    attemptsRemaining: number;
  }) => void;
}

export interface SocketData {
  playerId?: string;
  roomCode?: string;
}

interface Player extends PublicPlayer {
  reconnectToken: string;
  socketId: string | null;
  disconnectTimer: NodeJS.Timeout | null;
}

interface Room {
  code: string;
  phase: RoomPhase;
  hostPlayerId: string;
  players: Map<string, Player>;
  roundId: string | null;
  roundNumber: number;
  deadlineAt: number | null;
  attemptsRemaining: number;
  score: number;
  answer: SignalSymbol[] | null;
  cluesByPlayer: Map<string, PuzzleClue[]>;
  result: RoomResult | null;
  lastSubmission: PublicSubmission | null;
  processedAttemptIds: Set<string>;
  roundTimer: NodeJS.Timeout | null;
}

export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type GameSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface GameServerOptions {
  roundDurationMs?: number;
  reconnectGraceMs?: number;
  now?: () => number;
  random?: () => number;
}

const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const MAX_NAME_LENGTH = 18;
const MAX_CHAT_LENGTH = 280;
const MAX_ATTEMPT_ID_LENGTH = 80;
const ROUND_ATTEMPTS = 3;
const ROUND_SCORE = 100;

function makeRoomCode(random: () => number): string {
  let code = "";

  for (let index = 0; index < 4; index += 1) {
    code += ROOM_CODE_ALPHABET[
      Math.floor(random() * ROOM_CODE_ALPHABET.length)
    ];
  }

  return code;
}

function normalizedName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.trim().replace(/\s+/g, " ");
  if (
    name.length === 0 ||
    Array.from(name).length > MAX_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    return null;
  }

  return name;
}

function normalizedRoomCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const code = value.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

function equalToken(expected: string, received: unknown): boolean {
  if (typeof received !== "string") {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function publicState(room: Room): PublicRoomState {
  return {
    roomCode: room.code,
    phase: room.phase,
    hostPlayerId: room.hostPlayerId,
    players: [...room.players.values()].map(({ id, name, connected }) => ({
      id,
      name,
      connected,
    })),
    roundId: room.roundId,
    roundNumber: room.roundNumber,
    deadlineAt: room.deadlineAt,
    attemptsRemaining: room.attemptsRemaining,
    score: room.score,
    result:
      room.phase === "won" || room.phase === "lost"
        ? room.result
        : null,
    lastSubmission: room.lastSubmission,
  };
}

function countConnectedPlayers(room: Room): number {
  return [...room.players.values()].filter((player) => player.connected).length;
}

export function createGameServer(
  io: GameSocketServer,
  options: GameServerOptions = {},
): {
  getStatus: () => {
    status: string;
    activeRooms: number;
    connectedPlayers: number;
    maxPlayersPerRoom: number;
  };
  dispose: () => void;
} {
  const rooms = new Map<string, Room>();
  const roundDurationMs = options.roundDurationMs ?? 75_000;
  const reconnectGraceMs = options.reconnectGraceMs ?? 120_000;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;

  function sendState(room: Room): void {
    io.to(room.code).emit("room:state", publicState(room));
  }

  function removePlayer(room: Room, playerId: string): void {
    const player = room.players.get(playerId);
    if (!player) {
      return;
    }

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
    }

    room.players.delete(playerId);
    room.cluesByPlayer.delete(playerId);

    if (room.hostPlayerId === playerId) {
      room.hostPlayerId =
        [...room.players.values()].find((candidate) => candidate.connected)?.id ??
        room.players.keys().next().value ??
        "";
    }

    if (room.players.size === 0) {
      if (room.roundTimer) {
        clearTimeout(room.roundTimer);
      }
      rooms.delete(room.code);
      return;
    }

    sendState(room);
  }

  function finishRound(
    room: Room,
    phase: "won" | "lost",
    reason: RoomResult["reason"],
  ): void {
    if (room.phase !== "playing" || !room.answer) {
      return;
    }

    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }

    const scoreDelta = phase === "won" ? ROUND_SCORE : 0;
    room.score += scoreDelta;
    room.phase = phase;
    room.deadlineAt = null;
    room.result = {
      reason,
      answer: [...room.answer],
      scoreDelta,
      score: room.score,
    };
    sendState(room);
  }

  function startRound(room: Room): void {
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }

    const playerIds = [...room.players.keys()];
    const puzzle = generatePuzzle(playerIds, random);

    room.phase = "playing";
    room.roundId = randomUUID();
    room.roundNumber += 1;
    room.deadlineAt = now() + roundDurationMs;
    room.attemptsRemaining = ROUND_ATTEMPTS;
    room.answer = puzzle.answer;
    room.cluesByPlayer = new Map(
      Object.entries(puzzle.cluesByPlayer),
    );
    room.result = null;
    room.lastSubmission = null;
    room.processedAttemptIds = new Set();

    for (const player of room.players.values()) {
      if (player.connected && player.socketId) {
        io.to(player.socketId).emit("game:private", {
          roundId: room.roundId,
          clues: room.cluesByPlayer.get(player.id) ?? [],
        });
      }
    }

    const currentRoundId = room.roundId;
    room.roundTimer = setTimeout(() => {
      if (room.roundId === currentRoundId && room.phase === "playing") {
        finishRound(room, "lost", "timeout");
      }
    }, roundDurationMs);
    room.roundTimer.unref?.();

    sendState(room);
  }

  function getSocketPlayer(
    socket: GameSocket,
    roomCodeValue: unknown,
  ): { room: Room; player: Player } | null {
    const roomCode = normalizedRoomCode(roomCodeValue);
    if (!roomCode || socket.data.roomCode !== roomCode || !socket.data.playerId) {
      return null;
    }

    const room = rooms.get(roomCode);
    const player = room?.players.get(socket.data.playerId);
    return room && player && player.socketId === socket.id
      ? { room, player }
      : null;
  }

  function assignSocket(
    socket: GameSocket,
    room: Room,
    player: Player,
  ): void {
    player.connected = true;
    player.socketId = socket.id;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }

    socket.data.playerId = player.id;
    socket.data.roomCode = room.code;
    void socket.join(room.code);

    if (room.phase === "playing" && room.roundId) {
      socket.emit("game:private", {
        roundId: room.roundId,
        clues: room.cluesByPlayer.get(player.id) ?? [],
      });
    }

    sendState(room);
  }

  function onDisconnect(socket: GameSocket): void {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) {
      return;
    }

    const room = rooms.get(roomCode);
    const player = room?.players.get(playerId);
    if (!room || !player || player.socketId !== socket.id) {
      return;
    }

    player.connected = false;
    player.socketId = null;
    sendState(room);
    player.disconnectTimer = setTimeout(() => {
      removePlayer(room, player.id);
    }, reconnectGraceMs);
    player.disconnectTimer.unref?.();
  }

  io.on("connection", (socket) => {
    socket.on("room:create", async (payload, acknowledge) => {
      const name = normalizedName(payload?.name);
      if (!name) {
        acknowledge({ ok: false, error: "Enter a display name up to 18 characters." });
        return;
      }

      if (socket.data.roomCode) {
        acknowledge({ ok: false, error: "Leave your current room before creating another." });
        return;
      }

      let code = makeRoomCode(random);
      let attempts = 0;
      while (rooms.has(code) && attempts < 100) {
        code = makeRoomCode(random);
        attempts += 1;
      }
      if (rooms.has(code)) {
        acknowledge({ ok: false, error: "Could not create a room. Try again." });
        return;
      }

      const player: Player = {
        id: randomUUID(),
        name,
        connected: true,
        reconnectToken: randomBytes(24).toString("hex"),
        socketId: socket.id,
        disconnectTimer: null,
      };
      const room: Room = {
        code,
        phase: "lobby",
        hostPlayerId: player.id,
        players: new Map([[player.id, player]]),
        roundId: null,
        roundNumber: 0,
        deadlineAt: null,
        attemptsRemaining: ROUND_ATTEMPTS,
        score: 0,
        answer: null,
        cluesByPlayer: new Map(),
        result: null,
        lastSubmission: null,
        processedAttemptIds: new Set(),
        roundTimer: null,
      };

      rooms.set(code, room);
      socket.data.playerId = player.id;
      socket.data.roomCode = code;
      await socket.join(code);
      sendState(room);
      acknowledge({
        ok: true,
        room: publicState(room),
        player: { id: player.id, reconnectToken: player.reconnectToken },
      });
    });

    socket.on("room:join", async (payload, acknowledge) => {
      const name = normalizedName(payload?.name);
      const code = normalizedRoomCode(payload?.code);
      if (!name) {
        acknowledge({ ok: false, error: "Enter a display name up to 18 characters." });
        return;
      }
      if (!code) {
        acknowledge({ ok: false, error: "Enter a valid four-character room code." });
        return;
      }
      if (socket.data.roomCode) {
        acknowledge({ ok: false, error: "Leave your current room before joining another." });
        return;
      }

      const room = rooms.get(code);
      if (!room) {
        acknowledge({ ok: false, error: "Room not found. Check the code and try again." });
        return;
      }
      if (room.phase === "playing") {
        acknowledge({ ok: false, error: "This round is already in progress." });
        return;
      }
      if (room.players.size >= MAX_PLAYERS) {
        acknowledge({ ok: false, error: "This room is full." });
        return;
      }

      const player: Player = {
        id: randomUUID(),
        name,
        connected: true,
        reconnectToken: randomBytes(24).toString("hex"),
        socketId: socket.id,
        disconnectTimer: null,
      };
      room.players.set(player.id, player);
      socket.data.playerId = player.id;
      socket.data.roomCode = code;
      await socket.join(code);
      sendState(room);
      acknowledge({
        ok: true,
        room: publicState(room),
        player: { id: player.id, reconnectToken: player.reconnectToken },
      });
    });

    socket.on("room:reconnect", async (payload, acknowledge) => {
      const code = normalizedRoomCode(payload?.code);
      if (!code || typeof payload?.playerId !== "string") {
        acknowledge({ ok: false, error: "Reconnect details are invalid." });
        return;
      }
      if (socket.data.roomCode) {
        acknowledge({ ok: false, error: "This connection is already in a room." });
        return;
      }

      const room = rooms.get(code);
      const player = room?.players.get(payload.playerId);
      if (!room || !player || !equalToken(player.reconnectToken, payload.reconnectToken)) {
        acknowledge({ ok: false, error: "Your room session has expired. Join the room again." });
        return;
      }

      const previousSocketId = player.socketId;
      if (previousSocketId && previousSocketId !== socket.id) {
        const previousSocket = io.sockets.sockets.get(previousSocketId) as GameSocket | undefined;
        if (previousSocket) {
          previousSocket.data.roomCode = undefined;
          previousSocket.data.playerId = undefined;
          previousSocket.disconnect(true);
        }
      }

      assignSocket(socket, room, player);
      acknowledge({
        ok: true,
        room: publicState(room),
        player: { id: player.id, reconnectToken: player.reconnectToken },
      });
    });

    socket.on("game:start", (payload, acknowledge) => {
      const membership = getSocketPlayer(socket, payload?.roomCode);
      if (!membership) {
        acknowledge({ ok: false, error: "You are not connected to that room." });
        return;
      }

      const { room, player } = membership;
      if (player.id !== room.hostPlayerId) {
        acknowledge({ ok: false, error: "Only the host can start the round." });
        return;
      }
      if (room.phase !== "lobby") {
        acknowledge({ ok: false, error: "This room is not ready to start a round." });
        return;
      }
      if (countConnectedPlayers(room) < MIN_PLAYERS) {
        acknowledge({ ok: false, error: "At least two players must be connected." });
        return;
      }

      startRound(room);
      acknowledge({ ok: true });
    });

    socket.on("game:submit", (payload, acknowledge) => {
      const membership = getSocketPlayer(socket, payload?.roomCode);
      if (!membership) {
        acknowledge({ ok: false, error: "You are not connected to that room." });
        return;
      }

      const { room, player } = membership;
      if (room.phase !== "playing" || !room.answer || !room.roundId) {
        acknowledge({ ok: false, error: "There is no active round." });
        return;
      }
      if (payload.roundId !== room.roundId) {
        acknowledge({ ok: false, error: "That submission belongs to an earlier round." });
        return;
      }
      if (
        typeof payload.attemptId !== "string" ||
        payload.attemptId.length === 0 ||
        payload.attemptId.length > MAX_ATTEMPT_ID_LENGTH
      ) {
        acknowledge({ ok: false, error: "Submission ID is invalid." });
        return;
      }
      if (room.processedAttemptIds.has(payload.attemptId)) {
        acknowledge({
          ok: true,
          duplicate: true,
          attemptsRemaining: room.attemptsRemaining,
        });
        return;
      }
      if (
        !Array.isArray(payload.sequence) ||
        payload.sequence.length !== 4 ||
        payload.sequence.some((symbol) => typeof symbol !== "string") ||
        new Set(payload.sequence).size !== 4 ||
        payload.sequence.some((symbol) => !["◆", "●", "▲", "■", "★", "⬢"].includes(symbol))
      ) {
        acknowledge({ ok: false, error: "Choose four different valid symbols." });
        return;
      }

      if (room.deadlineAt !== null && now() >= room.deadlineAt) {
        finishRound(room, "lost", "timeout");
        acknowledge({ ok: false, error: "Time is up." });
        return;
      }

      room.processedAttemptIds.add(payload.attemptId);
      const sequence = payload.sequence as SignalSymbol[];
      const correct = sequence.every(
        (symbol, index) => symbol === room.answer?.[index],
      );
      if (!correct) {
        room.attemptsRemaining -= 1;
      }

      room.lastSubmission = {
        attemptId: payload.attemptId,
        playerId: player.id,
        playerName: player.name,
        correct,
      };

      io.to(room.code).emit("game:submission", {
        roundId: room.roundId,
        attemptId: payload.attemptId,
        playerId: player.id,
        playerName: player.name,
        correct,
        attemptsRemaining: room.attemptsRemaining,
      });

      if (correct) {
        finishRound(room, "won", "solved");
      } else if (room.attemptsRemaining <= 0) {
        finishRound(room, "lost", "attempts");
      } else {
        sendState(room);
      }

      acknowledge({
        ok: true,
        duplicate: false,
        attemptsRemaining: room.attemptsRemaining,
      });
    });

    socket.on("chat:send", (payload, acknowledge) => {
      const membership = getSocketPlayer(socket, payload?.roomCode);
      if (!membership) {
        acknowledge({ ok: false, error: "You are not connected to that room." });
        return;
      }
      if (typeof payload?.message !== "string") {
        acknowledge({ ok: false, error: "Enter a message." });
        return;
      }

      const messageText = payload.message.trim();
      if (
        messageText.length === 0 ||
        Array.from(messageText).length > MAX_CHAT_LENGTH ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(messageText)
      ) {
        acknowledge({ ok: false, error: "Messages must be 1–280 characters." });
        return;
      }

      const message: ChatMessage = {
        id: randomUUID(),
        playerId: membership.player.id,
        playerName: membership.player.name,
        message: messageText,
        createdAt: now(),
      };
      io.to(membership.room.code).emit("chat:message", message);
      acknowledge({ ok: true, message });
    });

    socket.on("game:rematch", (payload, acknowledge) => {
      const membership = getSocketPlayer(socket, payload?.roomCode);
      if (!membership) {
        acknowledge({ ok: false, error: "You are not connected to that room." });
        return;
      }

      const { room } = membership;
      if (room.phase !== "won" && room.phase !== "lost") {
        acknowledge({ ok: false, error: "Finish the current round before rematching." });
        return;
      }
      if (countConnectedPlayers(room) < MIN_PLAYERS) {
        acknowledge({ ok: false, error: "At least two players must be connected to rematch." });
        return;
      }

      startRound(room);
      acknowledge({ ok: true });
    });

    socket.on("room:leave", (payload, acknowledge) => {
      const membership = getSocketPlayer(socket, payload?.roomCode);
      if (!membership) {
        acknowledge({ ok: false, error: "You are not connected to that room." });
        return;
      }

      const { room, player } = membership;
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      void socket.leave(room.code);
      removePlayer(room, player.id);
      acknowledge({ ok: true });
    });

    socket.on("disconnect", () => onDisconnect(socket));
  });

  return {
    getStatus: () => ({
      status: "ok",
      activeRooms: rooms.size,
      connectedPlayers: [...rooms.values()].reduce(
        (total, room) => total + countConnectedPlayers(room),
        0,
      ),
      maxPlayersPerRoom: MAX_PLAYERS,
    }),
    dispose: () => {
      for (const room of rooms.values()) {
        if (room.roundTimer) {
          clearTimeout(room.roundTimer);
        }
        for (const player of room.players.values()) {
          if (player.disconnectTimer) {
            clearTimeout(player.disconnectTimer);
          }
        }
      }
      rooms.clear();
    },
  };
}
