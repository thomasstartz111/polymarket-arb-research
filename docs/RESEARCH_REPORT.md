# Polymarket Arbitrage Research Report

**Date:** January 21, 2025
**Author:** Thomas Startz
**Status:** Analysis Complete

---

## Executive Summary

This research project investigates whether exploitable inefficiencies exist in Polymarket prediction markets. We built a comprehensive scanning infrastructure including real-time WebSocket feeds, historical backtesting, and semantic analysis of related markets.

**Primary Finding:** The market is highly efficient. Across 51,000+ price snapshots of 3,300+ markets over 12.6 hours, we found zero simple arbitrage opportunities. Yes + No prices sum to exactly 100.00% in every active market.

**Secondary Finding:** Cross-market analysis reveals minor logical inconsistencies (e.g., Oscar Best Actor nominations sum to 520% for 5 slots), but the ~4% edge is consumed by fees and spreads.

**Conclusion:** Alpha in prediction markets comes from information advantage, not execution edge.

---

## 1. Research Hypothesis

Prediction markets aggregate information through prices. We hypothesized that retail markets like Polymarket should exhibit exploitable inefficiencies:

| Hypothesis | Description |
|------------|-------------|
| Complement Arbitrage | Yes + No should sum to $1.00. Any deviation is free money. |
| Anchoring Bias | Sharp price moves on low volume may revert to mean. |
| Low Attention | Boring markets reprice slowly; edge persists longer. |
| Deadline Mispricing | Markets requiring formal acts tend to be overpriced. |
| Cross-Market Correlation | Related markets should maintain logical price relationships. |

---

## 2. Methodology

### 2.1 Data Collection Infrastructure

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA COLLECTION                               │
├─────────────────────────────────────────────────────────────────────┤
│  REST Polling     │  30-second interval, 5,000 market cap           │
│  WebSocket        │  Real-time CLOB feed, ~57 updates/30s           │
│  Storage          │  SQLite with full order book snapshots          │
│  Coverage         │  3,335 active binary markets                    │
│  Duration         │  12.6 hours continuous                          │
│  Total Snapshots  │  51,430                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Signal Detection Pipeline

```
┌──────────────────┐     ┌──────────────────┐
│  Complement Arb  │     │  Anchoring Bias  │
│  (Yes+No < $1)   │     │  (Fade big moves)│
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         ▼                        ▼
┌──────────────────────────────────────────┐
│           TRADABILITY GATE               │
│  • Spread < 5%                           │
│  • Depth > $500                          │
│  • Slippage < 2¢ for $250 order          │
└──────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐
│  Low Attention   │     │ Deadline Pressure│
│  (Score < 30)    │     │ (Formal acts)    │
└──────────────────┘     └──────────────────┘
```

### 2.3 Semantic Analysis (V2)

Added embedding-based market clustering using transformers.js:

- **Model:** all-MiniLM-L6-v2 (~80MB, local inference)
- **Method:** Cosine similarity on question embeddings
- **Cluster Types:** Range brackets, cumulative thresholds, semantic similar

Detects logical violations like:
- Range brackets not summing to 100%
- Cumulative thresholds violating monotonicity
- Win probability exceeding nomination probability

### 2.4 Backtest Framework

```typescript
const results = await runBacktest(signalFn, {
  positionSizeUsd: 100,
  maxConcurrentPositions: 5,
  roundTripFeePct: 2.0,
  defaultMaxHoldHours: 72,
});
```

**Metrics:** P&L, Sharpe Ratio, Sortino Ratio, Max Drawdown, Profit Factor, Win Rate

---

## 3. Data Summary

### 3.1 Collection Statistics

| Metric | Value |
|--------|-------|
| Total Snapshots | 51,430 |
| Markets Tracked | 3,335 |
| Collection Period | 12.6 hours |
| Avg Snapshots/Market | 15.4 |
| First Snapshot | 2025-01-21 04:38 UTC |
| Last Snapshot | 2025-01-21 17:15 UTC |

### 3.2 Market Categories

