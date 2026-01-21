/**
 * Polymarket CLOB API Types
 * Based on: https://docs.polymarket.com/
 */

// Token within a market (Yes or No outcome)
export interface PolymarketToken {
  token_id: string;
  outcome: string; // 'Yes' or 'No'
  price: number; // 0.00 to 1.00
  winner?: boolean | null;
}

// Market from the markets endpoint
export interface PolymarketMarket {
  condition_id: string;
  question_id: string;
  question: string;
  description: string;
  end_date_iso: string;
  game_start_time: string | null;
  market_slug: string;
  category: string;
  tokens: PolymarketToken[];
  active: boolean;
  closed: boolean;
  archived: boolean;
  accepting_orders: boolean;
  minimum_order_size: number;
  minimum_tick_size: number;
  rewards?: {
    rates: Array<{ asset_address: string; rewards_daily_rate: number }>;
  };
}

// Order book level
export interface OrderBookLevel {
  price: string;
  size: string;
}

// Order book response
export interface OrderBook {
  market: string;
  asset_id: string;
  hash: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
}

// Trade from the trades endpoint
export interface MarketTrade {
  id: string;
  taker_order_id: string;
  market: string;
  asset_id: string;
  side: 'BUY' | 'SELL';
  price: string;
  size: string;
  fee_rate_bps: string;
  timestamp: string;
  status: string;
}

// Parsed book depth metrics
export interface BookDepth {
  bidDepth: number; // Total USD value on bid side
  askDepth: number; // Total USD value on ask side
  midpoint: number | null;
  spread: number;
}

// Our internal market representation
export interface Market {
  id: string;
  question: string;
  slug: string | null;
  description: string | null;
  endDateIso: string | null;
  category: string | null;
  active: boolean;
  yesTokenId: string | null;
  noTokenId: string | null;
  priceYes: number;
  priceNo: number;
}

// Snapshot stored in our database
export interface MarketSnapshot {
  id?: number;
  marketId: string;
  timestamp: string;
  priceYes: number;
  priceNo: number;
  volume24h: number;
  tradeCount24h: number;
  liquidity: number;
  spread: number;
}

// Order book snapshot
export interface OrderBookSnapshot {
  marketId: string;
  timestamp: string;
  side: 'yes' | 'no';
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}
