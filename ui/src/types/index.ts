/**
 * Frontend type definitions
 */

export type SignalStrength = 'weak' | 'strong';

export interface Signal {
  signalId: string;
  signalType: 'complement' | 'anchoring' | 'low_attention' | 'deadline';
  marketId: string;
  isTriggered: boolean;
  strength: SignalStrength;
  score: number;
  direction: 'buy_yes' | 'buy_no' | null;
  edgeCents: number;
}

export interface RankedSignal {
  signal: Signal;
  compositeScore: number;
  rank: number;
  question?: string;
  category?: string;
  endDateIso?: string;
  rationale?: string;
}

export interface Market {
  id: string;
  question: string;
  slug: string | null;
  description: string | null;
  end_date_iso: string | null;
  category: string | null;
  active: number;
  price_yes?: number;
  price_no?: number;
  volume_24h?: number;
  liquidity?: number;
}

export interface Snapshot {
  timestamp: string;
  price_yes: number;
  price_no: number;
  volume_24h: number;
  trade_count_24h: number;
  liquidity: number;
  spread: number;
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface Trade {
  trade_id: string;
  signal_id: string | null;
  market_id: string;
  mode: 'paper' | 'live';
  side: 'yes' | 'no';
  direction: 'buy' | 'sell';
  entry_price: number;
  target_price: number | null;
  stop_loss_price: number | null;
  size_usd: number;
  status: 'open' | 'closed' | 'cancelled';
  exit_price: number | null;
  exit_reason: string | null;
  realized_pnl: number | null;
  entry_timestamp: string;
  exit_timestamp: string | null;
  question?: string;
}

export interface Stats {
  markets: number;
  snapshots: number;
  activeSignals: number;
  totalTrades: number;
  totalPnl: number;
  winRate: number;
  wins: number;
  losses: number;
  openPositions: number;
  dailyPnl: number;
}

export interface TradePlan {
  strategy: 'mean_reversion' | 'time_decay';
  marketId: string;
  signalId: string;
  entrySide: 'yes' | 'no';
  entryPrice: number;
  entrySizeUsd: number;
  targetPrice: number;
  targetReturnPct: number;
  maxHoldHours: number;
  stopLossPrice: number;
  stopLossPct: number;
  sizingRationale: string;
  invalidationConditions: string[];
}
