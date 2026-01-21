/**
 * Backtest Runner
 *
 * Replays historical market snapshots and evaluates signal strategies.
 */

import { v4 as uuid } from 'uuid';
import { db } from '../db/client.js';
import {
  calculateMetrics,
  calculateTradePnl,
  getAdjustedEntryPrice,
  buildEquityCurve,
  formatMetrics,
} from './metrics.js';
import type {
  BacktestSnapshot,
  BacktestMarket,
  BacktestSignal,
  BacktestTrade,
  BacktestConfig,
  BacktestResults,
  SignalFunction,
} from './types.js';

// Default configuration
const DEFAULT_CONFIG: BacktestConfig = {
  positionSizeUsd: 100,
  maxConcurrentPositions: 10,
  roundTripFeePct: 2.0,
  spreadMultiplier: 1.0,
  defaultMaxHoldHours: 72,
  exitOnResolution: true,
  minLiquidity: 100,
  minVolume24h: 0,
};

/**
 * Main backtest runner
 */
export async function runBacktest(
  signalFn: SignalFunction,
  config: Partial<BacktestConfig> = {}
): Promise<BacktestResults> {
  const cfg: BacktestConfig = { ...DEFAULT_CONFIG, ...config };

  // Load markets
  const markets = loadMarkets(cfg);
  console.log(`Loaded ${markets.size} markets`);

  // Load snapshots
  const snapshots = loadSnapshots(cfg);
  console.log(`Loaded ${snapshots.length} snapshots`);

  if (snapshots.length === 0) {
    return {
      config: cfg,
      trades: [],
      metrics: calculateMetrics([], cfg),
      equity: [],
    };
  }

  // Group snapshots by market for history lookup
  const snapshotsByMarket = groupByMarket(snapshots);

  // Track open positions
  const openTrades: Map<string, BacktestTrade> = new Map();
  const closedTrades: BacktestTrade[] = [];

  // Process snapshots in chronological order
  const sortedSnapshots = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const snapshot of sortedSnapshots) {
    const market = markets.get(snapshot.marketId);
    if (!market) continue;

    // Skip if below liquidity/volume thresholds
    if (snapshot.liquidity < cfg.minLiquidity) continue;
    if (snapshot.volume24h < cfg.minVolume24h) continue;

    const marketSnapshots = snapshotsByMarket.get(snapshot.marketId) ?? [];
    const snapshotTime = new Date(snapshot.timestamp).getTime();

    // Get recent history (last 24 hours, newest first)
    const history = marketSnapshots
      .filter((s) => {
        const t = new Date(s.timestamp).getTime();
        return t < snapshotTime && t > snapshotTime - 24 * 60 * 60 * 1000;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 50);

    // Check existing positions for exits
    const existingTrade = openTrades.get(snapshot.marketId);
    if (existingTrade) {
      const exitResult = checkExit(existingTrade, snapshot, market, cfg);
      if (exitResult) {
        closedTrades.push(exitResult);
        openTrades.delete(snapshot.marketId);
      }
    }

    // Skip new signals if at max positions
    if (openTrades.size >= cfg.maxConcurrentPositions) continue;

    // Skip if already have position in this market
    if (openTrades.has(snapshot.marketId)) continue;

    // Get signal from strategy
    const signal = signalFn(snapshot, history, market);

    // Open new position if signal is actionable
    if (signal.action && signal.confidence > 0) {
      const trade = openTrade(snapshot, signal, market, cfg);
      if (trade) {
        openTrades.set(snapshot.marketId, trade);
      }
    }
  }

  // Close any remaining open trades at last known price
  for (const [marketId, trade] of openTrades) {
    const marketSnapshots = snapshotsByMarket.get(marketId) ?? [];
    if (marketSnapshots.length > 0) {
      const lastSnapshot = marketSnapshots[marketSnapshots.length - 1];
      const market = markets.get(marketId);
      if (market) {
        const exitResult = forceExit(trade, lastSnapshot, market, cfg, 'time');
        closedTrades.push(exitResult);
      }
    }
  }

  // Calculate metrics
  const metrics = calculateMetrics(closedTrades, cfg);
  const { equity } = buildEquityCurve(closedTrades, cfg);

  return {
    config: cfg,
    trades: closedTrades,
    metrics,
    equity,
  };
}

