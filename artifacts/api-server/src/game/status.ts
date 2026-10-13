export interface GameStatus {
  status: string;
  activeRooms: number;
  connectedPlayers: number;
  maxPlayersPerRoom: number;
}

let statusProvider: () => GameStatus = () => ({
  status: "ok",
  activeRooms: 0,
  connectedPlayers: 0,
  maxPlayersPerRoom: 6,
});

export function setGameStatusProvider(provider: () => GameStatus): void {
  statusProvider = provider;
}

export function getGameStatus(): GameStatus {
  return statusProvider();
}
