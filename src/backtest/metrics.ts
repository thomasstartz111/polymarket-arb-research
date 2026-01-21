/**
 * Backtest metrics calculations
 */

import type { BacktestTrade, BacktestMetrics, EquityPoint, BacktestConfig } from './types.js';

const TRADING_DAYS_PER_YEAR = 252;
const HOURS_PER_YEAR = TRADING_DAYS_PER_YEAR * 24;

/**
 * Calculate all performance metrics from trades
 */
export function calculateMetrics(
  trades: BacktestTrade[],
  config: BacktestConfig
): BacktestMetrics {
  const closedTrades = trades.filter((t) => t.exitTimestamp !== null);

  if (closedTrades.length === 0) {
    return emptyMetrics();
  }

  // Basic counts
  const winningTrades = closedTrades.filter((t) => (t.pnlUsd ?? 0) > 0);
  const losingTrades = closedTrades.filter((t) => (t.pnlUsd ?? 0) < 0);
  const breakEvenTrades = closedTrades.filter((t) => t.pnlUsd === 0);

  // Returns
  const pnls = closedTrades.map((t) => t.pnlUsd ?? 0);
  const pnlPcts = closedTrades.map((t) => t.pnlPct ?? 0);
  const totalPnl = sum(pnls);
  const avgProfitPerTrade = totalPnl / closedTrades.length;
  const avgProfitPct = sum(pnlPcts) / closedTrades.length;

  // Win rate
  const winRate = (winningTrades.length / closedTrades.length) * 100;

  // Profit factor
  const grossProfit = sum(winningTrades.map((t) => t.pnlUsd ?? 0));
  const grossLoss = Math.abs(sum(losingTrades.map((t) => t.pnlUsd ?? 0)));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Holding time
  const holdingHours = closedTrades.map((t) => t.holdingHours ?? 0);
  const avgHoldingHours = sum(holdingHours) / closedTrades.length;
  const maxHoldingHours = Math.max(...holdingHours);

  // Exit reason breakdown
  const exitReasonCounts: Record<string, number> = {};
  for (const trade of closedTrades) {
    const reason = trade.exitReason ?? 'unknown';
    exitReasonCounts[reason] = (exitReasonCounts[reason] ?? 0) + 1;
  }

  // Equity curve and drawdown
  const { equity, maxDrawdown, maxDrawdownUsd } = buildEquityCurve(closedTrades, config);

  // Total return based on initial capital
  const initialCapital = config.positionSizeUsd * config.maxConcurrentPositions;
  const totalReturnPct = (totalPnl / initialCapital) * 100;

  // Sharpe and Sortino ratios
  const { sharpeRatio, sortinoRatio } = calculateRiskAdjustedReturns(pnlPcts, avgHoldingHours);

  return {
    totalTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakEvenTrades: breakEvenTrades.length,
    winRate,
    avgProfitPerTrade,
    avgProfitPct,
    totalPnl,
    totalReturnPct,
    maxDrawdown,
    maxDrawdownUsd,
    sharpeRatio,
    sortinoRatio,
    profitFactor,
    avgHoldingHours,
    maxHoldingHours,
    exitReasonCounts,
  };
}

/**
 * Build equity curve from trades
 */
export function buildEquityCurve(
  trades: BacktestTrade[],
  config: BacktestConfig
): { equity: EquityPoint[]; maxDrawdown: number; maxDrawdownUsd: number } {
  const initialCapital = config.positionSizeUsd * config.maxConcurrentPositions;
  const sortedTrades = [...trades]
    .filter((t) => t.exitTimestamp)
    .sort((a, b) => new Date(a.exitTimestamp!).getTime() - new Date(b.exitTimestamp!).getTime());

  if (sortedTrades.length === 0) {
    return {
      equity: [{ timestamp: new Date().toISOString(), equity: initialCapital, drawdown: 0, openPositions: 0 }],
      maxDrawdown: 0,
      maxDrawdownUsd: 0,
    };
  }

  const equity: EquityPoint[] = [];
  let currentEquity = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownUsd = 0;

  for (const trade of sortedTrades) {
    currentEquity += trade.pnlUsd ?? 0;

    if (currentEquity > peak) {
      peak = currentEquity;
    }

    const drawdownUsd = peak - currentEquity;
    const drawdownPct = peak > 0 ? (drawdownUsd / peak) * 100 : 0;

    if (drawdownPct > maxDrawdown) {
      maxDrawdown = drawdownPct;
      maxDrawdownUsd = drawdownUsd;
    }

    equity.push({
      timestamp: trade.exitTimestamp!,
      equity: currentEquity,
      drawdown: drawdownPct,
      openPositions: 0, // simplified - could track properly with entry/exit timestamps
    });
  }

  return { equity, maxDrawdown, maxDrawdownUsd };
}

/**
 * Calculate Sharpe and Sortino ratios
 */
