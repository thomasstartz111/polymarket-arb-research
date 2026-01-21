# Polymarket Arbitrage Research

**Can you find exploitable inefficiencies in prediction markets?**

I built a scanning system to find out. Short answer: No. The market is brutally efficient.

## Key Findings

| Test | Result |
|------|--------|
| Complement Arbitrage (Yes + No ≠ $1) | 0 opportunities in 51,430 snapshots |
| Fed Rate Market Sum | 97.5% (correctly priced) |
| Oscar Nomination Sum | 520% for 5 slots (4% over, but fees eat it) |
| Tradeable Signals | 0 after spread/depth filters |

**Conclusion:** Polymarket's CLOB keeps Yes + No at exactly 100.00%. Alpha comes from information advantage, not execution edge.

## Data Collected

```
Markets Tracked:    3,335
Price Snapshots:    51,430
Collection Period:  12.6 hours
WebSocket Updates:  ~57 per 30 seconds
```

## Architecture

```
Polymarket API ──▶ Scanner (30s) ──▶ SQLite (51k rows)
       │                                    │
       ▼                                    ▼
   WebSocket ─────────────────────▶ Signal Engine
  (real-time)                       + Backtest
```

### Components

| Component | Description |
|-----------|-------------|
| **Scanner** | Polls 5,000+ markets every 30 seconds |
| **WebSocket** | Real-time CLOB feed for millisecond updates |
| **Signal Engine** | Detects complement arb, anchoring, deadline, attention signals |
| **Backtest** | Replay historical data with P&L, Sharpe, Sortino metrics |
| **Semantic Analysis** | Embedding-based clustering to find related markets |

## Quick Start

```bash
# Install
npm install

# Run scanner + API
npm run dev

# Dashboard (separate terminal)
cd ui && npm install && npm run dev
```

- **API:** http://localhost:3000
- **Dashboard:** http://localhost:5173

## Signal Types

### 1. Complement Arbitrage
If Yes + No < $1.00, buy both for guaranteed profit. **Result:** Never found—market is perfectly efficient.

### 2. Cross-Market Correlation
Related markets should maintain logical relationships. Example: Oscar Best Actor nominations should sum to ~500% (5 slots).

**Finding:** Sum was 520.6%—market 4% overpriced. But 2% fees + spread eliminates the edge.

### 3. Deadline Pressure
Markets requiring formal acts (legislation, rulings) may be overpriced on "Yes."

### 4. Low Attention
Boring markets reprice slowly. Potential for stale prices.

## Why Arbitrage Failed

1. **CLOB efficiency** - Deviations arbitraged in milliseconds
2. **30-second polling** - Too slow for fleeting opportunities
3. **2% fees** - Kills edges under 3 cents
4. **Wide spreads** - Most markets untradeable
5. **Low depth** - Can't size positions profitably

## Where Alpha Might Exist

| Opportunity | Viability |
|-------------|-----------|
| Simple arbitrage | ❌ Not viable |
| Mean reversion | ❌ Moves are information |
| Cross-market arb | ⚠️ Marginal (fees eat edge) |
| Information edge | ✅ If you have domain expertise |
| Event trading | ✅ During price discovery |

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Database:** SQLite (better-sqlite3)
- **Real-time:** WebSocket (ws)
- **ML:** transformers.js (local embeddings)
- **Frontend:** React + Vite + Tailwind

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/signals` | Active signals ranked by score |
| `GET /api/markets` | All tracked markets |
| `GET /api/markets/:id` | Market details + order book |
| `GET /api/stats` | System statistics |

## Documentation

| Document | Description |
|----------|-------------|
| [Research Report](docs/RESEARCH_REPORT.md) | Full methodology and findings |
| [System Review](docs/SYSTEM_REVIEW.md) | Technical architecture deep-dive |
| [Experiment Plan](docs/EXPERIMENT_V2.md) | V2 experiment design |

## Project Structure

```
├── src/
│   ├── api/
│   │   └── websocket.ts      # Real-time CLOB streaming
│   ├── backtest/
│   │   ├── index.ts          # Backtest runner
│   │   ├── metrics.ts        # Sharpe, Sortino, drawdown
│   │   └── types.ts          # Type definitions
│   ├── signals/
│   │   ├── correlation-v2.ts # Semantic clustering
│   │   ├── embeddings.ts     # Local transformer model
│   │   └── index.ts          # Signal engine
│   └── index.ts              # Entry point
├── ui/                       # React dashboard
├── data/                     # SQLite database
└── docs/                     # Documentation
```

## License

MIT

---

*Built by [Thomas Startz](https://github.com/thomasstartz111) with Claude Code.*