| Category | Examples |
|----------|----------|
| Politics | Elections, policy outcomes |
| Economics | Fed rates, inflation targets |
| Entertainment | Oscar nominations, Grammy awards |
| Sports | Game outcomes, player props |
| Crypto | BTC/ETH price targets |
| Tech | IPO valuations, product launches |

---

## 4. Findings

### 4.1 Complement Arbitrage: None Found

**Result: Zero opportunities across 51,430 snapshots.**

Every active market prices perfectly:
```
Yes + No = 100.00%
```

The CLOB mechanism keeps complementary tokens in lockstep. Market makers arbitrage deviations faster than 30-second polling can detect.

### 4.2 Fed Rate Markets: Efficient

Fed rate cut markets for 2026 were analyzed:

| Cuts | Probability | Depth |
|------|-------------|-------|
| 0 | 5.1% | $37k |
| 1 | 8.5% | $4k |
| 2 | 23.5% | $26k |
| 3 | 26.5% | $8k |
| 4 | 16.0% | $29k |
| 5 | 7.5% | $23k |
| 6+ | 10.4% | varies |
| **Total** | **97.5%** | |

Sum of 97.5% is within expected range (some edge cases not captured). No mispricing detected.

### 4.3 Oscar Markets: Minor Inefficiency

**Best Actor Nominations (5 slots):**

| Actor | Nomination % | Depth |
|-------|-------------|-------|
| Leonardo DiCaprio | 99.9% | $0 (illiquid) |
| Timothée Chalamet | 99.9% | $13k |
| Michael B. Jordan | 94.7% | $3k |
| Wagner Moura | 88.6% | $3k |
| Ethan Hawke | 71.0% | $0 (illiquid) |
| Jesse Plemons | 40.0% | $6k |
| Others | 26.5% | varies |
| **Total** | **520.6%** | |

**Finding:** Market is ~4% overpriced collectively (520% vs 500% expected).

**Tradeable?** No. The 4% edge is consumed by:
- 2% round-trip fees
- Bid-ask spread (~1-2%)
- Execution slippage

### 4.4 Tradability Analysis

Most detected signals fail tradability checks:

| Signal | Edge | Spread | Depth | Tradeable? |
|--------|------|--------|-------|------------|
| Fed 50bp deadline | 22¢ | 100% | $0 | No |
| Oscar over-allocation | 4% | 0% | varies | Marginal |
| Low attention markets | varies | >10% | <$100 | No |

### 4.5 Price Movement Analysis

Markets with largest price swings during collection:

| Market | Min | Max | Move |
|--------|-----|-----|------|
| Brest Ligue 1 top 4 | 3.9% | 26.5% | +22.7% |
| Benfica UCL advance | 10.0% | 29.5% | +19.5% |
| Freiburg Bundesliga | 5.5% | 22.0% | +16.5% |

These are sports markets with legitimate news-driven moves, not mean-reversion opportunities.

---

## 5. Technical Implementation

### 5.1 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Polymarket API │────▶│     Scanner     │────▶│     SQLite      │
│  (REST + CLOB)  │     │  (30s polling)  │     │   (51k rows)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        ▼                                               ▼
┌─────────────────┐                             ┌─────────────────┐
│    WebSocket    │────────────────────────────▶│  Signal Engine  │
│  (57 msgs/30s)  │                             │  + Backtest     │
└─────────────────┘                             └─────────────────┘
```

### 5.2 Key Components

| Component | File | Purpose |
|-----------|------|---------|
| WebSocket Client | `src/api/websocket.ts` | Real-time CLOB streaming |
| Backtest Engine | `src/backtest/index.ts` | Historical replay |
| Metrics | `src/backtest/metrics.ts` | Sharpe, Sortino, drawdown |
| Correlation V2 | `src/signals/correlation-v2.ts` | Semantic clustering |
| Embeddings | `src/signals/embeddings.ts` | Local transformer model |

### 5.3 WebSocket Performance

```typescript
// Connect to Polymarket CLOB WebSocket
const ws = new PolymarketWebSocket();
await ws.connect();
ws.subscribe(tokenId);

