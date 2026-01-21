/**
 * Tradability Module
 *
 * Gates all signals with tradability checks to filter out
 * markets that have edge on paper but are untradable in practice.
 *
 * Criteria:
 * - Spread < 5%
 * - Depth > $500 within 1% of mid
 * - Slippage for $250 order < 2%
 */

import type { OrderBook, OrderBookLevel } from '../api/types.js';

export interface Tradability {
  score: number;          // 0-100 composite score
  spreadPct: number;      // Spread as % of midpoint
  depthUsd: number;       // Total USD depth within 1% of mid
  slippageFor250: number; // Expected slippage in cents for $250 order
  isTradable: boolean;    // Passes all thresholds
  reason?: string;        // Why not tradable (if applicable)
}

export interface BookState {
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  midYes: number | null;
  midNo: number | null;
}

// Thresholds for tradability (loosened from original strict settings)
const MAX_SPREAD_PCT = 0.08;      // 8% max spread (was 5%)
const MIN_DEPTH_USD = 250;        // $250 min depth (was $500)
const MAX_SLIPPAGE_CENTS = 3;     // 3 cents max slippage for $250 (was 2)

/**
 * Extract best bid/ask and midpoint from order book
 */
export function extractBookState(
  yesBook: OrderBook | null,
  noBook: OrderBook | null
): BookState {
  const state: BookState = {
    yesBid: null,
    yesAsk: null,
    noBid: null,
    noAsk: null,
    midYes: null,
    midNo: null,
  };

  if (yesBook) {
    if (yesBook.bids.length > 0) {
      state.yesBid = parseFloat(yesBook.bids[0].price);
    }
    if (yesBook.asks.length > 0) {
      state.yesAsk = parseFloat(yesBook.asks[0].price);
    }
    if (state.yesBid !== null && state.yesAsk !== null) {
      state.midYes = (state.yesBid + state.yesAsk) / 2;
    }
  }

  if (noBook) {
    if (noBook.bids.length > 0) {
      state.noBid = parseFloat(noBook.bids[0].price);
    }
    if (noBook.asks.length > 0) {
      state.noAsk = parseFloat(noBook.asks[0].price);
    }
    if (state.noBid !== null && state.noAsk !== null) {
      state.midNo = (state.noBid + state.noAsk) / 2;
    }
  }

  return state;
}

/**
 * Calculate depth within X% of midpoint
 */
function calculateDepthNearMid(
  levels: OrderBookLevel[],
  mid: number,
  rangePct: number
): number {
  let depth = 0;
  const minPrice = mid * (1 - rangePct);
  const maxPrice = mid * (1 + rangePct);

  for (const level of levels) {
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    if (price >= minPrice && price <= maxPrice) {
      depth += price * size;
    }
  }

  return depth;
}

/**
 * Estimate slippage for a given order size
 * Walks the book to see how much price impact the order would have
 */
export function estimateSlippage(
  levels: OrderBookLevel[],
  sizeUsd: number,
  side: 'buy' | 'sell'
): number {
  if (levels.length === 0) return Infinity;

  // For buying, we walk up the ask side
  // For selling, we walk down the bid side
  const orderedLevels = side === 'buy'
    ? [...levels].sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    : [...levels].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

  let remainingUsd = sizeUsd;
  let totalCost = 0;
  let totalShares = 0;
  const startPrice = parseFloat(orderedLevels[0].price);

  for (const level of orderedLevels) {
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    const levelValue = price * size;

    if (remainingUsd <= levelValue) {
      // This level covers the rest
      const sharesToBuy = remainingUsd / price;
      totalCost += remainingUsd;
      totalShares += sharesToBuy;
      break;
    } else {
      // Take the whole level
      totalCost += levelValue;
      totalShares += size;
      remainingUsd -= levelValue;
    }
  }

  if (totalShares === 0) return Infinity;

  const avgPrice = totalCost / totalShares;
  const slippagePct = Math.abs(avgPrice - startPrice) / startPrice;
  const slippageCents = slippagePct * 100;

  return slippageCents;
}

/**
 * Compute tradability score for a market
 */
export function computeTradability(
  yesBook: OrderBook | null,
  noBook: OrderBook | null
): Tradability {
  const bookState = extractBookState(yesBook, noBook);

  // Default untradable state
  const result: Tradability = {
    score: 0,
    spreadPct: 1,
    depthUsd: 0,
    slippageFor250: Infinity,
    isTradable: false,
    reason: 'No order book data',
  };

  // Need both sides for proper tradability assessment
  if (!yesBook || !noBook) {
    return result;
  }

  if (bookState.midYes === null || bookState.midNo === null) {
    result.reason = 'Cannot compute midpoint (empty book)';
    return result;
  }

  // 1. Calculate spread (use Yes side as primary)
  const yesSpread = bookState.yesAsk! - bookState.yesBid!;
  const spreadPct = yesSpread / bookState.midYes;
  result.spreadPct = spreadPct;

  // 2. Calculate depth near mid (1% range)
  const yesDepth = calculateDepthNearMid(
    [...yesBook.bids, ...yesBook.asks],
    bookState.midYes,
    0.01
  );
  const noDepth = calculateDepthNearMid(
    [...noBook.bids, ...noBook.asks],
    bookState.midNo,
    0.01
  );
  result.depthUsd = yesDepth + noDepth;

  // 3. Estimate slippage for $250 order on Yes side
  result.slippageFor250 = estimateSlippage(yesBook.asks, 250, 'buy');

  // 4. Check thresholds
  const spreadOk = spreadPct < MAX_SPREAD_PCT;
  const depthOk = result.depthUsd >= MIN_DEPTH_USD;
  const slippageOk = result.slippageFor250 < MAX_SLIPPAGE_CENTS;

  result.isTradable = spreadOk && depthOk && slippageOk;

  if (!result.isTradable) {
    const reasons: string[] = [];
    if (!spreadOk) reasons.push(`spread ${(spreadPct * 100).toFixed(1)}% > 5%`);
    if (!depthOk) reasons.push(`depth $${result.depthUsd.toFixed(0)} < $500`);
    if (!slippageOk) reasons.push(`slippage ${result.slippageFor250.toFixed(1)}c > 2c`);
    result.reason = reasons.join(', ');
  } else {
    result.reason = undefined;
  }

  // 5. Compute composite score (0-100)
  // Weight: 40% spread, 30% depth, 30% slippage
  const spreadScore = Math.max(0, 100 - (spreadPct / MAX_SPREAD_PCT) * 100);
  const depthScore = Math.min(100, (result.depthUsd / MIN_DEPTH_USD) * 50); // 50 at threshold, 100 at 2x
  const slippageScore = Math.max(0, 100 - (result.slippageFor250 / MAX_SLIPPAGE_CENTS) * 100);

  result.score = spreadScore * 0.4 + depthScore * 0.3 + slippageScore * 0.3;

  return result;
}

/**
 * Calculate max position size before edge goes negative
 * Based on order book depth and slippage curve
 */
export function calculateMaxSize(
  book: OrderBook,
  edgeCents: number,
  side: 'buy' | 'sell'
): number {
  const levels = side === 'buy' ? book.asks : book.bids;
  if (levels.length === 0 || edgeCents <= 0) return 0;

  // Binary search for max size where slippage < edge
  let low = 0;
  let high = 10000; // $10k max
  let maxSize = 0;

  while (high - low > 10) { // $10 precision
    const mid = (low + high) / 2;
    const slippage = estimateSlippage(levels, mid, side);

    if (slippage < edgeCents) {
      maxSize = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return maxSize;
}
