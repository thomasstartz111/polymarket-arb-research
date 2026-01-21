import { useApi } from '../hooks/useApi';
import type { Trade } from '../types';

export function TradeList() {
  const { data, loading, error } = useApi<{ trades: Trade[] }>(
    '/api/trades?limit=50'
  );

  if (loading && !data) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/3 mb-4"></div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-700 rounded mb-2"></div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
        <p className="text-red-400">Error loading trades: {error}</p>
      </div>
    );
  }

  const trades = data?.trades || [];

  // Calculate totals
  const closedTrades = trades.filter((t) => t.status === 'closed');
  const totalPnl = closedTrades.reduce(
    (sum, t) => sum + (t.realized_pnl || 0),
    0
  );
  const openTrades = trades.filter((t) => t.status === 'open');

  return (
    <div className="bg-gray-800 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Trade History</h2>
          <div className="flex gap-4 text-sm">
            <span className="text-gray-400">
              Open:{' '}
              <span className="text-amber-400 font-medium">
                {openTrades.length}
              </span>
            </span>
            <span className="text-gray-400">
              P&L:{' '}
              <span
                className={`font-medium ${
                  totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-700 max-h-[calc(100vh-250px)] overflow-y-auto">
        {trades.map((trade) => {
          const isOpen = trade.status === 'open';
          const isProfitable = (trade.realized_pnl || 0) >= 0;

          return (
            <div key={trade.trade_id} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium px-2 py-0.5 rounded ${
                      trade.side === 'yes'
                        ? 'bg-emerald-900 text-emerald-300'
                        : 'bg-red-900 text-red-300'
                    }`}
                  >
                    {trade.side.toUpperCase()}
                  </span>
                  <span className="text-sm text-gray-400">
                    @ {(trade.entry_price * 100).toFixed(1)}¢
                  </span>
                  <span className="text-sm text-gray-400">
                    ${trade.size_usd.toFixed(0)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {!isOpen && trade.realized_pnl !== null && (
                    <span
                      className={`text-sm font-medium ${
                        isProfitable ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {isProfitable ? '+' : ''}${trade.realized_pnl.toFixed(2)}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      isOpen
                        ? 'bg-amber-900 text-amber-300'
                        : trade.status === 'closed'
                        ? isProfitable
                          ? 'bg-emerald-900 text-emerald-300'
                          : 'bg-red-900 text-red-300'
                        : 'bg-gray-600 text-gray-300'
                    }`}
                  >
                    {trade.status}
                  </span>
                </div>
              </div>

              <p className="text-sm text-gray-300 line-clamp-1">
                {trade.question || trade.market_id}
              </p>

              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                <span>
                  {new Date(trade.entry_timestamp).toLocaleDateString()}{' '}
                  {new Date(trade.entry_timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                {trade.exit_reason && (
                  <span>Exit: {trade.exit_reason}</span>
                )}
                {trade.target_price && isOpen && (
                  <span>
                    Target: {(trade.target_price * 100).toFixed(1)}¢
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {trades.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">
            <p className="text-lg mb-2">No trades yet</p>
            <p className="text-sm">
              Execute paper trades from signals to start tracking P&L
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
