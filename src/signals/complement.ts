/**
 * Complement Inconsistency Signal (V2 - Executable Prices)
 *
 * Detects true arbitrage opportunities using actual order book prices.
 *
 * Key insight: We use EXECUTABLE prices (best ask for buying both),
 * not indicative/last trade prices which may be stale or unfillable.
 *
 * Arb calculation:
 *   arbBuyBoth = 1.0 - (yesAsk + noAsk) - fees - slippageBuffer
 *   Only trigger if arbBuyBoth > 0 (true executable arb)
 */

import { config } from '../config/index.js';
import { getHourBucket } from '../db/client.js';
import type { BookState, Tradability } from './tradability.js';
import type { SignalStrength } from './types.js';

export interface ComplementInput {
  marketId: string;
  // Executable prices from order book
  yesAsk: number | null;
  yesBid: number | null;
  noAsk: number | null;
  noBid: number | null;
  // Fallback indicative prices (for display only)
  priceYes?: number;
  priceNo?: number;
}

export interface ComplementSignal {
  signalId: string;
  signalType: 'complement';
  marketId: string;
  isTriggered: boolean;
  strength: SignalStrength;
  score: number;
  direction: 'buy_yes' | 'buy_no' | 'buy_both' | null;
  edgeCents: number;

  // Arb calculation details
  arbBuyBoth: number;      // Edge if you buy both sides
  arbSellBoth: number;     // Edge if you sell both sides (rare)
  costToBuyBoth: number;   // yesAsk + noAsk
  proceedsToSellBoth: number; // yesBid + noBid

  // Book state for display
  yesAsk: number | null;
  yesBid: number | null;
  noAsk: number | null;
  noBid: number | null;

  // Legacy fields (for compatibility)
  sum: number;
  expectedSum: number;
  deviation: number;
  deviationPct: number;

  // Execution guidance
  maxSizeBeforeEdgeNegative: number;
  recommendedAction: 'cross' | 'rest' | 'pass';
}

/**
 * Compute complement signal using executable prices
 */
export function computeComplementSignal(input: ComplementInput): ComplementSignal {
  const { feeRate } = config.signals.complement;
  const slippageBuffer = 0.005; // 0.5 cents buffer for slippage

  // Use executable prices (asks for buying)
  const yesAsk = input.yesAsk;
  const noAsk = input.noAsk;
  const yesBid = input.yesBid;
  const noBid = input.noBid;

  // Initialize result
  const result: ComplementSignal = {
    signalId: `complement:${input.marketId}:${getHourBucket()}`,
    signalType: 'complement',
    marketId: input.marketId,
    isTriggered: false,
    strength: 'weak',
    score: 0,
    direction: null,
    edgeCents: 0,
    arbBuyBoth: 0,
    arbSellBoth: 0,
    costToBuyBoth: 0,
    proceedsToSellBoth: 0,
    yesAsk,
    yesBid,
    noAsk,
    noBid,
    sum: 0,
    expectedSum: 1.0 - feeRate,
    deviation: 0,
    deviationPct: 0,
    maxSizeBeforeEdgeNegative: 0,
    recommendedAction: 'pass',
  };

  // Need both asks to calculate buy-both arb
  if (yesAsk === null || noAsk === null) {
    return result;
  }

  // Cost to buy both (what you pay)
  const costToBuyBoth = yesAsk + noAsk;
  result.costToBuyBoth = costToBuyBoth;

  // You always get $1 at resolution (one side pays out)
  // Arb = payout - cost - fees - slippage
  const arbBuyBoth = 1.0 - costToBuyBoth - feeRate - slippageBuffer;
  result.arbBuyBoth = arbBuyBoth;

  // Check sell-both arb (rare, but possible)
  if (yesBid !== null && noBid !== null) {
    const proceedsToSellBoth = yesBid + noBid;
    result.proceedsToSellBoth = proceedsToSellBoth;
    // If you sell both, you receive proceeds but owe $1 at resolution
    // This is only profitable if proceeds > 1 + fees (extremely rare)
    result.arbSellBoth = proceedsToSellBoth - 1.0 - feeRate - slippageBuffer;
  }

  // Legacy compatibility: sum using asks (what you'd pay)
  result.sum = costToBuyBoth;
  result.deviation = costToBuyBoth - result.expectedSum;
  result.deviationPct = (result.deviation / result.expectedSum) * 100;

  // STRONG: TRUE executable arb (positive edge after all costs)
  if (arbBuyBoth > 0) {
    result.isTriggered = true;
    result.strength = 'strong';
    result.direction = 'buy_both';
    result.edgeCents = arbBuyBoth * 100;
    result.recommendedAction = 'cross'; // Cross the spread to capture arb

    // Score: 0.5 at breakeven, 1 at 3 cents edge
    result.score = Math.min(1, 0.5 + (arbBuyBoth / 0.06));
  }
  // WEAK: Near-arb, might be worth resting orders (cost between 98-100 cents)
  else if (arbBuyBoth > -0.02) {
    result.isTriggered = true;
    result.strength = 'weak';
    result.direction = 'buy_both';
    result.edgeCents = arbBuyBoth * 100; // Will be negative
    result.recommendedAction = 'rest';

    // Score: 0 at -2%, 0.5 at breakeven
    result.score = Math.max(0, 0.5 + (arbBuyBoth / 0.04));
  }

  return result;
}

/**
 * Generate human-readable rationale for complement signal
 */
export function generateComplementRationale(signal: ComplementSignal): string {
  if (!signal.isTriggered) {
    if (signal.yesAsk === null || signal.noAsk === null) {
      return 'Insufficient order book data to calculate executable arb.';
    }

    const costStr = (signal.costToBuyBoth * 100).toFixed(1);
    if (signal.arbBuyBoth > -0.02) {
      return (
        `Near-arb: buying both costs ${costStr}¢, edge after fees = ` +
        `${(signal.arbBuyBoth * 100).toFixed(1)}¢. ` +
        `Consider resting bids to improve entry.`
      );
    }

    return (
      `No arb: buying both costs ${costStr}¢ (need <98¢). ` +
      `Edge after fees = ${(signal.arbBuyBoth * 100).toFixed(1)}¢.`
    );
  }

  return (
    `TRUE ARB: Buy both sides for ${(signal.costToBuyBoth * 100).toFixed(1)}¢, ` +
    `guaranteed $1 at resolution. Edge after fees: ${signal.edgeCents.toFixed(1)}¢. ` +
    `Action: ${signal.recommendedAction.toUpperCase()}.`
  );
}
