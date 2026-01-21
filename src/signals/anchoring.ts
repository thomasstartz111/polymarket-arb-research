/**
 * Anchoring/Overreaction Signal (V2 - With Debounce)
 *
 * Detects sharp price moves on low volume that may revert to mean.
 * Based on behavioral finance: prices overreact to news, then revert.
 *
 * V2 Improvements:
 * 1. Uses MIDPOINT (not last trade) for move calculation
 * 2. Requires PERSISTENCE: move must be present for 3+ consecutive snapshots
 * 3. Checks MOMENTUM EXHAUSTION: no new highs/lows in direction of move
 *
 * This prevents firing on:
 * - Single bad prints
 * - Spread changes that aren't real belief changes
 * - Real information (which will make new highs/lows)
 */

import { config } from '../config/index.js';
import { getHourBucket } from '../db/client.js';
import type { AnchoringSignal, HistoricalSnapshot, SignalStrength } from './types.js';

export interface AnchoringInput {
  marketId: string;
  // Current midpoint from order book
  midNow: number;
  // Historical midpoints for persistence check
  recentMids: number[];        // Last 3-5 snapshots (newest first)
  mid60mAgo: number;           // Midpoint 60 minutes ago

  // Volume metrics
  volumeRatio: number;         // Current vs average hourly
  dollarVolume1h: number;      // Dollar volume in last hour
  depthUsd: number;            // Current book depth

  // For momentum exhaustion check
  highSince60mAgo: number;     // Highest mid in last 60 min
  lowSince60mAgo: number;      // Lowest mid in last 60 min
}

export interface AnchoringSignalV2 extends AnchoringSignal {
  // New persistence fields
  persistentSnapshots: number; // How many consecutive snapshots show this move
  momentumExhausted: boolean;  // No new highs/lows in last 3 snapshots
  midNow: number;
  mid60mAgo: number;
  strength: SignalStrength;
}

/**
 * Compute anchoring signal with debounce/persistence
 */
export function computeAnchoringSignal(input: AnchoringInput): AnchoringSignalV2 {
  const { priceChangeThreshold, volumeRatioThreshold, minTrades } = config.signals.anchoring;
  const minPersistentSnapshots = 3;

  // Calculate move from midpoint (not last trade)
  const move = input.midNow - input.mid60mAgo;
  const movePct = input.mid60mAgo > 0 ? (move / input.mid60mAgo) * 100 : 0;

  // Check persistence: how many recent snapshots show this condition?
  const persistentSnapshots = checkPersistence(
    input.recentMids,
    input.mid60mAgo,
    priceChangeThreshold
  );

  // Check momentum exhaustion
  const momentumExhausted = checkMomentumExhaustion(
    input.recentMids,
    input.highSince60mAgo,
    input.lowSince60mAgo,
    move > 0
  );

  // Trigger conditions with weak/strong tiers
  const strongMoveThreshold = priceChangeThreshold * 100; // 8%
  const weakMoveThreshold = 4; // 4%

  const isStrongMove = Math.abs(movePct) > strongMoveThreshold;
  const isWeakMove = Math.abs(movePct) > weakMoveThreshold;
  const isLowVolume = input.volumeRatio < volumeRatioThreshold;
  const isPersistent = persistentSnapshots >= minPersistentSnapshots;

  // STRONG: Large move + low volume + persistent + momentum exhausted
  const meetsStrongCriteria = isStrongMove && isLowVolume && isPersistent && momentumExhausted;

  // WEAK: Moderate move + low volume (less strict)
  const meetsWeakCriteria = isWeakMove && isLowVolume && persistentSnapshots >= 2;

  const isTriggered = meetsWeakCriteria;

  // Direction: contrarian to the move
  let direction: 'buy_yes' | 'buy_no' | null = null;
  let edgeCents = 0;
  let meanTarget = input.midNow;
  let strength: SignalStrength = 'weak';

  if (isTriggered) {
    strength = meetsStrongCriteria ? 'strong' : 'weak';
    // Expect 50% reversion toward 60m-ago midpoint
    meanTarget = input.midNow + (input.mid60mAgo - input.midNow) * 0.5;
    edgeCents = Math.abs(meanTarget - input.midNow) * 100;

    if (move > 0) {
      // Price went up, expect reversion down → buy No
      direction = 'buy_no';
    } else {
      // Price went down, expect reversion up → buy Yes
      direction = 'buy_yes';
    }
  }

  // Score based on move magnitude, persistence, and momentum exhaustion
  const moveScore = Math.min(1, Math.abs(movePct) / 20); // Max at 20%
  const volumeScore = Math.min(1, (volumeRatioThreshold - input.volumeRatio) / volumeRatioThreshold);
  const persistenceBonus = persistentSnapshots >= 5 ? 0.1 : 0;
  const exhaustionBonus = momentumExhausted ? 0.1 : 0;

  const score = isTriggered
    ? Math.min(1, moveScore * 0.5 + volumeScore * 0.3 + persistenceBonus + exhaustionBonus)
    : 0;

  return {
    signalId: `anchoring:${input.marketId}:${getHourBucket()}`,
    signalType: 'anchoring',
    marketId: input.marketId,
    isTriggered,
    strength,
    score,
    direction,
    edgeCents,
    priceChange1h: move,
    priceChange1hPct: movePct,
    priceChange24hPct: 0, // Not used in V2
    volumeRatio: input.volumeRatio,
    moveQuality: input.volumeRatio,
    meanTarget,
    // V2 fields
    persistentSnapshots,
    momentumExhausted,
    midNow: input.midNow,
    mid60mAgo: input.mid60mAgo,
  };
}