/**
 * Load markets from database
 */
function loadMarkets(cfg: BacktestConfig): Map<string, BacktestMarket> {
  const whereClause = cfg.marketIds?.length
    ? `WHERE id IN (${cfg.marketIds.map(() => '?').join(',')})`
    : '';

  const params = cfg.marketIds ?? [];

  const rows = db.all<{
    id: string;
    question: string;
    end_date_iso: string | null;
    category: string | null;
    active: number;
  }>(`SELECT id, question, end_date_iso, category, active FROM markets ${whereClause}`, params);

  const markets = new Map<string, BacktestMarket>();
  for (const row of rows) {
    // Check if market is resolved by looking for resolution in snapshots
    // or checking end date
    const isResolved = row.active === 0;
    const resolutionValue = isResolved ? getResolutionValue(row.id) : null;

    markets.set(row.id, {
      id: row.id,
      question: row.question,
      endDateIso: row.end_date_iso,
      category: row.category,
      active: row.active,
      resolved: isResolved,
      resolutionValue,
    });
  }

  return markets;
}

/**
 * Get resolution value from final price (Yes = 1, No = 0)
 */
function getResolutionValue(marketId: string): number | null {
  const lastSnapshot = db.first<{ price_yes: number }>(
    `SELECT price_yes FROM market_snapshots
     WHERE market_id = ?
     ORDER BY timestamp DESC LIMIT 1`,
    [marketId]
  );

  if (!lastSnapshot) return null;

  // If final price is near 0 or 1, that's the resolution
  if (lastSnapshot.price_yes >= 0.95) return 1;
  if (lastSnapshot.price_yes <= 0.05) return 0;

  return null; // Unresolved or mid-price
}

/**
 * Load snapshots from database
 */
