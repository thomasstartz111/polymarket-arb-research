# Polymarket Scanner — User Manual

## Quick Start

```bash
# Terminal 1: Start the scanner (ingester + API)
npm run dev

# Terminal 2: Start the dashboard
cd ui && npm run dev
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:5173 |
| API | http://localhost:3000 |

---

## What Happens When You Start

1. **Ingester polls Polymarket** every 30 seconds
2. **Stores snapshots** of all active markets (price, volume, order book)
3. **Signal engine runs** after each poll:
   - Computes 4 signal types
   - Gates with tradability checks
   - Ranks and stores active signals
4. **API serves** signals to the dashboard

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/signals` | GET | Ranked active signals (your main view) |
| `/api/markets` | GET | All tracked markets |
| `/api/markets/:id` | GET | Single market with order book |
| `/api/trades` | GET | Paper trade history |
| `/api/trades` | POST | Execute a paper trade |
| `/api/stats` | GET | System statistics |

### Example: Get Active Signals
```bash
curl http://localhost:3000/api/signals | jq
```

### Example: Paper Trade
```bash
curl -X POST http://localhost:3000/api/trades \
  -H "Content-Type: application/json" \
  -d '{
    "signalId": "anchoring:abc123:2026010612",
    "marketId": "abc123",
    "side": "yes",
    "sizeUsd": 100,
    "strategy": "mean_reversion"
  }'
```

---

## Dashboard Usage

### Signal Queue (Main View)
- Shows ranked signals by composite score
- Color-coded by type: Complement | Anchoring | Attention | Deadline
- Click a signal to see market details

### Signal Card Shows:
- **Score** — Composite ranking (0-1)
- **Edge** — Expected edge in cents
- **Direction** — buy_yes, buy_no, or buy_both
- **Tradability** — Spread, depth, slippage metrics
- **Rationale** — Human-readable explanation

### Actions:
- **Trade** — Opens paper trade form
- **Dismiss** — Removes from queue (won't resurface)
- **Drill Down** — View market order book and history

---

## Tuning Thresholds

Edit `src/config/index.ts`:

```typescript
signals: {
  complement: {
    enabled: true,
    deviationThreshold: 0.03,  // Lower = more signals
  },
  anchoring: {
    enabled: true,
    priceChangeThreshold: 0.08, // Lower = more signals
    volumeRatioThreshold: 0.5,  // Higher = more signals
  },
  attention: {
    enabled: true,
    lowAttentionThreshold: 30,  // Higher = more signals
  },
  deadline: {
    enabled: true,
    mispricingThreshold: 0.15,  // Lower = more signals
  },
}
```

Restart `npm run dev` after changes.

---

## Risk Parameters

```typescript
risk: {
  totalBankrollUsd: 10000,      // Paper trading bankroll
  maxPositionPct: 0.05,         // 5% max = $500 per trade
  maxPositionUsd: 500,          // Hard cap per position
  minMarketLiquidityUsd: 1000,  // Skip thin markets
  maxBookImpactPct: 0.05,       // Don't move the market
  dailyLossLimitPct: 0.05,      // Circuit breaker: -5%
  consecutiveLossLimit: 5,      // Circuit breaker: 5 losses
}
```

---

## Signal Types Cheat Sheet

| Signal | What it finds | Direction | Hold time |
|--------|---------------|-----------|-----------|
| **Complement** | Yes+No < $0.98 | buy_both | Until resolution |
| **Anchoring** | >8% move on low volume | Contrarian | 2-24 hours |
| **Low Attention** | Boring markets | Context only | — |
| **Deadline** | Overpriced Yes on formal acts | buy_no | Until deadline |

---

## Workflow: Evaluating a Signal

1. **Check tradability** — Is spread <5%? Depth >$500? Slippage <2c?
2. **Check rationale** — Does the edge make sense given the market?
3. **Check news** — Is there a reason for the move you're fading?
4. **Size conservatively** — Start at $50-100, not max
5. **Set exit** — Mean reversion targets 50% reversion; deadline holds to resolution

---

## Running in Background

```bash
# Start scanner as background process
nohup npm run dev > scanner.log 2>&1 &

# Check if running
ps aux | grep "tsx watch"

# View logs
tail -f scanner.log
```

---

## Troubleshooting

### Port already in use
```bash
lsof -ti:3000 | xargs kill -9
npm run dev
```

### No signals appearing
- Signals require strict conditions (large moves, low volume, tradable books)
- Check `/api/stats` to confirm ingestion is working
- Lower thresholds in config if you want more signals (but expect more noise)

### 401 errors on /trades endpoint
- Polymarket now requires authentication for trade history
- This doesn't affect core functionality (markets, order books, signals)
- Trade history is supplementary data for volume calculations

---

## Architecture

```
Polymarket API -> Ingester -> SQLite -> Signal Engine -> API Server -> React Dashboard
                   (30s)               (4 signals)
```

### Key Files
| Path | Purpose |
|------|---------|
| `src/config/index.ts` | All tunable parameters |
| `src/signals/` | Signal detection logic |
| `src/trading/risk.ts` | Risk management |
| `data/polymarket.db` | SQLite database |
