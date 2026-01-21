/**
 * Trading system types
 */

// Trade plan generated from a signal
export interface TradePlan {
  strategy: 'mean_reversion' | 'time_decay';
  marketId: string;
  signalId: string;

  // Entry
  entrySide: 'yes' | 'no';
  entryPrice: number;
  entrySizeUsd: number;

  // Exit targets
  targetPrice: number;
  targetReturnPct: number;
  maxHoldHours: number;

  // Risk
  stopLossPrice: number;
  stopLossPct: number;

  // Sizing rationale
  sizingRationale: string;

  // Invalidation conditions
  invalidationConditions: string[];
}

// Risk check result
export interface RiskCheckResult {
  allowed: boolean;
  reason: string | null;
  adjustedSizeUsd: number | null;
}

// Portfolio state for risk calculations
export interface PortfolioState {
  dailyPnlPct: number;
  consecutiveLosses: number;
  totalOpenPositionsUsd: number;
  openPositionsByMarket: Map<string, number>;
}

// Trade record
export interface Trade {
  tradeId: string;
  signalId: string | null;
  marketId: string;
  mode: 'paper' | 'live';
  side: 'yes' | 'no';
  direction: 'buy' | 'sell';
  entryPrice: number;
  targetPrice: number | null;
  stopLossPrice: number | null;
  sizeUsd: number;
  sizeShares: number | null;
  status: 'open' | 'closed' | 'cancelled';
  exitPrice: number | null;
  exitReason: 'target' | 'stop' | 'time' | 'manual' | 'resolution' | null;
  realizedPnl: number | null;
  entryTimestamp: string;
  exitTimestamp: string | null;
  maxHoldHours: number | null;
  notes: string | null;
}

// Market info needed for trade planning
export interface MarketInfo {
  id: string;
  question: string;
  priceYes: number;
  priceNo: number;
  liquidity: number;
  endDateIso: string | null;
}
