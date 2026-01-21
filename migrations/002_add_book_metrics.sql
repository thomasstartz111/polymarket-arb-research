-- Add executable price columns to snapshots
-- These store actual order book prices, not indicative/last trade prices

ALTER TABLE market_snapshots ADD COLUMN best_bid_yes REAL;
ALTER TABLE market_snapshots ADD COLUMN best_ask_yes REAL;
ALTER TABLE market_snapshots ADD COLUMN best_bid_no REAL;
ALTER TABLE market_snapshots ADD COLUMN best_ask_no REAL;
ALTER TABLE market_snapshots ADD COLUMN depth_usd REAL;
ALTER TABLE market_snapshots ADD COLUMN mid_yes REAL;
ALTER TABLE market_snapshots ADD COLUMN mid_no REAL;

-- Index for efficient historical lookups (anchoring needs last N snapshots)
CREATE INDEX IF NOT EXISTS idx_snapshots_market_time
ON market_snapshots(market_id, timestamp DESC);
