import { useState } from 'react';
import { postApi } from '../hooks/useApi';
import type { Trade, TradePlan } from '../types';

interface Props {
  signalId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface TradeResponse {
  trade: Trade;
  plan: TradePlan;
}

export function TradePlanCard({ signalId, onClose, onSuccess }: Props) {
  const [strategy, setStrategy] = useState<'mean_reversion' | 'time_decay'>(
    'mean_reversion'
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TradeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executePaperTrade = async () => {
    setLoading(true);
    setError(null);

    const { data, error: apiError } = await postApi<TradeResponse>(
      '/api/trades',
      {
        signal_id: signalId,
        strategy,
      }
    );

    setLoading(false);

    if (apiError) {
      setError(apiError);
      return;
    }

    setResult(data);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Trade Plan</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ✕
          </button>
        </div>

        {!result ? (
          <>
            {/* Strategy Selection */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                Select Strategy
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setStrategy('mean_reversion')}
                  className={`flex-1 py-2 px-3 rounded-lg transition ${
                    strategy === 'mean_reversion'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Mean Reversion
                </button>
                <button
                  onClick={() => setStrategy('time_decay')}
                  className={`flex-1 py-2 px-3 rounded-lg transition ${
                    strategy === 'time_decay'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Time Decay
                </button>
              </div>
            </div>

            {/* Strategy Description */}
            <div className="bg-gray-700/50 rounded-lg p-3 mb-4 text-sm">
              {strategy === 'mean_reversion' ? (
                <>
                  <p className="font-medium text-emerald-400 mb-1">
                    Mean Reversion Strategy
                  </p>
                  <p className="text-gray-300">
                    Enter contrarian position expecting price to revert toward
                    recent average. Exit within 24h or at target. Uses
                    stop-loss for protection.
                  </p>
                  <ul className="mt-2 text-gray-400 text-xs space-y-1">
                    <li>• Target: 50% reversion to prior price</li>
                    <li>• Stop Loss: 1.5x expected move</li>
                    <li>• Max Hold: 24 hours</li>
                  </ul>
                </>
              ) : (
                <>
                  <p className="font-medium text-amber-400 mb-1">
                    Time Decay Strategy
                  </p>
                  <p className="text-gray-300">
                    Hold position until market resolution. Best for overpriced
                    Yes on deadline-dependent markets. Higher risk, higher
                    potential reward.
                  </p>
                  <ul className="mt-2 text-gray-400 text-xs space-y-1">
                    <li>• Target: Full payout at resolution</li>
                    <li>• No automatic stop loss</li>
                    <li>• Hold until resolution</li>
                  </ul>
                </>
              )}
            </div>

            {error && (
              <div className="bg-red-900/50 text-red-200 rounded-lg p-3 mb-4 text-sm">
                {error}
              </div>
            )}

            {/* Execute Button */}
            <button
              onClick={executePaperTrade}
              disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span> Executing...
                </span>
              ) : (
                '📄 Execute Paper Trade'
              )}
            </button>

            <p className="text-xs text-gray-500 text-center mt-2">
              This is a simulated trade. No real money involved.
            </p>
          </>
        ) : (
          <>
            {/* Success Result */}
            <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-4 mb-4">
              <div className="text-emerald-400 font-medium mb-3">
                ✓ Paper Trade Executed
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-400">Side:</span>{' '}
                  <span
                    className={`font-medium ${
                      result.trade.side === 'yes'
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {result.trade.side.toUpperCase()}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Size:</span>{' '}
                  <span className="text-white font-medium">
                    ${result.trade.size_usd.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Entry:</span>{' '}
                  <span className="text-white font-medium">
                    {(result.trade.entry_price * 100).toFixed(1)}¢
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Target:</span>{' '}
                  <span className="text-white font-medium">
                    {result.plan.targetPrice
                      ? `${(result.plan.targetPrice * 100).toFixed(1)}¢`
                      : 'Resolution'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Stop Loss:</span>{' '}
                  <span className="text-white font-medium">
                    {result.plan.stopLossPrice > 0
                      ? `${(result.plan.stopLossPrice * 100).toFixed(1)}¢`
                      : 'None'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Max Hold:</span>{' '}
                  <span className="text-white font-medium">
                    {result.plan.maxHoldHours < 24
                      ? `${result.plan.maxHoldHours.toFixed(0)}h`
                      : `${(result.plan.maxHoldHours / 24).toFixed(0)}d`}
                  </span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-emerald-800">
                <p className="text-xs text-gray-400">
                  {result.plan.sizingRationale}
                </p>
              </div>
            </div>

            <button
              onClick={onSuccess}
              className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
