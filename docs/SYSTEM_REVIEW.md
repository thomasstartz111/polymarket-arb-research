# Polymarket Scanner - System Review for Expert Analysis

## Executive Summary

This is a real-time prediction market scanner for Polymarket that detects trading signals, gates them with tradability checks, and supports paper trading. Built with TypeScript, SQLite, and React.

**Status**: MVP complete with V2 signal improvements (executable prices, tradability gating, anchoring debounce).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     POLYMARKET CLOB API                         │
│              https://clob.polymarket.com                        │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTP GET (public, no auth)
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      INGESTER (30s poll)                        │
│  src/ingester/index.ts                                          │
│  - Fetches /markets (6000+ markets, capped at 5000)             │
│  - Fetches /book for each token (Yes/No order books)            │
│  - Extracts: best_bid, best_ask, midpoint, depth                │
│  - Stores snapshots to SQLite                                   │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SQLITE DATABASE                            │
│  data/polymarket.db                                             │
│                                                                 │
│  Tables:                                                        │
│  - markets (id, question, end_date, tokens, active)             │
│  - market_snapshots (price_yes, price_no, bid/ask, mid, depth)  │
│  - orderbook_snapshots (bids_json, asks_json per side)          │
│  - signals (signal_id, type, score, rationale, status)          │
│  - trades (paper trades with entry/exit/pnl)                    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SIGNAL ENGINE (V2)                           │
│  src/signals/index.ts                                           │
│                                                                 │
│  1. Tradability Gate (FIRST)                                    │
│     - Skip if spread > 5%                                       │
│     - Skip if depth < $500                                      │
│     - Skip if slippage for $250 > 2 cents                       │
│                                                                 │
│  2. Run 4 Signal Detectors (on tradable markets only)           │
│     └─> Complement, Anchoring, Attention, Deadline              │
│                                                                 │
│  3. Enrich signals with tradability + book state                │
│  4. Store to database with rationale                            │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS API SERVER                           │
│  src/server/index.ts (port 3000)                                │
│                                                                 │
│  GET /api/signals   - Ranked active signals                     │
│  GET /api/markets   - List markets with latest snapshot         │
│  GET /api/markets/:id - Market detail + order book + history    │
│  POST /api/trades   - Execute paper trade                       │
│  GET /api/trades    - List trades with P&L                      │
│  GET /api/stats     - System statistics                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    REACT DASHBOARD                              │
│  ui/ (Vite + React + Tailwind, port 5173)                       │
│                                                                 │
│  - Signal queue with ranking                                    │
│  - Market drilldown (book, history chart)                       │
│  - Trade execution modal                                        │
│  - P&L tracking                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Signal Specifications

### 1. Complement Signal (V2 - Executable Arb)

**File**: `src/signals/complement.ts`

**Purpose**: Detect true arbitrage when buying both Yes + No costs less than $1 (guaranteed payout).

**V1 Problem**: Used `token.price` (indicative/last trade) which is often stale or unfillable.

**V2 Fix**: Uses executable prices from order book.

```typescript
// V2 Calculation
costToBuyBoth = yesAsk + noAsk;  // What you actually pay
arbBuyBoth = 1.0 - costToBuyBoth - feeRate - slippageBuffer;

// Only trigger if positive edge after ALL costs
isTriggered = arbBuyBoth > 0;
```

**Trigger Conditions**:
- `yesAsk + noAsk < 0.975` (after 2% fees + 0.5% slippage buffer)

**Output**:
```typescript
{
  arbBuyBoth: number,        // Edge in dollars
  costToBuyBoth: number,     // Actual cost
  recommendedAction: 'cross' | 'rest' | 'pass',
  edgeCents: number
}
```

**Known Limitations**:
- True arbs are rare and get arbitraged quickly
- Execution risk: by the time you trade, books may have moved
- Does not account for partial fills across legs

---

### 2. Anchoring/Overreaction Signal (V2 - With Debounce)

**File**: `src/signals/anchoring.ts`

**Purpose**: Fade sharp price moves on low volume that may revert to mean.

**V1 Problems**:
- Used last trade price (not executable)
- Fired on single bad prints
- Fired on spread changes that aren't real belief changes
- No check for whether move was "real info"

**V2 Fixes**:
1. Uses **midpoint** from order book
2. Requires **persistence**: move present for 3+ consecutive snapshots
3. Checks **momentum exhaustion**: no new highs/lows in direction of move

```typescript
// V2 Trigger Conditions (ALL must be true)
isLargeMove = |midNow - mid60mAgo| > 8%;
isLowVolume = volumeRatio < 50% of average;
isPersistent = persistentSnapshots >= 3;
momentumExhausted = no new highs/lows in last 3 snapshots;

isTriggered = isLargeMove && isLowVolume && isPersistent && momentumExhausted;
```

