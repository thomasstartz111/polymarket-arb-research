-- Polymarket Scanner Database Schema
-- Version: 001_initial

-- Core market metadata (updated on each ingest)
CREATE TABLE IF NOT EXISTS markets (
    id TEXT PRIMARY KEY,                    -- Polymarket condition_id
    question TEXT NOT NULL,                 -- "Will X happen by Y?"
    slug TEXT,                              -- URL slug
    description TEXT,                       -- Full description/resolution criteria
    end_date_iso TEXT,                      -- ISO timestamp of resolution
    category TEXT,                          -- Politics, Sports, Crypto, etc.
    active INTEGER DEFAULT 1,               -- 1 = trading, 0 = resolved/closed
    outcome_yes_token TEXT,                 -- Token ID for Yes outcome
    outcome_no_token TEXT,                  -- Token ID for No outcome
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Price/volume snapshots (time-series, append-only)
CREATE TABLE IF NOT EXISTS market_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL REFERENCES markets(id),
    timestamp TEXT NOT NULL,                -- ISO timestamp
    price_yes REAL NOT NULL,                -- 0.00 to 1.00
    price_no REAL NOT NULL,                 -- 0.00 to 1.00
    volume_24h REAL DEFAULT 0,              -- USD volume last 24h
    trade_count_24h INTEGER DEFAULT 0,      -- Number of trades last 24h
    liquidity REAL DEFAULT 0,               -- Total liquidity in book
    spread REAL DEFAULT 0,                  -- Best bid/ask spread
    UNIQUE(market_id, timestamp)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_market_time ON market_snapshots(market_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON market_snapshots(timestamp DESC);

-- Order book snapshots (top N levels, stored as JSON)
CREATE TABLE IF NOT EXISTS orderbook_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL REFERENCES markets(id),
    timestamp TEXT NOT NULL,
    side TEXT NOT NULL,                     -- 'yes' or 'no'
    bids_json TEXT NOT NULL DEFAULT '[]',   -- JSON array: [{price, size}, ...]
    asks_json TEXT NOT NULL DEFAULT '[]',   -- JSON array: [{price, size}, ...]
    UNIQUE(market_id, timestamp, side)
);
CREATE INDEX IF NOT EXISTS idx_orderbook_market_time ON orderbook_snapshots(market_id, timestamp DESC);

-- Detected signals (deduplicated by signal_id)
CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id TEXT UNIQUE NOT NULL,         -- Deterministic: {type}:{market_id}:{window_key}
    market_id TEXT NOT NULL REFERENCES markets(id),
    signal_type TEXT NOT NULL,              -- complement|anchoring|low_attention|deadline
    detected_at TEXT NOT NULL,              -- When signal was first detected
    expires_at TEXT,                        -- Signal validity window
    score REAL NOT NULL,                    -- 0.0 to 1.0 raw signal score
    composite_score REAL,                   -- Weighted/ranked score
    edge_estimate REAL,                     -- Expected edge in cents (0-100 scale)
    direction TEXT,                         -- 'buy_yes' | 'buy_no' | null
    features_json TEXT NOT NULL,            -- All computed features for explainability
    rationale TEXT NOT NULL,                -- Human-readable explanation
    status TEXT DEFAULT 'active',           -- active|dismissed|traded|expired
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_signals_active ON signals(status, score DESC);
CREATE INDEX IF NOT EXISTS idx_signals_market ON signals(market_id, status);

-- Trade records (paper trading only for MVP)
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT UNIQUE NOT NULL,          -- UUID
    signal_id TEXT REFERENCES signals(signal_id),
    market_id TEXT NOT NULL REFERENCES markets(id),
    mode TEXT NOT NULL DEFAULT 'paper',     -- 'paper' | 'live' (future)
    side TEXT NOT NULL,                     -- 'yes' | 'no'
    direction TEXT NOT NULL,                -- 'buy' | 'sell'
    entry_price REAL NOT NULL,              -- Price at entry
    target_price REAL,                      -- Target exit price
    stop_loss_price REAL,                   -- Stop loss price
    size_usd REAL NOT NULL,                 -- Position size in USD
    size_shares REAL,                       -- Number of shares
    status TEXT DEFAULT 'open',             -- open|closed|cancelled
    exit_price REAL,                        -- Actual exit price
    exit_reason TEXT,                       -- target|stop|time|manual|resolution
    realized_pnl REAL,                      -- Profit/loss in USD
    entry_timestamp TEXT NOT NULL,
    exit_timestamp TEXT,
    max_hold_hours REAL,                    -- Time limit for position
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);

-- System state for tracking
CREATE TABLE IF NOT EXISTS system_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert initial state
INSERT OR IGNORE INTO system_state (key, value) VALUES ('last_ingest', '');
INSERT OR IGNORE INTO system_state (key, value) VALUES ('schema_version', '001');
