/**
 * Trade Plan Generator
 *
 * Converts signals into actionable trade plans with entry, exit,
 * and risk parameters.
 */

import { config } from '../config/index.js';
import { calculateKellySize } from './risk.js';
import type { TradePlan, MarketInfo } from './types.js';
import type { Signal, AnchoringSignal, DeadlineSignal } from '../signals/types.js';

/**
 * Generate a trade plan from a signal
 */
export function generateTradePlan(
  signal: Signal,
  market: MarketInfo,
  strategy: 'mean_reversion' | 'time_decay' = 'mean_reversion'
): TradePlan {
  if (strategy === 'mean_reversion') {
    return generateMeanReversionPlan(signal, market);
  } else {
    return generateTimeDecayPlan(signal, market);
  }
}

/**
 * Mean Reversion Strategy
 * - Enter contrarian position expecting price to revert
 * - Exit within 24h or at target
 * - Uses stop-loss for protection
 */
function generateMeanReversionPlan(signal: Signal, market: MarketInfo): TradePlan {
  const entryPrice =
    signal.direction === 'buy_yes' ? market.priceYes : market.priceNo;

  // Default target: 50% of edge
  let targetPrice = entryPrice + signal.edgeCents / 100 / 2;
  let maxHoldHours = 24;

  // For anchoring signals, use the computed mean target
  if (signal.signalType === 'anchoring') {
    const anchoringSignal = signal as AnchoringSignal;
    targetPrice = anchoringSignal.meanTarget;
  }

  const targetReturnPct = ((targetPrice - entryPrice) / entryPrice) * 100;

  // Stop loss: 1.5x the expected move against us
  const expectedMove = Math.abs(targetPrice - entryPrice);
  const stopLossPrice =
    signal.direction === 'buy_yes'
      ? entryPrice - expectedMove * 1.5
      : entryPrice + expectedMove * 1.5;
  const stopLossPct = ((stopLossPrice - entryPrice) / entryPrice) * 100;

  // Position sizing using Kelly-inspired approach
  const winProb = 0.55; // Conservative estimate
  const winAmount = Math.abs(targetReturnPct);
  const lossAmount = Math.abs(stopLossPct);

  const kellySize = calculateKellySize(
    winProb,
    winAmount,
    lossAmount,
    config.risk.totalBankrollUsd,
    0.25 // Quarter Kelly
  );

  // Also limit by liquidity
  const maxByLiquidity = market.liquidity * config.risk.maxBookImpactPct;
  const entrySizeUsd = Math.min(kellySize, maxByLiquidity, config.risk.maxPositionUsd);

  return {
    strategy: 'mean_reversion',
    marketId: market.id,
    signalId: signal.signalId,
    entrySide: signal.direction === 'buy_yes' ? 'yes' : 'no',
    entryPrice,
    entrySizeUsd,
    targetPrice,
    targetReturnPct,
    maxHoldHours,
    stopLossPrice,
    stopLossPct,
    sizingRationale:
      `Quarter-Kelly sizing based on ${(winProb * 100).toFixed(0)}% win probability. ` +
      `Limited to ${((entrySizeUsd / market.liquidity) * 100).toFixed(1)}% of book depth.`,
    invalidationConditions: [
      'Price continues moving against position by >10%',
      'Volume spikes 5x+ in direction of original move',
      'Fundamental news confirms the price move',
      'Market halted or resolution announced',
    ],
  };
}

/**
 * Time Decay Strategy
 * - Hold position until market resolution
 * - Best for overpriced Yes on deadline-dependent markets
 * - Higher risk, higher potential reward
 */
function generateTimeDecayPlan(signal: Signal, market: MarketInfo): TradePlan {
  // Time decay is primarily for deadline signals
  const entryPrice = market.priceNo; // Always buying No for this strategy

  // Target is full payout (No resolves to 1.0)
  const targetPrice = 0.95; // Leave room for fees
  const targetReturnPct = ((targetPrice - entryPrice) / entryPrice) * 100;

  // Calculate hold time from deadline signal
  let maxHoldHours = 720; // Default 30 days
  if (signal.signalType === 'deadline') {
    const deadlineSignal = signal as DeadlineSignal;
    maxHoldHours = deadlineSignal.hoursToResolution;
  } else if (market.endDateIso) {
    maxHoldHours =
      (new Date(market.endDateIso).getTime() - Date.now()) / (1000 * 60 * 60);
  }

  // No stop loss for hold-to-resolution strategy
  // (you'd need to manually exit if thesis breaks)
  const stopLossPrice = 0; // Effectively no stop
  const stopLossPct = -100;

  // Smaller sizing for hold-to-resolution (higher risk)
  const entrySizeUsd = Math.min(
    config.risk.totalBankrollUsd * 0.02, // Max 2% per resolution bet
    market.liquidity * 0.03, // Max 3% of book
    config.risk.maxPositionUsd * 0.5 // Half normal max
  );

  return {
    strategy: 'time_decay',
    marketId: market.id,
    signalId: signal.signalId,
    entrySide: 'no',
    entryPrice,
    entrySizeUsd,
    targetPrice,
    targetReturnPct,
    maxHoldHours,
    stopLossPrice,
    stopLossPct,
    sizingRationale:
      `Conservative sizing for hold-to-resolution: 2% of bankroll max. ` +
      `Position: $${entrySizeUsd.toFixed(2)}.`,
    invalidationConditions: [
      'Credible news of formal act being imminent',
      'Major policy shift toward Yes outcome',
      'Resolution criteria changed',
      'New information makes Yes significantly more likely',
    ],
  };
}

/**
 * Estimate expected value of a trade plan
 */
export function estimateExpectedValue(plan: TradePlan, winProb = 0.55): number {
  const winAmount = plan.entrySizeUsd * (plan.targetReturnPct / 100);
  const lossAmount = plan.entrySizeUsd * Math.abs(plan.stopLossPct / 100);

  return winProb * winAmount - (1 - winProb) * lossAmount;
}
