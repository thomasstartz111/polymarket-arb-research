import { useApi } from '../hooks/useApi';
import type { RankedSignal } from '../types';

interface Props {
  onSelectMarket: (id: string) => void;
  selectedMarket: string | null;
}

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  complement: 'bg-purple-600',
  anchoring: 'bg-amber-600',
  low_attention: 'bg-blue-600',
  deadline: 'bg-red-600',
};

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  complement: 'Arbitrage',
  anchoring: 'Mean Revert',
  low_attention: 'Low Attention',
  deadline: 'Deadline',
};

export function SignalQueue({ onSelectMarket, selectedMarket }: Props) {
  const { data, loading, error } = useApi<{ signals: RankedSignal[] }>(
    '/api/signals?limit=30'
  );

  if (loading && !data) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/3 mb-4"></div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-20 bg-gray-700 rounded mb-2"></div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
        <p className="text-red-400">Error loading signals: {error}</p>
      </div>
    );
  }

  const signals = data?.signals || [];

  return (
    <div className="bg-gray-800 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h2 className="font-semibold">Signal Queue</h2>
        <span className="text-sm text-gray-400">{signals.length} active</span>
      </div>

      <div className="divide-y divide-gray-700 max-h-[calc(100vh-250px)] overflow-y-auto">
        {signals.map((ranked) => {
          const signal = ranked.signal;
          const typeColor =
            SIGNAL_TYPE_COLORS[signal.signalType] || 'bg-gray-600';
          const typeLabel =
            SIGNAL_TYPE_LABELS[signal.signalType] || signal.signalType;

          return (
            <button
              key={signal.signalId}
              onClick={() => onSelectMarket(signal.marketId)}
              className={`w-full text-left px-4 py-3 hover:bg-gray-700/50 transition ${
                selectedMarket === signal.marketId ? 'bg-gray-700' : ''
              }`}
            >
              {/* Header Row */}
              <div className="flex items-center gap-2 mb-1">
                {/* Strength badge */}
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-bold ${
                    signal.strength === 'strong'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-yellow-600 text-white'
                  }`}
                >
                  {signal.strength === 'strong' ? 'STRONG' : 'WEAK'}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${typeColor}`}
                >
                  {typeLabel}
                </span>
                <span className="text-sm font-medium text-emerald-400">
                  {(ranked.compositeScore * 100).toFixed(0)}%
                </span>
                {signal.direction && (
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      signal.direction === 'buy_yes'
                        ? 'bg-emerald-900 text-emerald-300'
                        : 'bg-red-900 text-red-300'
                    }`}
                  >
                    {signal.direction === 'buy_yes' ? '↑ YES' : '↓ NO'}
                  </span>
                )}
                {signal.edgeCents !== 0 && (
                  <span className="text-xs text-gray-400">
                    {signal.edgeCents > 0 ? '+' : ''}{signal.edgeCents.toFixed(1)}¢
                  </span>
                )}
              </div>

              {/* Question */}
              <p className="text-sm text-gray-200 mb-1 line-clamp-2">
                {ranked.question || 'Unknown market'}
              </p>

              {/* Rationale */}
              <p className="text-xs text-gray-400 line-clamp-2">
                {ranked.rationale}
              </p>

              {/* Category & Time */}
              <div className="flex items-center gap-2 mt-1">
                {ranked.category && (
                  <span className="text-xs text-gray-500">
                    {ranked.category}
                  </span>
                )}
                {ranked.endDateIso && (
                  <span className="text-xs text-gray-500">
                    • Ends:{' '}
                    {new Date(ranked.endDateIso).toLocaleDateString()}
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {signals.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">
            <p className="text-lg mb-2">No active signals</p>
            <p className="text-sm">
              Signals will appear here when the scanner detects opportunities
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
