import { Activity, Radio, Users } from 'lucide-react';
import { useGetGameStatus, useHealthCheck } from '@workspace/api-client-react';

export function ServerStatus({ socketState }: { socketState: string }) {
  const health = useHealthCheck({
    query: { queryKey: ['/api/healthz'], refetchInterval: 30000 },
  });
  const game = useGetGameStatus({
    query: { queryKey: ['/api/game/status'], refetchInterval: 30000 },
  });
  const healthUp = health.data?.status?.toLowerCase() === 'ok' || health.data?.status?.toLowerCase() === 'healthy';
  const gameUp = game.data?.status?.toLowerCase() === 'ok' || game.data?.status?.toLowerCase() === 'ready' || game.data?.status?.toLowerCase() === 'healthy';
  const socketLive = socketState === 'connected';
  return (
    <div className="status-strip" data-testid="status-server">
      <div className="status-chip" data-testid="status-socket">
        <span className={`status-dot ${socketLive ? 'is-live' : 'is-waiting'}`} />
        <Radio size={13} />
        <span>{socketState === 'connected' ? 'Signal linked' : socketState === 'offline' ? 'Signal offline' : 'Reconnecting'}</span>
      </div>
      <div className="status-chip" data-testid="status-health">
        <Activity size={13} />
        <span>Core {health.isLoading ? 'checking' : healthUp ? 'online' : health.isError ? 'unavailable' : 'standby'}</span>
      </div>
      <div className="status-chip status-players" data-testid="status-game-server">
        <Users size={13} />
        <span>{game.isLoading ? 'Room network checking' : game.data ? `${game.data.activeRooms} rooms · ${game.data.connectedPlayers} online` : game.isError ? 'Room network unavailable' : 'Room network standby'}</span>
      </div>
    </div>
  );
}
