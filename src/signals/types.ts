/**
 * Signal types and interfaces
 */

// Signal strength tiers
export type SignalStrength = 'weak' | 'strong';

// Base signal output that all signals share
export interface BaseSignal {
  signalId: string;
  signalType: 'complement' | 'anchoring' | 'low_attention' | 'deadline';
  marketId: string;
  isTriggered: boolean;
  strength: SignalStrength; // weak = looser threshold, strong = high confidence
  score: number; // 0.0 to 1.0
  direction: 'buy_yes' | 'buy_no' | 'buy_both' | null;
  edgeCents: number; // Expected edge in cents per share
}

// Complement signal (Yes + No deviation)
export interface ComplementSignal extends BaseSignal {
  signalType: 'complement';
  sum: number;
  expectedSum: number;
  deviation: number;
  deviationPct: number;
}

// Anchoring/Mean reversion signal
export interface AnchoringSignal extends BaseSignal {
  signalType: 'anchoring';
  priceChange1h: number;
  priceChange1hPct: number;
  priceChange24hPct: number;
  volumeRatio: number;
  moveQuality: number;
  meanTarget: number;
}

// Low attention signal
export interface AttentionSignal extends BaseSignal {
  signalType: 'low_attention';
  attentionScore: number;
  volumePercentile: number;
  liquidityScore: number;
  activityScore: number;
  isLowAttention: boolean;
}

// Deadline pressure signal
export interface DeadlineSignal extends BaseSignal {
  signalType: 'deadline';
  hoursToResolution: number;
  requiresFormalAct: boolean;
  formalActType: string | null;
  impliedProbability: number;
  baseRateEstimate: number;
  rationaleDetail: string;
}

// Union type for all signals
export type Signal = ComplementSignal | AnchoringSignal | AttentionSignal | DeadlineSignal;

// Ranked signal with additional metadata
export interface RankedSignal {
  signal: Signal;
  compositeScore: number;
  rank: number;
  question?: string;
  category?: string;
  endDateIso?: string;
  rationale?: string;
}

// Market data needed for signal computation
export interface MarketData {
  id: string;
  question: string;
  description: string | null;
  endDateIso: string | null;
  category: string | null;
  priceYes: number;
  priceNo: number;
  volume24h: number;
  tradeCount24h: number;
  liquidity: number;
  spread: number;
}

// Historical snapshot for anchoring signal (V2 with midpoints)
export interface HistoricalSnapshot {
  timestamp: string;
  priceYes: number;
  priceNo: number;
  volume24h: number;
  tradeCount24h: number;
  liquidity?: number;
  // V2: Midpoints from order book
  midYes?: number | null;
  midNo?: number | null;
}

// Tradability info attached to signals
export interface TradabilityInfo {
  score: number;
  spreadPct: number;
  depthUsd: number;
  slippageFor250: number;
}

// Book state for signal display
export interface BookState {
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  midYes: number | null;
  midNo: number | null;
}

// Enhanced signal with tradability and book state
export interface EnhancedSignal extends BaseSignal {
  tradability?: TradabilityInfo;
  bookState?: BookState;
}