**Direction**: Contrarian (fade the move)
- Price up → buy No
- Price down → buy Yes

**Mean Target**: Expects 50% reversion to prior level.

**Known Limitations**:
- Doesn't distinguish "random noise" from "leaked info that hasn't fully priced"
- Volume data from trades endpoint requires auth (currently using estimates)
- No sentiment/news integration to validate "no new info"

---

### 3. Low Attention Signal

**File**: `src/signals/attention.ts`

**Purpose**: Find "boring" markets with slow repricing where edge may persist longer.

**Formula**:
```typescript
attentionScore = (
  volumeScore * 0.35 +      // Volume vs total market volume
  liquidityScore * 0.25 +   // Order book depth
  activityScore * 0.30 +    // Trade count
  recencyScore * 0.10       // Time since last trade
);

isLowAttention = attentionScore < 30;
```

**V2 Improvement**: Gated by tradability first, so won't recommend untradable markets.

**Known Limitations**:
- Low attention ≠ mispriced (could just be efficient + boring)
- Needs domain knowledge to identify which low-attention markets have edge
- Should be combined with another signal (e.g., deadline) to be actionable

---

### 4. Deadline Pressure Signal

**File**: `src/signals/deadline.ts`

**Purpose**: Detect overpriced Yes on markets requiring "formal acts" (legislation, rulings, regulatory approval) where probability should decay if nothing happens.

**Formal Act Detection** (keyword matching):
```typescript
formalActKeywords = [
  'pass', 'approve', 'sign', 'ruling', 'verdict', 'legislation',
  'bill', 'act', 'law', 'court', 'judge', 'congress', 'senate'
];
```

**Trigger**:
```typescript
requiresFormalAct = keywords found in question or description;
mispricing = priceYes - baseRateEstimate;

isTriggered = requiresFormalAct && mispricing > 0.15 && hoursToResolution > 24;
```

**Direction**: Buy No (betting against overpriced Yes)

**Known Limitations**:
- `baseRateEstimate` is currently hard-coded/heuristic (not data-driven)
- Keyword matching is brittle (false positives/negatives)
- Doesn't account for actual news flow or insider info
- Resolution criteria text parsing is naive

---

## Tradability Module

**File**: `src/signals/tradability.ts`

**Purpose**: Gate ALL signals to prevent recommending untradable markets.

**Criteria** (must pass ALL):
| Check | Threshold | Rationale |
|-------|-----------|-----------|
| Spread | < 5% | Wide spreads eat edge |
| Depth | > $500 within 1% of mid | Need liquidity to enter/exit |
| Slippage | < 2¢ for $250 order | Execution cost must be reasonable |

**Slippage Calculation**:
```typescript
// Walks the order book to estimate fill price
function estimateSlippage(levels, sizeUsd, side) {
  // For each level, accumulate until sizeUsd is filled
  // Return: (avgFillPrice - startPrice) / startPrice * 100
}
```

**Output**:
```typescript
{
  score: 0-100,           // Composite tradability score
  spreadPct: number,
  depthUsd: number,
  slippageFor250: number, // Cents slippage for $250 order
  isTradable: boolean,
  reason?: string         // Why not tradable
}
```

---

## Trading System

### Risk Parameters

**File**: `src/config/index.ts`

```typescript
risk: {
  totalBankrollUsd: 10000,
  maxPositionPct: 0.05,        // 5% per position ($500 max)
  maxPositionUsd: 500,
  maxEventExposurePct: 0.10,   // 10% max on correlated markets
  maxTotalExposurePct: 0.50,   // 50% max total exposure
  minMarketLiquidityUsd: 1000,
  maxBookImpactPct: 0.05,      // 5% max slippage
  minHoursToResolution: 24,    // Don't trade markets resolving soon
  dailyLossLimitPct: 0.05,     // 5% daily loss circuit breaker
  consecutiveLossLimit: 5,
}
```

### Trade Strategies

**File**: `src/trading/planner.ts`

1. **Mean Reversion** (for anchoring signals)
   - Entry: At current price
   - Exit: At mean target OR after 24h
   - Stop loss: 10% adverse move
   - Take profit: At mean reversion target

2. **Time Decay** (for deadline signals)
   - Entry: At current price
   - Exit: Hold until resolution
   - No stop loss (thesis is probabilistic)

### Paper Executor

**File**: `src/trading/paper.ts`

- Simulates trades with realistic fills (uses order book)
- Tracks entry/exit/P&L
- Respects risk limits
- No real money ever touches Polymarket

---

## Data Flow

### Ingest Cycle (every 30 seconds)

