# Polymarket Arbitrage Research Report

**Date:** January 2025
**Author:** Thomas Startz
**Status:** Ongoing data collection

---

## Executive Summary

This research project investigates whether exploitable inefficiencies exist in Polymarket prediction markets. We built a comprehensive scanning infrastructure including real-time WebSocket feeds, historical backtesting, and semantic analysis of related markets.

**Key Finding:** The market is highly efficient. Across 33,000+ price snapshots of 3,300+ markets, we found zero simple arbitrage opportunities. Yes + No prices sum to exactly 100.00% in every active market.

**Implication:** Alpha in prediction markets comes from information advantage, not execution edge.

---

## 1. Research Hypothesis

Prediction markets aggregate information through prices. Retail markets like Polymarket should exhibit exploitable inefficiencies:

1. **Complement Arbitrage** - Yes + No should sum to $1.00. Any deviation is free money.
2. **Anchoring Bias** - Sharp price moves on low volume may revert to mean.
3. **Low Attention** - Boring markets reprice slowly; edge persists longer.
4. **Deadline Mispricing** - Markets requiring formal acts (legislation, rulings) tend to be overpriced.
5. **Cross-Market Correlation** - Related markets should maintain logical price relationships.

---

## 2. Methodology

### 2.1 Data Collection

| Component | Implementation |
|-----------|----------------|
| REST Polling | 30-second interval, 5,000 market limit |
| WebSocket | Real-time CLOB feed (wss://ws-subscriptions-clob.polymarket.com) |
| Storage | SQLite with full order book snapshots |
| Markets Tracked | 3,336 active binary markets |

### 2.2 Signal Detection

Four signal types implemented in V1:

```
┌──────────────────┐     ┌──────────────────┐
│  Complement Arb  │     │  Anchoring Bias  │
│  (Yes+No < $1)   │     │  (Fade big moves)│
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         ▼                        ▼
┌──────────────────────────────────────────┐
│           TRADABILITY GATE               │
│  - Spread < 5%                           │
│  - Depth > $500                          │
│  - Slippage < 2¢ for $250 order          │
└──────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐
│  Low Attention   │     │ Deadline Pressure│
│  (Score < 30)    │     │ (Formal acts)    │
└──────────────────┘     └──────────────────┘
```

### 2.3 V2 Enhancements: Semantic Analysis

Added embedding-based market clustering using transformers.js:

- **Model:** all-MiniLM-L6-v2 (~80MB, local inference)
- **Method:** Cosine similarity on question embeddings
- **Cluster Types:** Range brackets, cumulative thresholds, semantic similar

This detects logical violations like:
- Range brackets not summing to 100%
- Cumulative thresholds violating monotonicity (e.g., "at least 5%" should > "at least 10%")

### 2.4 Backtest Framework

Replay historical snapshots through signal strategies:

```typescript
const results = await runBacktest(signalFn, {
  positionSizeUsd: 100,
  maxConcurrentPositions: 5,
  roundTripFeePct: 2.0,  // Polymarket fees
  spreadMultiplier: 1.0,
  defaultMaxHoldHours: 72,
});
```

**Metrics Calculated:**
- Total P&L (USD and %)
- Sharpe Ratio (annualized)
- Sortino Ratio (downside deviation)
- Max Drawdown (peak to trough)
- Profit Factor (gross wins / gross losses)
- Win Rate, Avg Hold Time

---

## 3. Data Collected

### 3.1 Current Dataset

| Metric | Value |
|--------|-------|
| Total Markets | 3,336 |
| Active Markets | 3,336 |
| Price Snapshots | 33,091 |
| Unique Markets with Data | 3,335 |
| Avg Snapshots per Market | 9.9 |
| Data Collection Period | ~30 minutes |

### 3.2 Market Distribution

Markets span multiple categories:
- Politics (elections, policy)
- Crypto (BTC/ETH price targets)
- Sports (game outcomes, props)
- Entertainment (awards, media)
- Economics (Fed rates, inflation)
- Tech (IPOs, company milestones)

---

## 4. Findings

### 4.1 Market Efficiency (Complement Arbitrage)

**Result: Zero opportunities across all snapshots.**

Every active market prices perfectly:
```
Yes + No = 100.00%
```

The CLOB (Central Limit Order Book) mechanism keeps complementary tokens in lockstep. Market makers arbitrage away any deviation faster than 30-second polling can detect.

### 4.2 Tradability Analysis

Most markets fail tradability checks:

| Failure Reason | Frequency |
|----------------|-----------|
| Spread > 5% | Common on thin markets |
| Depth < $500 | Most smaller markets |
| Near resolution | Markets within 24h of close |

**Implication:** Even if signals exist, execution is often impossible at reasonable cost.

### 4.3 Cross-Market Correlation

Semantic clustering found related market groups:
- Elon Musk government role markets
- Fed rate decision cascades
- Sports championship props

Within clusters, prices are generally consistent. Minor discrepancies exist but are within spread + fees.

### 4.4 Where Edge Might Exist

Based on market structure analysis:

| Market Type | Edge Potential | Rationale |
|-------------|----------------|-----------|
| Fed Rate Markets | Low | Institutional hedging, prices track CME futures |
| High-Profile Politics | Low | Too many eyes, instant convergence |
| Entertainment (Oscars) | Medium | Less sophisticated participants |
| Sports Props | Medium | Relative mispricing between related bets |
| IPO Thresholds | Medium | Cumulative logic sometimes violated |
| Niche/Boring Markets | Medium | Lower attention, slower repricing |

---

## 5. Technical Architecture

### 5.1 System Components

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Polymarket API │────▶│     Scanner     │────▶│     SQLite      │
│  (REST + CLOB)  │     │  (30s polling)  │     │  (3,300+ mkts)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        ▼                                               ▼
┌─────────────────┐                             ┌─────────────────┐
│    WebSocket    │────────────────────────────▶│  Signal Engine  │
│  (Real-time)    │                             │  + Backtest     │
└─────────────────┘                             └─────────────────┘
```

### 5.2 Key Files

| File | Purpose |
|------|---------|
| `src/api/websocket.ts` | Real-time CLOB price streaming |
| `src/backtest/index.ts` | Historical replay engine |
| `src/backtest/metrics.ts` | P&L, Sharpe, Sortino calculations |
| `src/signals/correlation-v2.ts` | Semantic clustering analysis |
| `src/signals/embeddings.ts` | Local transformer embeddings |

### 5.3 WebSocket Performance

During active trading periods:
- **57 price updates per 30 seconds** observed
- Message types: `book`, `price_change`, `last_trade_price`, `best_bid_ask`
- Supports up to 500 token subscriptions per connection

---

## 6. Conclusions

### 6.1 Primary Finding

**Polymarket is far more efficient than expected.**

The CLOB infrastructure eliminates simple arbitrage. The complement spread (Yes + No) is maintained at exactly 100% across all active markets. This is a mature, well-arbitraged market.

### 6.2 Secondary Findings

1. **30-second polling is too slow** - Real edges are taken in milliseconds
2. **Fees eat small edges** - 2% round-trip kills sub-3-cent arbitrage
3. **Most markets are untradeable** - Wide spreads, low depth
4. **Information > Execution** - Edge comes from knowing something, not speed

### 6.3 Alpha Opportunities

The remaining edge is not in execution but in:

1. **Domain expertise** - Know outcomes before the market
2. **Related market analysis** - Find logical inconsistencies across markets
3. **Event timing** - Trade before news breaks
4. **Niche markets** - Lower attention = slower pricing

---

## 7. Next Steps

### 7.1 Data Collection (In Progress)

- Scanner running continuously in background
- Target: 7 days of continuous data
- Goal: 500,000+ snapshots for robust analysis

### 7.2 Analysis Planned

```sql
-- Signal distribution over time
SELECT date(timestamp), COUNT(*) as snapshots
FROM market_snapshots
GROUP BY date(timestamp);

-- Market efficiency trends
SELECT hour(timestamp), AVG(price_yes + price_no) as sum
FROM market_snapshots
GROUP BY hour(timestamp);

-- Volume spike detection
SELECT market_id, MAX(volume_24h) / AVG(volume_24h) as spike_ratio
FROM market_snapshots
GROUP BY market_id
HAVING spike_ratio > 3;
```

### 7.3 Upcoming Events to Monitor

| Event | Date | Market Count |
|-------|------|--------------|
| Oscar Nominations | Jan 23, 2025 | ~50 markets |
| Super Bowl | Jan 26, 2025 | ~100+ markets |
| Fed Rate Decision | Jan 29, 2025 | ~20 markets |

These events offer opportunities to observe price discovery and potential inefficiencies.

---

## 8. Appendix

### 8.1 Configuration

```typescript
// Signal thresholds (loosened for research)
signals: {
  complement: { deviationThreshold: 0.01 },  // 1 cent
  anchoring: { priceChangeThreshold: 0.03 }, // 3%
  attention: { lowAttentionThreshold: 60 },
  deadline: { mispricingThreshold: 0.05 },   // 5%
}
```

### 8.2 Risk Parameters

```typescript
risk: {
  totalBankrollUsd: 10000,
  maxPositionPct: 0.05,        // 5% per position
  maxPositionUsd: 500,
  minMarketLiquidityUsd: 1000,
  dailyLossLimitPct: 0.05,     // 5% circuit breaker
}
```

### 8.3 References

- [Polymarket CLOB API](https://docs.polymarket.com)
- [Polymarket WebSocket Docs](https://docs.polymarket.com/#websocket-channels)
- [transformers.js](https://huggingface.co/docs/transformers.js)

---

*Report generated January 2025. Data collection ongoing.*