function loadSnapshots(cfg: BacktestConfig): BacktestSnapshot[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (cfg.startDate) {
    conditions.push('timestamp >= ?');
    params.push(cfg.startDate);
  }

  if (cfg.endDate) {
    conditions.push('timestamp <= ?');
    params.push(cfg.endDate);
  }

  if (cfg.marketIds?.length) {
    conditions.push(`market_id IN (${cfg.marketIds.map(() => '?').join(',')})`);
    params.push(...cfg.marketIds);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.all<{
    market_id: string;
    timestamp: string;
    price_yes: number;
    price_no: number;
    volume_24h: number;
    trade_count_24h: number;
    liquidity: number;
    spread: number;
    best_bid_yes: number | null;
    best_ask_yes: number | null;
    best_bid_no: number | null;
    best_ask_no: number | null;
    mid_yes: number | null;
    mid_no: number | null;
    depth_usd: number | null;
  }>(
    `SELECT
      market_id, timestamp, price_yes, price_no, volume_24h, trade_count_24h,
      liquidity, spread, best_bid_yes, best_ask_yes, best_bid_no, best_ask_no,
      mid_yes, mid_no, depth_usd
     FROM market_snapshots
     ${whereClause}
     ORDER BY timestamp ASC`,
    params
  );

  return rows.map((row) => ({
    marketId: row.market_id,
    timestamp: row.timestamp,
    priceYes: row.price_yes,
    priceNo: row.price_no,
    volume24h: row.volume_24h ?? 0,
    tradeCount24h: row.trade_count_24h ?? 0,
    liquidity: row.liquidity ?? 0,
    spread: row.spread ?? 0,
    bestBidYes: row.best_bid_yes,
    bestAskYes: row.best_ask_yes,
    bestBidNo: row.best_bid_no,
    bestAskNo: row.best_ask_no,
    midYes: row.mid_yes,
    midNo: row.mid_no,
    depthUsd: row.depth_usd,
  }));
}

/**
 * Group snapshots by market ID
 */
function groupByMarket(snapshots: BacktestSnapshot[]): Map<string, BacktestSnapshot[]> {
  const grouped = new Map<string, BacktestSnapshot[]>();
  for (const s of snapshots) {
    const arr = grouped.get(s.marketId) ?? [];
    arr.push(s);
    grouped.set(s.marketId, arr);
  }
  // Sort each market's snapshots by time
  for (const arr of grouped.values()) {
    arr.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
  return grouped;
}

/**
 * Open a new trade
 */
function openTrade(
  snapshot: BacktestSnapshot,
  signal: BacktestSignal,
  market: BacktestMarket,
  cfg: BacktestConfig
): BacktestTrade | null {
  if (!signal.action) return null;

  const side = signal.action.includes('yes') ? 'yes' : 'no';
  const direction = signal.action.startsWith('buy') ? 'buy' : 'sell';

  // Get entry price with spread adjustment
  const rawPrice = side === 'yes' ? snapshot.priceYes : snapshot.priceNo;
  const entryPrice = getAdjustedEntryPrice(snapshot, side, direction, cfg.spreadMultiplier);

  // Validate entry price
  if (entryPrice <= 0 || entryPrice >= 1) return null;

  const sizeShares = cfg.positionSizeUsd / entryPrice;

  return {
    tradeId: uuid(),
    marketId: snapshot.marketId,
    marketQuestion: market.question,
    side,
    direction,
    entryTimestamp: snapshot.timestamp,
    entryPrice,
    rawEntryPrice: rawPrice,
    sizeUsd: cfg.positionSizeUsd,
    sizeShares,
    targetPrice: signal.targetPrice ?? null,
    stopLoss: signal.stopLoss ?? null,
    maxHoldHours: signal.maxHoldHours ?? cfg.defaultMaxHoldHours,
    exitTimestamp: null,
    exitPrice: null,
    exitReason: null,
    pnlUsd: null,
    pnlPct: null,
    holdingHours: null,
    signalMetadata: signal.metadata ?? {},
  };
}

/**
 * Check if position should exit
 */
function checkExit(
  trade: BacktestTrade,
  snapshot: BacktestSnapshot,
  market: BacktestMarket,
  cfg: BacktestConfig
): BacktestTrade | null {
  const currentPrice = trade.side === 'yes' ? snapshot.priceYes : snapshot.priceNo;
  const entryTime = new Date(trade.entryTimestamp).getTime();
  const currentTime = new Date(snapshot.timestamp).getTime();
  const holdingHours = (currentTime - entryTime) / (1000 * 60 * 60);

  // Check resolution exit
  if (cfg.exitOnResolution && market.resolved && market.resolutionValue !== null) {
    // Exit at resolution price (0 or 1)
    const exitPrice = trade.side === 'yes' ? market.resolutionValue : 1 - market.resolutionValue;
    return closeTrade(trade, snapshot.timestamp, exitPrice, 'resolution', holdingHours, cfg);
  }

  // Check target hit
  if (trade.targetPrice !== null) {
    const hitTarget =
      trade.direction === 'buy'
        ? currentPrice >= trade.targetPrice
        : currentPrice <= trade.targetPrice;

    if (hitTarget) {
      const exitPrice = getAdjustedEntryPrice(snapshot, trade.side, 'sell', cfg.spreadMultiplier);
      return closeTrade(trade, snapshot.timestamp, exitPrice, 'target', holdingHours, cfg);
    }
  }

  // Check stop loss
  if (trade.stopLoss !== null) {
    const hitStop =
      trade.direction === 'buy'
        ? currentPrice <= trade.stopLoss
        : currentPrice >= trade.stopLoss;

    if (hitStop) {
      const exitPrice = getAdjustedEntryPrice(snapshot, trade.side, 'sell', cfg.spreadMultiplier);
      return closeTrade(trade, snapshot.timestamp, exitPrice, 'stop', holdingHours, cfg);
    }
  }

  // Check time-based exit
  if (trade.maxHoldHours && holdingHours >= trade.maxHoldHours) {
    const exitPrice = getAdjustedEntryPrice(snapshot, trade.side, 'sell', cfg.spreadMultiplier);
    return closeTrade(trade, snapshot.timestamp, exitPrice, 'time', holdingHours, cfg);
  }

  return null;
}

/**
 * Force close a trade
 */
function forceExit(
  trade: BacktestTrade,
  snapshot: BacktestSnapshot,
  market: BacktestMarket,
  cfg: BacktestConfig,
  reason: 'time' | 'resolution'
): BacktestTrade {
  const entryTime = new Date(trade.entryTimestamp).getTime();
  const currentTime = new Date(snapshot.timestamp).getTime();
  const holdingHours = (currentTime - entryTime) / (1000 * 60 * 60);

  let exitPrice: number;
  if (reason === 'resolution' && market.resolved && market.resolutionValue !== null) {
    exitPrice = trade.side === 'yes' ? market.resolutionValue : 1 - market.resolutionValue;
  } else {
    exitPrice = getAdjustedEntryPrice(snapshot, trade.side, 'sell', cfg.spreadMultiplier);
  }

  return closeTrade(trade, snapshot.timestamp, exitPrice, reason, holdingHours, cfg);
}

/**
 * Close a trade and calculate P&L
 */
function closeTrade(
  trade: BacktestTrade,
  exitTimestamp: string,
  exitPrice: number,
  exitReason: 'target' | 'stop' | 'time' | 'resolution',
  holdingHours: number,
  cfg: BacktestConfig
): BacktestTrade {
  const { pnlUsd, pnlPct } = calculateTradePnl(
    trade.entryPrice,
    exitPrice,
    trade.sizeUsd,
    trade.side,
    trade.direction,
    cfg.roundTripFeePct
  );

  return {
    ...trade,
    exitTimestamp,
    exitPrice,
    exitReason,
    pnlUsd,
    pnlPct,
    holdingHours,
  };
}

// Re-export types and utilities
export * from './types.js';
export { calculateMetrics, formatMetrics, buildEquityCurve } from './metrics.js';

// Example usage
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  // Simple mean reversion signal for testing
  const testSignal: SignalFunction = (snapshot, history) => {
    if (history.length < 10) {
      return { action: null, confidence: 0 };
    }

    const avgPrice = history.reduce((sum, s) => sum + s.priceYes, 0) / history.length;
    const deviation = snapshot.priceYes - avgPrice;
    const deviationPct = Math.abs(deviation) / avgPrice;

    // Buy No if price spiked up > 10%
    if (deviation > 0 && deviationPct > 0.1) {
      return {
        action: 'buy_no',
        confidence: Math.min(1, deviationPct),
        targetPrice: snapshot.priceNo * 1.05,
        stopLoss: snapshot.priceNo * 0.9,
        maxHoldHours: 24,
        metadata: { avgPrice, deviation, deviationPct },
      };
    }

    // Buy Yes if price dropped > 10%
    if (deviation < 0 && deviationPct > 0.1) {
      return {
        action: 'buy_yes',
        confidence: Math.min(1, deviationPct),
        targetPrice: snapshot.priceYes * 1.05,
        stopLoss: snapshot.priceYes * 0.9,
        maxHoldHours: 24,
        metadata: { avgPrice, deviation, deviationPct },
      };
    }

    return { action: null, confidence: 0 };
  };

  console.log('Running backtest with test signal...\n');

  runBacktest(testSignal, {
    positionSizeUsd: 100,
    maxConcurrentPositions: 5,
    defaultMaxHoldHours: 48,
  }).then((results) => {
    console.log(formatMetrics(results.metrics));
    console.log(`\nTotal trades: ${results.trades.length}`);
  });
}
