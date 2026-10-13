# RELAY ZERO

RELAY ZERO is a cooperative, real-time browser puzzle where 2–6 players share private clues to decode a four-symbol signal.

## Run & Operate

- Open the `artifacts/relay-zero: web` preview to play.
- The `artifacts/api-server: API Server` workflow provides the Socket.IO game server and status endpoints required by the web app.
- `pnpm --filter @workspace/api-server run test` — run puzzle and multiplayer server tests.
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the server.
- `pnpm --filter @workspace/relay-zero run typecheck` — typecheck the client.
- `PORT=5173 BASE_PATH=/relay-zero pnpm --filter @workspace/relay-zero run build` — create the production client bundle.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and schemas from the OpenAPI spec.
- Replit’s managed artifact workflows provide `PORT` and `BASE_PATH`; no database or external service setup is required.

## Stack

- pnpm workspaces, Node.js, TypeScript
- Client: React, Vite, Socket.IO client
- Server: Express, Socket.IO, TypeScript
- API status contract and generated React Query hooks: OpenAPI + Orval

## Where things live

- `artifacts/relay-zero/src` — player-facing game UI and Socket.IO client.
- `artifacts/api-server/src/game` — authoritative game state, puzzle generation, scoring, and tests.
- `lib/api-spec/openapi.yaml` — REST API contract used to generate the status hooks.

## Architecture decisions

- The server owns answers, deadlines, attempts, room membership, and scores; clients only receive public state plus their own private clues.
- Game rooms live in server memory and are not persisted to a database.
- Reconnect credentials are kept in the player’s browser so they can rejoin a live room during its reconnect window.

## Product

- Create or join a room with a four-character code; the host starts once at least two players are connected.
- Collaborate through private clues and room chat to submit a four-symbol sequence within 75 seconds and three attempts.
- View server-scored results and start another round with the room.

## User preferences

No additional user preferences recorded.

## Gotchas

Room state is in memory: restarting the API server ends active rooms. Use the managed artifact workflows so the web client and `/api` routes are served through the same preview.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