/**
 * Check how many consecutive snapshots show the move condition
 */
function checkPersistence(
  recentMids: number[],
  mid60mAgo: number,
  threshold: number
): number {
  let count = 0;
  for (const mid of recentMids) {
    const movePct = mid60mAgo > 0 ? Math.abs((mid - mid60mAgo) / mid60mAgo) : 0;
    if (movePct > threshold) {
      count++;
    } else {
      break; // Stop at first snapshot that doesn't show the condition
    }
  }
  return count;
}

/**
 * Check if momentum is exhausted (no new highs/lows in recent snapshots)
 */
function checkMomentumExhaustion(
  recentMids: number[],
  highSince60m: number,
  lowSince60m: number,
  isUpMove: boolean
): boolean {
  if (recentMids.length < 3) return false;

  const recent3 = recentMids.slice(0, 3);

  if (isUpMove) {
    // For up moves, exhaustion = no new highs in last 3 snapshots
    const maxRecent = Math.max(...recent3);
    return maxRecent < highSince60m * 0.99; // Allow 1% buffer
  } else {
    // For down moves, exhaustion = no new lows in last 3 snapshots
    const minRecent = Math.min(...recent3);
    return minRecent > lowSince60m * 1.01; // Allow 1% buffer
  }
}

/**
 * Build anchoring input from historical snapshots (V2)
 */
export function buildAnchoringInput(
  marketId: string,
  snapshots: HistoricalSnapshot[]
): AnchoringInput | null {
  if (snapshots.length < 5) return null;

  const current = snapshots[0];
  const currentTime = new Date(current.timestamp).getTime();
  const oneHourMs = 60 * 60 * 1000;

  // Find snapshot ~60 minutes ago
  const hourAgoSnapshot = snapshots.find((s) => {
    const diff = currentTime - new Date(s.timestamp).getTime();
    return diff >= oneHourMs * 0.9 && diff <= oneHourMs * 1.5;
  });

  if (!hourAgoSnapshot) return null;

  // Get midpoints from recent snapshots
  // Prefer midYes if available, fall back to priceYes
  const getMid = (s: HistoricalSnapshot): number => {
    return s.midYes ?? s.priceYes;
  };

  const recentMids = snapshots.slice(0, 5).map(getMid);
  const midNow = getMid(current);
  const mid60mAgo = getMid(hourAgoSnapshot);

  // Calculate high/low since 60m ago
  const snapshotsInWindow = snapshots.filter((s) => {
    const diff = currentTime - new Date(s.timestamp).getTime();
    return diff <= oneHourMs;
  });

  const midsInWindow = snapshotsInWindow.map(getMid);
  const highSince60mAgo = Math.max(...midsInWindow);
  const lowSince60mAgo = Math.min(...midsInWindow);

  // Calculate volume ratio
  const avgVolume = snapshots.reduce((sum, s) => sum + s.volume24h, 0) / snapshots.length;
  const avgHourlyVolume = avgVolume / 24;
  const volumeRatio = avgHourlyVolume > 0 ? (current.volume24h / 24) / avgHourlyVolume : 0;

  return {
    marketId,
    midNow,
    recentMids,
    mid60mAgo,
    volumeRatio,
    dollarVolume1h: current.volume24h / 24,
    depthUsd: current.liquidity || 0,
    highSince60mAgo,
    lowSince60mAgo,
  };
}

/**
 * Generate human-readable rationale (V2)
 */
export function generateAnchoringRationale(signal: AnchoringSignalV2): string {
  if (!signal.isTriggered) {
    const reasons: string[] = [];

    if (Math.abs(signal.priceChange1hPct) <= 8) {
      reasons.push(`move too small (${signal.priceChange1hPct.toFixed(1)}%)`);
    }
    if (signal.volumeRatio >= 0.5) {
      reasons.push(`volume not low enough (${(signal.volumeRatio * 100).toFixed(0)}% of avg)`);
    }
    if (signal.persistentSnapshots < 3) {
      reasons.push(`not persistent (${signal.persistentSnapshots} snapshots)`);
    }
    if (!signal.momentumExhausted) {
      reasons.push('momentum not exhausted');
    }

    return `No overreaction signal: ${reasons.join(', ')}.`;
  }

  const moveDir = signal.priceChange1hPct > 0 ? '+' : '';
  return (
    `OVERREACTION: Midpoint moved ${moveDir}${signal.priceChange1hPct.toFixed(1)}% in 1h ` +
    `on ${(signal.volumeRatio * 100).toFixed(0)}% of avg volume. ` +
    `Persisted for ${signal.persistentSnapshots} snapshots, momentum exhausted. ` +
    `Mean reversion target: ${(signal.meanTarget * 100).toFixed(0)}¢. ` +
    `Edge: ${signal.edgeCents.toFixed(1)}¢.`
  );
}
