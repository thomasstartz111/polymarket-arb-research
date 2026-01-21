/**
 * Signal Ranking Service
 *
 * Ranks signals by composite score with type-based weighting.
 * Higher reliability signals get higher weight.
 */

import type { Signal, RankedSignal } from './types.js';

// Weight multipliers by signal type (based on expected reliability)
const TYPE_WEIGHTS: Record<string, number> = {
  complement: 1.2, // Arbitrage signals highest priority
  deadline: 1.0, // Deadline pressure is reliable
  anchoring: 0.8, // Mean reversion is probabilistic
  low_attention: 0.6, // Context signal, not standalone
};

/**
 * Rank a list of signals by composite score
 */
export function rankSignals(signals: Signal[]): RankedSignal[] {
  // Filter to triggered signals only
  const triggeredSignals = signals.filter((s) => s.isTriggered);

  // Calculate composite scores
  const scoredSignals = triggeredSignals.map((signal) => {
    const typeWeight = TYPE_WEIGHTS[signal.signalType] || 1.0;

    // Edge bonus: signals with higher expected edge get boosted
    const edgeBonus = signal.edgeCents > 0 ? Math.min(0.2, signal.edgeCents / 50) : 0;

    const compositeScore = signal.score * typeWeight + edgeBonus;

    return {
      signal,
      compositeScore,
      rank: 0,
    };
  });

  // Sort by composite score descending
  scoredSignals.sort((a, b) => b.compositeScore - a.compositeScore);

  // Assign ranks
  return scoredSignals.map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

/**
 * Find signals that confirm each other (e.g., low_attention + anchoring on same market)
 */
export function findConfirmingSignals(
  signals: Signal[],
  marketId: string
): Signal[] {
  return signals.filter(
    (s) => s.marketId === marketId && s.isTriggered
  );
}

/**
 * Calculate confirmation bonus when multiple signals point to same market
 */
export function calculateConfirmationBonus(
  signals: Signal[],
  marketId: string
): number {
  const marketSignals = findConfirmingSignals(signals, marketId);

  if (marketSignals.length <= 1) return 0;

  // Multiple signals on same market = higher conviction
  // 2 signals = 10% bonus, 3 = 20%, 4 = 30%
  return Math.min(0.3, (marketSignals.length - 1) * 0.1);
}

/**
 * Get top N ranked signals with optional market deduplication
 */
export function getTopSignals(
  rankedSignals: RankedSignal[],
  limit: number,
  dedupeByMarket = true
): RankedSignal[] {
  if (!dedupeByMarket) {
    return rankedSignals.slice(0, limit);
  }

  // Return top signal per market
  const seenMarkets = new Set<string>();
  const result: RankedSignal[] = [];

  for (const signal of rankedSignals) {
    if (seenMarkets.has(signal.signal.marketId)) continue;
    seenMarkets.add(signal.signal.marketId);
    result.push(signal);
    if (result.length >= limit) break;
  }

  return result;
}
