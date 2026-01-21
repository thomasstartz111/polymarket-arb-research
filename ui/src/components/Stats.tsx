import { useApi } from '../hooks/useApi';
import type { Stats as StatsType } from '../types';

export function Stats() {
  const { data, loading } = useApi<StatsType>('/api/stats');

  if (loading || !data) {
    return (
      <div className="bg-gray-800/50 border-b border-gray-700 px-4 py-2">
        <div className="max-w-7xl mx-auto flex gap-6 text-sm text-gray-400">
          Loading stats...
        </div>
      </div>
    );
  }

  const pnlColor =
    data.totalPnl > 0
      ? 'text-emerald-400'
      : data.totalPnl < 0
      ? 'text-red-400'
      : 'text-gray-400';

  return (
    <div className="bg-gray-800/50 border-b border-gray-700 px-4 py-2">
      <div className="max-w-7xl mx-auto flex gap-6 text-sm">
        <div>
          <span className="text-gray-400">Markets:</span>{' '}
          <span className="text-white font-medium">{data.markets}</span>
        </div>
        <div>
          <span className="text-gray-400">Snapshots:</span>{' '}
          <span className="text-white font-medium">
            {data.snapshots.toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-gray-400">Active Signals:</span>{' '}
          <span className="text-emerald-400 font-medium">
            {data.activeSignals}
          </span>
        </div>
        <div>
          <span className="text-gray-400">Trades:</span>{' '}
          <span className="text-white font-medium">{data.totalTrades}</span>
        </div>
        <div>
          <span className="text-gray-400">Win Rate:</span>{' '}
          <span className="text-white font-medium">
            {(data.winRate * 100).toFixed(0)}%
          </span>
          <span className="text-gray-500 text-xs ml-1">
            ({data.wins}W / {data.losses}L)
          </span>
        </div>
        <div>
          <span className="text-gray-400">Total P&L:</span>{' '}
          <span className={`font-medium ${pnlColor}`}>
            ${data.totalPnl.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-gray-400">Open:</span>{' '}
          <span className="text-amber-400 font-medium">
            ${data.openPositions.toFixed(0)}
          </span>
        </div>
      </div>
    </div>
  );
}
