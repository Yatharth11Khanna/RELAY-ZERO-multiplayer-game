import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type Phase = "lobby" | "playing" | "won" | "lost";
export type SignalSymbol = "◆" | "●" | "▲" | "■" | "★" | "⬢";

export type Player = {
  id: string;
  name: string;
  connected: boolean;
};

export type RoomResult = {
  reason: "solved" | "timeout" | "attempts";
  answer: SignalSymbol[];
  scoreDelta: number;
  score: number;
};

export type PublicSubmission = {
  attemptId: string;
  playerId: string;
  playerName: string;
  correct: boolean;
};

export type RoomSnapshot = {
  roomCode: string;
  phase: Phase;
  hostPlayerId: string;
  players: Player[];
  roundId: string | null;
  roundNumber: number;
  deadlineAt: number | null;
  attemptsRemaining: number;
  score: number;
  result: RoomResult | null;
  lastSubmission: PublicSubmission | null;
};

export type Clue = {
  id: string;
  kind: "position" | "included" | "excluded";
  position?: number;
  symbol: SignalSymbol;
  text: string;
};

export type RoomMessage = {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  createdAt: number;
};

type PlayerCredentials = {
  id: string;
  reconnectToken: string;
};

type StoredCredentials = PlayerCredentials & {
  roomCode: string;
};

type AckResponse<T extends object = {}> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
type AckCallback<T extends object = {}> = (
  response: AckResponse<T>,
) => void;

type ClientToServerEvents = {
  "room:create": (
    payload: { name: string },
    ack: AckCallback<{ room: RoomSnapshot; player: PlayerCredentials }>,
  ) => void;
  "room:join": (
    payload: { code: string; name: string },
    ack: AckCallback<{ room: RoomSnapshot; player: PlayerCredentials }>,
  ) => void;
  "room:reconnect": (
    payload: {
      code: string;
      playerId: string;
      reconnectToken: string;
    },
    ack: AckCallback<{ room: RoomSnapshot; player: PlayerCredentials }>,
  ) => void;
  "game:start": (payload: { roomCode: string }, ack: AckCallback) => void;
  "game:submit": (
    payload: {
      roomCode: string;
      roundId: string;
      attemptId: string;
      sequence: string[];
    },
    ack: AckCallback<{ duplicate?: boolean; attemptsRemaining?: number }>,
  ) => void;
  "chat:send": (
    payload: { roomCode: string; message: string },
    ack: AckCallback<{ message: RoomMessage }>,
  ) => void;
  "game:rematch": (payload: { roomCode: string }, ack: AckCallback) => void;
  "room:leave": (payload: { roomCode: string }, ack: AckCallback) => void;
};

type ServerToClientEvents = {
  "room:state": (state: RoomSnapshot) => void;
  "game:private": (payload: { roundId: string; clues: Clue[] }) => void;
  "chat:message": (message: RoomMessage) => void;
  "game:submission": (payload: {
    roundId: string;
    attemptId: string;
    playerId: string;
    playerName: string;
    correct: boolean;
    attemptsRemaining: number;
  }) => void;
};

type RelaySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const credentialKey = "relay-zero-credentials";

