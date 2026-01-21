import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { TradePlanCard } from './TradePlanCard';
import { PriceChart } from './PriceChart';
import { OrderBookChart } from './OrderBookChart';
import type { Market, Snapshot } from '../types';

interface MarketDetailsResponse {
  market: Market;
  history: Snapshot[];
  orderbook: {
    yes?: { bids_json: string; asks_json: string };
    no?: { bids_json: string; asks_json: string };
  };
  signals: Array<{
    signal_id: string;
    signal_type: string;
    score: number;
    direction: string | null;
    rationale: string;
  }>;
  trades: Array<{
    trade_id: string;
    side: string;
    entry_price: number;
    size_usd: number;
    status: string;
    realized_pnl: number | null;
  }>;
}

interface Props {
  marketId: string;
  onTradeExecuted?: () => void;
}

export function MarketDrilldown({ marketId, onTradeExecuted }: Props) {
  const { data, loading, error } = useApi<MarketDetailsResponse>(
    `/api/markets/${marketId}`
  );
  const [showTradePlan, setShowTradePlan] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 animate-pulse">
        <div className="h-8 bg-gray-700 rounded w-2/3 mb-4"></div>
        <div className="h-40 bg-gray-700 rounded mb-4"></div>
        <div className="h-32 bg-gray-700 rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
        <p className="text-red-400">
          Error loading market: {error || 'Unknown'}
        </p>
      </div>
    );
  }

  const { market, history, orderbook, signals, trades } = data;
  const latestSnapshot = history[0];

  const hoursToResolution = market.end_date_iso
    ? Math.max(
        0,
        (new Date(market.end_date_iso).getTime() - Date.now()) / (1000 * 60 * 60)
      )
    : null;

  // Parse order book JSON
  const yesBook = orderbook.yes
    ? {
        bids: JSON.parse(orderbook.yes.bids_json),
        asks: JSON.parse(orderbook.yes.asks_json),
      }
    : null;

  return (
    <div className="space-y-4">
      {/* Market Header */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex items-start justify-between mb-2">
          <span className="text-xs px-2 py-0.5 rounded bg-gray-600">
            {market.category || 'Uncategorized'}
          </span>
          {hoursToResolution !== null && (
            <span className="text-xs text-gray-400">
              {hoursToResolution < 24
                ? `${hoursToResolution.toFixed(0)}h to resolution`
                : `${(hoursToResolution / 24).toFixed(0)}d to resolution`}
            </span>
          )}
        </div>
        <h2 className="text-lg font-semibold mb-3">{market.question}</h2>

        {/* Current Prices */}
        {latestSnapshot && (
          <>
            <div className="flex gap-4">
              <div className="flex-1 bg-emerald-900/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">
                  {(latestSnapshot.price_yes * 100).toFixed(1)}¢
                </div>
                <div className="text-xs text-gray-400">YES</div>
              </div>
              <div className="flex-1 bg-red-900/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-400">
                  {(latestSnapshot.price_no * 100).toFixed(1)}¢
                </div>
                <div className="text-xs text-gray-400">NO</div>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-4 gap-2 mt-3 text-center">
              <div>
                <div className="text-sm font-medium">
                  ${latestSnapshot.volume_24h?.toFixed(0) || 0}
                </div>
                <div className="text-xs text-gray-400">24h Vol</div>
              </div>
              <div>
                <div className="text-sm font-medium">
                  {latestSnapshot.trade_count_24h || 0}
                </div>
                <div className="text-xs text-gray-400">24h Trades</div>
              </div>
              <div>
                <div className="text-sm font-medium">
                  ${latestSnapshot.liquidity?.toFixed(0) || 0}
                </div>
                <div className="text-xs text-gray-400">Liquidity</div>
              </div>
              <div>
                <div className="text-sm font-medium">
                  {((latestSnapshot.spread || 0) * 100).toFixed(1)}¢
                </div>
                <div className="text-xs text-gray-400">Spread</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Price Chart */}
      {history.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="font-medium mb-3">Price History</h3>
          <PriceChart data={history} />
        </div>
      )}

      {/* Order Book */}
      {yesBook && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="font-medium mb-3">Order Book (YES)</h3>
          <OrderBookChart bids={yesBook.bids} asks={yesBook.asks} />
        </div>
      )}

      {/* Resolution Criteria */}
      {market.description && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="font-medium mb-2">Resolution Criteria</h3>
          <p className="text-sm text-gray-300 whitespace-pre-wrap">
            {market.description.slice(0, 500)}
            {market.description.length > 500 && '...'}
          </p>
        </div>
      )}

      {/* Active Signals */}
      {signals.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="font-medium mb-3">Active Signals</h3>
          <div className="space-y-2">
            {signals.map((signal) => (
              <div
                key={signal.signal_id}
                className="bg-gray-700/50 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-600">
                    {signal.signal_type}
                  </span>
                  <span className="text-sm text-emerald-400">
                    Score: {(signal.score * 100).toFixed(0)}
                  </span>
                </div>
                <p className="text-sm text-gray-300 mb-2">{signal.rationale}</p>

                <button
                  onClick={() => {
                    setSelectedSignal(signal.signal_id);
                    setShowTradePlan(true);
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-medium transition"
                >
                  📝 Trade This Signal
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Existing Trades */}
      {trades.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="font-medium mb-3">Trades on This Market</h3>
          <div className="space-y-2">
            {trades.map((trade) => (
              <div
                key={trade.trade_id}
                className="flex items-center justify-between bg-gray-700/50 rounded p-2"
              >
                <div>
                  <span
                    className={`text-sm font-medium ${
                      trade.side === 'yes' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {trade.side.toUpperCase()}
                  </span>
                  <span className="text-sm text-gray-400 ml-2">
                    @ {(trade.entry_price * 100).toFixed(1)}¢
                  </span>
                  <span className="text-sm text-gray-400 ml-2">
                    ${trade.size_usd.toFixed(0)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      trade.status === 'open'
                        ? 'bg-amber-900 text-amber-300'
                        : 'bg-gray-600 text-gray-300'
                    }`}
                  >
                    {trade.status}
                  </span>
                  {trade.realized_pnl !== null && (
                    <span
                      className={`text-sm font-medium ${
                        trade.realized_pnl >= 0
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {trade.realized_pnl >= 0 ? '+' : ''}$
                      {trade.realized_pnl.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trade Plan Modal */}
      {showTradePlan && selectedSignal && (
        <TradePlanCard
          signalId={selectedSignal}
          onClose={() => {
            setShowTradePlan(false);
            setSelectedSignal(null);
          }}
          onSuccess={() => {
            setShowTradePlan(false);
            setSelectedSignal(null);
            onTradeExecuted?.();
          }}
        />
      )}
    </div>
  );
}