function calculateRiskAdjustedReturns(
  returnsPct: number[],
  avgHoldingHours: number
): { sharpeRatio: number; sortinoRatio: number } {
  if (returnsPct.length < 2) {
    return { sharpeRatio: 0, sortinoRatio: 0 };
  }

  const avgReturn = sum(returnsPct) / returnsPct.length;

  // Standard deviation of returns
  const variance = sum(returnsPct.map((r) => (r - avgReturn) ** 2)) / returnsPct.length;
  const stdDev = Math.sqrt(variance);

  // Downside deviation (only negative returns)
  const negativeReturns = returnsPct.filter((r) => r < 0);
  const downsideVariance =
    negativeReturns.length > 0
      ? sum(negativeReturns.map((r) => r ** 2)) / returnsPct.length
      : 0;
  const downsideStdDev = Math.sqrt(downsideVariance);

  // Annualization factor based on average holding period
  const tradesPerYear = avgHoldingHours > 0 ? HOURS_PER_YEAR / avgHoldingHours : 1;
  const annualizationFactor = Math.sqrt(tradesPerYear);

  // Sharpe (assuming 0 risk-free rate for simplicity)
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * annualizationFactor : 0;

  // Sortino
  const sortinoRatio = downsideStdDev > 0 ? (avgReturn / downsideStdDev) * annualizationFactor : 0;

  return { sharpeRatio, sortinoRatio };
}

/**
 * Calculate P&L for a single trade
 */
export function calculateTradePnl(
  entryPrice: number,
  exitPrice: number,
  sizeUsd: number,
  side: 'yes' | 'no',
  direction: 'buy' | 'sell',
  feePct: number
): { pnlUsd: number; pnlPct: number } {
  // Shares purchased
  const shares = sizeUsd / entryPrice;

  // Exit value
  const exitValue = shares * exitPrice;

  // Gross P&L
  let grossPnl: number;
  if (direction === 'buy') {
    // Long position: profit if price goes up
    grossPnl = exitValue - sizeUsd;
  } else {
    // Short position: profit if price goes down
    grossPnl = sizeUsd - exitValue;
  }

  // Apply fees
  const fees = sizeUsd * (feePct / 100);
  const pnlUsd = grossPnl - fees;
  const pnlPct = (pnlUsd / sizeUsd) * 100;

  return { pnlUsd, pnlPct };
}

/**
 * Get entry price adjusted for spread
 */
export function getAdjustedEntryPrice(
  snapshot: {
    bestBidYes: number | null;
    bestAskYes: number | null;
    bestBidNo: number | null;
    bestAskNo: number | null;
    priceYes: number;
    priceNo: number;
    spread: number;
  },
  side: 'yes' | 'no',
  direction: 'buy' | 'sell',
  spreadMultiplier: number
): number {
  // Use order book prices if available, otherwise use indicative price + spread
  if (direction === 'buy') {
    // Buying: pay the ask
    if (side === 'yes' && snapshot.bestAskYes !== null) {
      return snapshot.bestAskYes;
    }
    if (side === 'no' && snapshot.bestAskNo !== null) {
      return snapshot.bestAskNo;
    }
    // Fallback: price + half spread
    const basePrice = side === 'yes' ? snapshot.priceYes : snapshot.priceNo;
    return Math.min(0.99, basePrice + (snapshot.spread * spreadMultiplier) / 2);
  } else {
    // Selling: receive the bid
    if (side === 'yes' && snapshot.bestBidYes !== null) {
      return snapshot.bestBidYes;
    }
    if (side === 'no' && snapshot.bestBidNo !== null) {
      return snapshot.bestBidNo;
    }
    // Fallback: price - half spread
    const basePrice = side === 'yes' ? snapshot.priceYes : snapshot.priceNo;
    return Math.max(0.01, basePrice - (snapshot.spread * spreadMultiplier) / 2);
  }
}

/**
 * Empty metrics for no-trade scenarios
 */
function emptyMetrics(): BacktestMetrics {
  return {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakEvenTrades: 0,
    winRate: 0,
    avgProfitPerTrade: 0,
    avgProfitPct: 0,
    totalPnl: 0,
    totalReturnPct: 0,
    maxDrawdown: 0,
    maxDrawdownUsd: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    profitFactor: 0,
    avgHoldingHours: 0,
    maxHoldingHours: 0,
    exitReasonCounts: {},
  };
}

/**
 * Sum array of numbers
 */
function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/**
 * Format metrics for display
 */
export function formatMetrics(metrics: BacktestMetrics): string {
  const lines = [
    '=== Backtest Results ===',
    '',
    `Trades: ${metrics.totalTrades} (${metrics.winningTrades}W / ${metrics.losingTrades}L / ${metrics.breakEvenTrades}BE)`,
    `Win Rate: ${metrics.winRate.toFixed(1)}%`,
    '',
    `Total P&L: $${metrics.totalPnl.toFixed(2)} (${metrics.totalReturnPct.toFixed(2)}%)`,
    `Avg Per Trade: $${metrics.avgProfitPerTrade.toFixed(2)} (${metrics.avgProfitPct.toFixed(2)}%)`,
    `Profit Factor: ${metrics.profitFactor === Infinity ? 'Inf' : metrics.profitFactor.toFixed(2)}`,
    '',
    `Max Drawdown: ${metrics.maxDrawdown.toFixed(1)}% ($${metrics.maxDrawdownUsd.toFixed(2)})`,
    `Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`,
    `Sortino Ratio: ${metrics.sortinoRatio.toFixed(2)}`,
    '',
    `Avg Hold: ${metrics.avgHoldingHours.toFixed(1)}h`,
    `Max Hold: ${metrics.maxHoldingHours.toFixed(1)}h`,
    '',
    'Exit Reasons:',
    ...Object.entries(metrics.exitReasonCounts).map(([reason, count]) => `  ${reason}: ${count}`),
  ];

  return lines.join('\n');
}
