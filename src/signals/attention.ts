/**
 * Low-Attention Filter Signal
 *
 * Identifies "boring" markets where mispricings may persist longer
 * due to lack of trader attention and slow price discovery.
 */

import { config } from '../config/index.js';
import { getDayBucket } from '../db/client.js';
import type { AttentionSignal, SignalStrength } from './types.js';

export interface AttentionInput {
  marketId: string;
  volume24h: number;
  tradeCount24h: number;
  bookDepthYes: number;
  bookDepthNo: number;
  spread: number;
  hoursSinceLastTrade: number;
  totalMarketsVolume24h: number;
}

/**
 * Compute attention signal for a market
 */
export function computeAttentionSignal(input: AttentionInput): AttentionSignal {
  const { lowAttentionThreshold } = config.signals.attention;

  // Calculate component scores (0-100 scale)

  // Volume score: relative to average market volume
  const avgMarketVolume = input.totalMarketsVolume24h / 100; // Assume ~100 active markets
  const volumeRatio = avgMarketVolume > 0 ? input.volume24h / avgMarketVolume : 0;
  const volumeScore = Math.min(100, volumeRatio * 50);

  // Liquidity score: based on total book depth
  const totalDepth = input.bookDepthYes + input.bookDepthNo;
  const liquidityScore = Math.min(100, (totalDepth / 10000) * 100); // $10k depth = 100

  // Activity score: based on trade frequency
  const tradesPerHour = input.tradeCount24h / 24;
  const activityScore = Math.min(100, tradesPerHour * 10); // 10 trades/hour = 100

  // Recency penalty: markets with no recent trades are lower attention
  const recencyPenalty = Math.min(50, input.hoursSinceLastTrade * 5);

  // Composite attention score (weighted)
  const attentionScore = Math.max(
    0,
    volumeScore * 0.35 +
    liquidityScore * 0.25 +
    activityScore * 0.3 +
    (100 - recencyPenalty) * 0.1
  );

  // Weak threshold is higher (more markets qualify)
  const weakThreshold = 50;
  const strongThreshold = lowAttentionThreshold; // 30

  const isLowAttention = attentionScore < weakThreshold;
  const isStrongSignal = attentionScore < strongThreshold;

  // Determine strength
  let strength: SignalStrength = 'weak';
  if (isStrongSignal) {
    strength = 'strong';
  }

  // Score for signal purposes (inverse of attention - lower attention = higher signal)
  let score = 0;
  if (isStrongSignal) {
    // Strong: score 0.5-1.0 based on how low attention is
    score = 0.5 + (strongThreshold - attentionScore) / (strongThreshold * 2);
  } else if (isLowAttention) {
    // Weak: score 0-0.5 based on distance from weak threshold
    score = (weakThreshold - attentionScore) / (weakThreshold * 2);
  }

  return {
    signalId: `low_attention:${input.marketId}:${getDayBucket()}`,
    signalType: 'low_attention',
    marketId: input.marketId,
    isTriggered: isLowAttention,
    strength,
    score,
    direction: null, // Attention doesn't give direction, it's a modifier
    edgeCents: 0,
    attentionScore,
    volumePercentile: volumeRatio * 100,
    liquidityScore,
    activityScore,
    isLowAttention,
  };
}

/**
 * Generate human-readable rationale
 */
export function generateAttentionRationale(signal: AttentionSignal): string {
  if (!signal.isLowAttention) {
    return `Normal attention level (score: ${signal.attentionScore.toFixed(0)}/100).`;
  }

  return (
    `Low-attention market: attention score ${signal.attentionScore.toFixed(0)}/100. ` +
    `Volume at ${signal.volumePercentile.toFixed(0)}th percentile. ` +
    `Potential for slow price discovery and stale prices.`
  );
}
