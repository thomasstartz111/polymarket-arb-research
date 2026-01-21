# Polymarket Arbitrage Research

Research project exploring arbitrage and mispricing opportunities in Polymarket prediction markets.

## What This Does

A TypeScript system that ingests Polymarket data, detects signals, and backtests trading strategies.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Polymarket API │────▶│     Scanner     │────▶│     SQLite      │
│  (REST + CLOB)  │     │  (30s polling)  │     │  (3,300+ mkts)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
┌─────────────────┐     ┌─────────────────┐             │
│    WebSocket    │────▶│  Real-time Bid  │             │
│   (CLOB feed)   │     │   Ask Updates   │             ▼
└─────────────────┘     └─────────────────┘     ┌─────────────────┐
                                                │  Signal Engine  │
┌─────────────────┐     ┌─────────────────┐     │  - Correlation  │
│    Backtest     │◀────│  Semantic       │◀────│  - Anchoring    │
│    Framework    │     │  Embeddings     │     │  - Attention    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Current Data

| Metric | Value |
|--------|-------|
| Markets tracked | 3,336 |
| Price snapshots | 33,000+ |
| Polling interval | 30 seconds |
| WebSocket updates | ~57/30s during active trading |

## Key Finding: Market Is Efficient

Across all snapshots:

```
Yes + No = 100.00%  (every single market)
```

The CLOB keeps complementary tokens perfectly priced. No simple arbitrage exists.

## Where Alpha Might Live

After scanning thousands of markets, the pattern:

| Market Type | Opportunity |
|-------------|-------------|
| Fed rate markets | Skip - institutional hedging proxy |
| High-profile politics | Skip - too many eyes |
| Entertainment (Oscars) | Watch - less sophisticated |
| Sports props | Watch - relative mispricing |
| IPO thresholds | Watch - cumulative logic errors |

## Components

### 1. Market Scanner (`src/index.ts`)

Polls Polymarket every 30s, stores market metadata and price snapshots.

### 2. WebSocket Client (`src/api/websocket.ts`)

Real-time CLOB feed for millisecond price updates:

```typescript
const ws = new PolymarketWebSocket();
await ws.connect();
ws.subscribe(tokenId);
ws.on('price', (update) => {
  console.log(update.bestBid, update.bestAsk);
});
```

### 3. Signal Detection (`src/signals/`)

- **V1 Correlation** - String matching for related markets
- **V2 Semantic** - Embedding-based clustering with transformers.js
- **Anchoring** - Price moves on low volume
- **Attention** - Low activity markets

### 4. Backtest Framework (`src/backtest/`)

Replay historical snapshots through signal strategies:

```typescript
const results = await runBacktest(mySignalFn, {
  positionSizeUsd: 100,
  maxConcurrentPositions: 5,
  roundTripFeePct: 2.0,
});

console.log(results.metrics.sharpeRatio);
console.log(results.metrics.maxDrawdown);
```

Metrics: P&L, Sharpe, Sortino, max drawdown, profit factor.

### 5. React Dashboard (`ui/`)

Visual interface for monitoring signals and markets.

## Quick Start

```bash
npm install
cp .env.example .env

# Start scanner + API
npm run dev

# Dashboard (separate terminal)
cd ui && npm install && npm run dev
```

- Scanner/API: http://localhost:3001
- Dashboard: http://localhost:5173

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/signals` | Active signals ranked by score |
| `GET /api/markets` | All tracked markets |
| `GET /api/markets/:id` | Market details + order book |
| `GET /api/stats` | System statistics |

## Tech Stack

- TypeScript / Node.js
- SQLite (better-sqlite3)
- WebSocket (ws)
- transformers.js (local embeddings)
- React + Recharts (dashboard)

## What I Learned

1. **Complement arbitrage doesn't exist** - CLOB keeps Yes/No perfectly balanced
2. **30s polling too slow** - Real edges taken in milliseconds
3. **Fees kill small edges** - 2% round-trip eats sub-3-cent arbs
4. **Information > Execution** - Edge comes from knowing something, not speed

## Documentation

| Document | Description |
|----------|-------------|
| [Research Report](docs/RESEARCH_REPORT.md) | Comprehensive findings and methodology |
| [System Review](docs/SYSTEM_REVIEW.md) | Technical architecture deep-dive |
| [Experiment Plan](docs/EXPERIMENT_V2.md) | V2 experiment design |
| [Dev Log](content/ideas/polymarket-arb-research.md) | Narrative write-up |

## License

MIT