// Receive real-time updates
ws.on('price', (update) => {
  // ~57 updates per 30 seconds during active trading
  console.log(update.bestBid, update.bestAsk, update.mid);
});
```

Message types observed:
- `book` - Full orderbook snapshot
- `price_change` - Order placed/cancelled
- `last_trade_price` - Trade execution
- `best_bid_ask` - Best quotes update

---

## 6. Conclusions

### 6.1 Primary Finding

**Polymarket is far more efficient than expected.**

The CLOB infrastructure eliminates simple arbitrage. Yes + No prices maintain exactly 100.00% across all active markets. This is a mature, well-arbitraged market.

### 6.2 Why Arbitrage Failed

| Factor | Impact |
|--------|--------|
| CLOB efficiency | Deviations arbitraged in milliseconds |
| 30-second polling | Too slow to catch fleeting opportunities |
| 2% fees | Kills edges under 3 cents |
| Wide spreads | Most markets untradeable |
| Low depth | Can't size positions profitably |

### 6.3 Where Alpha Might Exist

The remaining edge is not in execution but in information:

1. **Domain expertise** - Know outcomes before the market
2. **Event timing** - Trade before news breaks (Oscar nominations, earnings)
3. **Cross-market logic** - Find inconsistencies in related markets
4. **Niche markets** - Lower attention = slower price discovery

### 6.4 Recommendations

For prediction market trading:

| Strategy | Viability |
|----------|-----------|
| Simple arbitrage (Yes+No) | Not viable |
| Mean reversion | Not viable (moves are information) |
| Cross-market arb | Marginal (fees eat edge) |
| Information edge | Viable if you have domain expertise |
| Event trading | Viable during price discovery windows |

---

## 7. Future Work

### 7.1 Extended Data Collection

- Run scanner for 7+ days to capture full market cycles
- Monitor major events (Oscar nominations, Super Bowl, Fed decisions)
- Track price discovery speed after news breaks

### 7.2 Analysis Extensions

- Implement HFT-style WebSocket monitoring for sub-second edges
- Build correlation dashboard for real-time cross-market analysis
- Add sentiment analysis from news/social feeds

### 7.3 Upcoming Events

| Event | Date | Opportunity |
|-------|------|-------------|
| Oscar Nominations | Jan 23, 2025 | Price discovery chaos |
| Super Bowl | Jan 26, 2025 | Prop bet mispricing |
| Fed Rate Decision | Jan 29, 2025 | Institutional flow |

---

## 8. Appendix

### 8.1 SQL Analysis Queries

```sql
-- Complement arbitrage check
SELECT market_id,
       ROUND((price_yes + price_no) * 100, 2) as sum_pct
FROM market_snapshots
WHERE ABS(price_yes + price_no - 1.0) > 0.001;
-- Result: 0 rows (perfect efficiency)

-- Cross-market sum check
SELECT category, ROUND(SUM(price_yes) * 100, 1) as total_pct
FROM market_snapshots s
JOIN markets m ON s.market_id = m.id
WHERE m.question LIKE '%Best Actor%nominated%'
GROUP BY category;
-- Result: 520.6% (should be ~500%)
```

### 8.2 Configuration

```typescript
const config = {
  polling: { intervalMs: 30000, marketLimit: 5000 },
  signals: {
    complement: { deviationThreshold: 0.01 },
    anchoring: { priceChangeThreshold: 0.03 },
    attention: { lowAttentionThreshold: 60 },
    deadline: { mispricingThreshold: 0.05 },
  },
  risk: {
    maxPositionUsd: 500,
    roundTripFeePct: 2.0,
    minDepthUsd: 500,
  },
};
```

### 8.3 References

- [Polymarket CLOB API Documentation](https://docs.polymarket.com)
- [Polymarket WebSocket Channels](https://docs.polymarket.com/#websocket-channels)
- [transformers.js (Hugging Face)](https://huggingface.co/docs/transformers.js)

---

*Report completed January 21, 2025.*