function readCredentials(): StoredCredentials | null {
  try {
    const raw = window.localStorage.getItem(credentialKey);
    if (!raw) {
      return null;
    }

    const value = JSON.parse(raw) as Partial<StoredCredentials>;
    if (
      typeof value.roomCode === "string" &&
      typeof value.id === "string" &&
      typeof value.reconnectToken === "string"
    ) {
      return {
        roomCode: value.roomCode,
        id: value.id,
        reconnectToken: value.reconnectToken,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function persistCredentials(
  roomCode: string,
  player: PlayerCredentials,
): void {
  window.localStorage.setItem(
    credentialKey,
    JSON.stringify({
      roomCode,
      id: player.id,
      reconnectToken: player.reconnectToken,
    } satisfies StoredCredentials),
  );
}

export function useRelaySocket() {
  const socketRef = useRef<RelaySocket | null>(null);
  const privateRoundRef = useRef<string | null>(null);
  const activeRoomRef = useRef<string | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting" | "offline"
  >("connecting");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [clues, setClues] = useState<Clue[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(
    () => readCredentials()?.id ?? null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submission, setSubmission] = useState<{
    attemptsRemaining: number;
    correct: boolean;
  } | null>(null);

  useEffect(() => {
    const socket = io({
      path: "/api/socket.io",
      autoConnect: true,
    }) as unknown as RelaySocket;
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnection("connected");
      const credentials = readCredentials();

      if (!credentials) {
        return;
      }

      setConnection("reconnecting");
      socket.emit(
        "room:reconnect",
        {
          code: credentials.roomCode,
          playerId: credentials.id,
          reconnectToken: credentials.reconnectToken,
        },
        (ack) => {
          if (ack.ok) {
            setPlayerId(ack.player.id);
            setRoom(ack.room);
            setConnection("connected");
            setError("");
          } else {
            window.localStorage.removeItem(credentialKey);
            setPlayerId(null);
            setRoom(null);
            setClues([]);
            setError(ack.error);
            setConnection("connected");
          }
        },
      );
    });

    socket.on("disconnect", () => {
      setConnection("reconnecting");
    });

    socket.on("connect_error", () => {
      setConnection("offline");
    });

    socket.io.on("reconnect_attempt", () => {
      setConnection("reconnecting");
    });

    socket.on("room:state", (snapshot) => {
      if (activeRoomRef.current !== snapshot.roomCode) {
        activeRoomRef.current = snapshot.roomCode;
        setMessages([]);
      }

      setRoom(snapshot);
      setError("");

      if (snapshot.phase !== "playing") {
        privateRoundRef.current = null;
        setClues([]);
      } else if (privateRoundRef.current !== snapshot.roundId) {
        setClues([]);
      }
    });

    socket.on("game:private", (payload) => {
      privateRoundRef.current = payload.roundId;
      setClues(payload.clues);
    });

    socket.on("chat:message", (message) => {
      setMessages((current) =>
        current.some((item) => item.id === message.id)
          ? current
          : [...current, message].slice(-80),
      );
    });

    socket.on("game:submission", (payload) => {
      setSubmission({
        attemptsRemaining: payload.attemptsRemaining,
        correct: payload.correct,
      });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const request = useCallback(
    <T extends object = {}>(
      send: (socket: RelaySocket, ack: (response: AckResponse<T>) => void) => void,
    ): Promise<AckResponse<T>> =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          const response: AckResponse<T> = {
            ok: false,
            error: "Connection unavailable",
          };
          setError("Connection is unavailable. Wait for the signal to return.");
          resolve(response);
          return;
        }

        setBusy(true);
        setError("");
        send(socket, (ack) => {
          setBusy(false);
          if (!ack.ok) {
            setError(ack.error);
          }
          resolve(ack);
        });
      }),
    [],
  );

  const createRoom = useCallback(
    async (name: string) => {
      const ack = await request<{
        room: RoomSnapshot;
        player: PlayerCredentials;
      }>((socket, done) => socket.emit("room:create", { name }, done));

      if (ack.ok) {
        persistCredentials(ack.room.roomCode, ack.player);
        setPlayerId(ack.player.id);
        setRoom(ack.room);
      }

      return ack;
    },
    [request],
  );

  const joinRoom = useCallback(
    async (code: string, name: string) => {
      const ack = await request<{
        room: RoomSnapshot;
        player: PlayerCredentials;
      }>((socket, done) => socket.emit("room:join", { code, name }, done));

      if (ack.ok) {
        persistCredentials(ack.room.roomCode, ack.player);
        setPlayerId(ack.player.id);
        setRoom(ack.room);
      }

      return ack;
    },
    [request],
  );

  const startGame = useCallback(() => {
    if (!room?.roomCode) {
      return Promise.resolve({
        ok: false as const,
        error: "Join a room before starting.",
      });
    }
    return request((socket, done) =>
      socket.emit("game:start", { roomCode: room.roomCode }, done),
    );
  }, [request, room?.roomCode]);

  const sendChat = useCallback(
    (message: string) => {
      if (!room?.roomCode) {
        return Promise.resolve({
          ok: false as const,
          error: "Join a room before sending a message.",
        });
      }
      return request<{ message: RoomMessage }>((socket, done) =>
        socket.emit("chat:send", { roomCode: room.roomCode, message }, done),
      );
    },
    [request, room?.roomCode],
  );

  const rematch = useCallback(() => {
    if (!room?.roomCode) {
      return Promise.resolve({
        ok: false as const,
        error: "Join a room before starting a rematch.",
      });
    }
    return request((socket, done) =>
      socket.emit("game:rematch", { roomCode: room.roomCode }, done),
    );
  }, [request, room?.roomCode]);

  const leaveRoom = useCallback(async () => {
    const currentRoomCode = room?.roomCode;
    if (currentRoomCode) {
      await request((socket, done) =>
        socket.emit("room:leave", { roomCode: currentRoomCode }, done),
      );
    }
    window.localStorage.removeItem(credentialKey);
    activeRoomRef.current = null;
    privateRoundRef.current = null;
    setRoom(null);
    setClues([]);
    setMessages([]);
    setSubmission(null);
    setPlayerId(null);
  }, [request, room?.roomCode]);

  const submitSequence = useCallback(
    (roundId: string, sequence: string[]) => {
      if (!room?.roomCode) {
        return Promise.resolve({
          ok: false as const,
          error: "Join a room before submitting.",
        });
      }
      const attemptId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      return request<{ duplicate?: boolean; attemptsRemaining?: number }>(
        (socket, done) =>
          socket.emit(
            "game:submit",
            {
              roomCode: room.roomCode,
              roundId,
              attemptId,
              sequence,
            },
            done,
          ),
      );
    },
    [request, room?.roomCode],
  );

  const retryConnection = useCallback(() => {
    setConnection("reconnecting");
    socketRef.current?.connect();
  }, []);

  return {
    connection,
    room,
    clues,
    messages,
    playerId,
    error,
    busy,
    submission,
    createRoom,
    joinRoom,
    startGame,
    sendChat,
    rematch,
    leaveRoom,
    submitSequence,
    clearError: () => setError(""),
    retryConnection,
  };
}
