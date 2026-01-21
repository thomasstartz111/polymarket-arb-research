/**
 * Backtesting types
 */

// Market snapshot from database for backtesting
export interface BacktestSnapshot {
  marketId: string;
  timestamp: string;
  priceYes: number;
  priceNo: number;
  volume24h: number;
  tradeCount24h: number;
  liquidity: number;
  spread: number;
  bestBidYes: number | null;
  bestAskYes: number | null;
  bestBidNo: number | null;
  bestAskNo: number | null;
  midYes: number | null;
  midNo: number | null;
  depthUsd: number | null;
}

// Market metadata for context
export interface BacktestMarket {
  id: string;
  question: string;
  endDateIso: string | null;
  category: string | null;
  active: number;
  resolved: boolean;
  resolutionValue: number | null; // 1 = Yes won, 0 = No won, null = unresolved
}

// Signal output from strategy function
export interface BacktestSignal {
  action: 'buy_yes' | 'buy_no' | 'sell_yes' | 'sell_no' | null;
  confidence: number; // 0-1 score
  targetPrice?: number; // optional exit target
  stopLoss?: number; // optional stop
  maxHoldHours?: number; // time-based exit
  metadata?: Record<string, unknown>; // strategy-specific data
}

// Strategy function signature
export type SignalFunction = (
  snapshot: BacktestSnapshot,
  history: BacktestSnapshot[], // recent history, newest first
  market: BacktestMarket
) => BacktestSignal;

// Trade record during backtest
export interface BacktestTrade {
  tradeId: string;
  marketId: string;
  marketQuestion: string;
  side: 'yes' | 'no';
  direction: 'buy' | 'sell';
  entryTimestamp: string;
  entryPrice: number; // price after spread adjustment
  rawEntryPrice: number; // signal price before spread
  sizeUsd: number;
  sizeShares: number;
  targetPrice: number | null;
  stopLoss: number | null;
  maxHoldHours: number | null;
  exitTimestamp: string | null;
  exitPrice: number | null;
  exitReason: 'target' | 'stop' | 'time' | 'resolution' | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  holdingHours: number | null;
  signalMetadata: Record<string, unknown>;
}

// Backtest configuration
export interface BacktestConfig {
  // Data range
  startDate?: string; // ISO timestamp
  endDate?: string; // ISO timestamp
  marketIds?: string[]; // specific markets, or all if empty

  // Position sizing
  positionSizeUsd: number; // default position size
  maxConcurrentPositions: number; // max open trades

  // Costs
  roundTripFeePct: number; // total fees (default 2%)
  spreadMultiplier: number; // 1 = use market spread, >1 = pessimistic

  // Exit rules
  defaultMaxHoldHours: number; // default time exit
  exitOnResolution: boolean; // close at market resolution

  // Filters
  minLiquidity: number; // skip illiquid snapshots
  minVolume24h: number; // skip low volume
}

// Backtest results
export interface BacktestResults {
  config: BacktestConfig;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  equity: EquityPoint[];
}

// Performance metrics
export interface BacktestMetrics {
  // Counts
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;

  // Returns
  winRate: number; // percentage
  avgProfitPerTrade: number; // USD
  avgProfitPct: number; // percentage
  totalPnl: number; // USD
  totalReturnPct: number; // percentage

  // Risk
  maxDrawdown: number; // percentage
  maxDrawdownUsd: number; // USD
  sharpeRatio: number; // annualized
  sortinoRatio: number; // annualized, downside only
  profitFactor: number; // gross profit / gross loss

  // Time
  avgHoldingHours: number;
  maxHoldingHours: number;

  // By exit reason
  exitReasonCounts: Record<string, number>;
}

// Equity curve point
export interface EquityPoint {
  timestamp: string;
  equity: number;
  drawdown: number;
  openPositions: number;
}