```
1. GET /markets → 5000 market objects
2. For each binary market:
   a. GET /book/{yesTokenId} → order book
   b. GET /book/{noTokenId} → order book
   c. Extract: bestBid, bestAsk, midpoint, depth
   d. INSERT INTO market_snapshots
   e. INSERT INTO orderbook_snapshots
3. Signal engine processes new snapshots
4. Tradability gate filters markets
5. Run 4 signal detectors
6. Store triggered signals with rationale
```

### Signal Generation

```
For each market with new snapshot:
  1. Fetch order books from DB
  2. Compute tradability score
  3. IF tradability.isTradable AND score >= 30:
     a. Run complement signal (with executable prices)
     b. Run anchoring signal (with midpoints + history)
     c. Run attention signal
     d. Run deadline signal
  4. IF any signal triggered:
     a. Enrich with tradability + book state
     b. Store to signals table
     c. Add to ranked queue
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/signals` | GET | Ranked active signals with tradability info |
| `/api/markets` | GET | List markets with latest snapshot |
| `/api/markets/:id` | GET | Market detail + order book + price history |
| `/api/trades` | POST | Execute paper trade from signal |
| `/api/trades` | GET | List trades with P&L |
| `/api/stats` | GET | System statistics |

---

## Known Issues & Improvement Areas

### Data Quality

1. **Trades endpoint returns 401**: Volume/trade count data is estimated, not actual. Polymarket requires auth for trade history.

2. **Many "active" markets are resolved**: The API returns historical markets as active=true. These have empty order books.

3. **No real-time WebSocket**: Using 30s polling. Misses fast-moving arb opportunities.

### Signal Logic

1. **Complement arb**: True arbs are rare. Consider "near-arb" detection where you rest orders.

2. **Anchoring**: `baseRateEstimate` for deadline signal is not data-driven. Should use historical resolution rates.

3. **Attention signal**: Needs domain knowledge layer. Low attention alone isn't actionable.

4. **Deadline keywords**: Brittle keyword matching. Consider NLP/LLM classification.

### Execution

1. **Paper only**: No real execution. Would need Polymarket API keys + wallet integration.

2. **No partial fill handling**: Assumes full fills at book prices.

3. **No multi-leg execution**: Complement arb requires buying both sides atomically.

### Risk

1. **Position limits may be too large**: 5% per position is aggressive for thin markets.

2. **No correlation handling**: Could over-expose to related markets (e.g., multiple Trump markets).

3. **No resolution risk scoring**: Some markets have ambiguous resolution criteria.

---

## File Structure

```
polymarket-scanner/
├── migrations/
│   ├── 001_initial.sql          # Core tables
│   └── 002_add_book_metrics.sql # V2: bid/ask/mid columns
├── src/
│   ├── api/
│   │   ├── polymarket.ts        # API client with retry logic
│   │   └── types.ts             # Polymarket API types
│   ├── config/
│   │   └── index.ts             # All configuration
│   ├── db/
│   │   └── client.ts            # SQLite + migrations
│   ├── ingester/
│   │   └── index.ts             # 30s polling loop
│   ├── server/
│   │   └── index.ts             # Express API
│   ├── signals/
│   │   ├── index.ts             # Signal engine orchestrator
│   │   ├── complement.ts        # V2: executable arb
│   │   ├── anchoring.ts         # V2: with debounce
│   │   ├── attention.ts         # Low attention filter
│   │   ├── deadline.ts          # Formal act detection
│   │   ├── tradability.ts       # NEW: tradability gate
│   │   ├── ranking.ts           # Signal ranking
│   │   └── types.ts             # Signal interfaces
│   ├── trading/
│   │   ├── planner.ts           # Trade plan generator
│   │   ├── risk.ts              # Risk checks
│   │   └── paper.ts             # Paper executor
│   └── index.ts                 # Entry point
├── ui/                          # React dashboard
│   └── src/
│       ├── App.tsx
│       └── components/
│           ├── SignalQueue.tsx
│           ├── MarketDrilldown.tsx
│           └── ...
└── docs/
    └── SYSTEM_REVIEW.md         # This file
```

---

## Questions for Expert Review

1. **Complement arb**: Is the executable price calculation correct? Should we account for partial fill risk across legs?

2. **Anchoring debounce**: Is 3-snapshot persistence enough? Should momentum exhaustion check be more sophisticated?

3. **Tradability thresholds**: Are 5% spread / $500 depth / 2¢ slippage appropriate for Polymarket microstructure?

4. **Base rate estimation**: How should we model "base rate" for deadline pressure? Historical resolution rates? LLM inference?

5. **Risk sizing**: Is 5% per position too aggressive? How should we handle correlated markets?

6. **Missing signals**: What other edges exist in prediction markets that we should detect?

---

## Running the System

```bash
# Backend (port 3000)
cd polymarket-scanner
npm install
npm run dev

# Frontend (port 5173)
cd ui
npm install
npm run dev
```

Dashboard: http://localhost:5173
API: http://localhost:3000/api/stats
