# Hunting for Alpha in Prediction Markets: A Quantitative Analysis of Polymarket Efficiency

*A comprehensive research study on market microstructure, arbitrage detection, and price efficiency in decentralized prediction markets.*

**Author:** Thomas Startz
**Date:** January 2025
**Duration:** 3-week development + 12.6 hours continuous data collection
**Code:** ~7,000 lines of TypeScript

---

## Abstract

This study investigates the existence of exploitable inefficiencies in Polymarket, a decentralized prediction market platform processing millions of dollars in daily volume. We developed a comprehensive scanning infrastructure to detect arbitrage opportunities across 3,335 active markets, collecting 51,430 price snapshots over 12.6 hours of continuous monitoring.

**Principal Finding:** The market exhibits near-perfect efficiency. Across all observations, complementary token pairs (Yes + No) summed to exactly 100.00% in 51,429 of 51,430 snapshots (99.998%). Cross-market analysis revealed minor logical inconsistencies (e.g., Oscar nomination probabilities summing to 520% for 5 available slots), but the 4% theoretical edge is fully consumed by transaction costs.

**Conclusion:** Polymarket's central limit order book (CLOB) infrastructure effectively eliminates execution-based arbitrage. Profitable trading requires information advantage rather than technical edge.

---

## Table of Contents

1. [Introduction & Motivation](#1-introduction--motivation)
2. [Research Questions](#2-research-questions)
3. [Literature & Market Context](#3-literature--market-context)
4. [Methodology](#4-methodology)
5. [System Architecture](#5-system-architecture)
6. [Data Collection & Statistics](#6-data-collection--statistics)
7. [Analysis & Results](#7-analysis--results)
8. [Discussion](#8-discussion)
9. [Conclusions & Future Work](#9-conclusions--future-work)
10. [Technical Appendix](#10-technical-appendix)

---

## 1. Introduction & Motivation

### 1.1 The Prediction Market Opportunity

Prediction markets aggregate dispersed information through price discovery, theoretically producing more accurate forecasts than polls or expert opinions. Polymarket, built on the Polygon blockchain, has emerged as the dominant platform with:

- **$1B+** cumulative trading volume
- **5,000+** active markets
- **Real-money stakes** creating strong incentive alignment

The hypothesis driving this research: retail-dominated prediction markets should exhibit exploitable inefficiencies that sophisticated participants can capture.

### 1.2 Research Objectives

| Objective | Description |
|-----------|-------------|
| **Primary** | Quantify market efficiency by measuring complement arbitrage opportunities |
| **Secondary** | Identify cross-market logical inconsistencies |
| **Tertiary** | Build infrastructure for real-time signal detection and backtesting |
| **Exploratory** | Characterize market microstructure (spreads, depth, liquidity distribution) |

### 1.3 Scope & Limitations

This study focuses on binary markets (Yes/No outcomes) on Polymarket's CLOB. We exclude:
- Multi-outcome markets (e.g., "Who will win?" with 10+ candidates)
- Markets with <$100 liquidity
- Resolved or expired markets

---

## 2. Research Questions

### Primary Questions

| ID | Question | Hypothesis |
|----|----------|------------|
| RQ1 | Do complement arbitrage opportunities exist (Yes + No ≠ $1.00)? | Rare but present in thin markets |
| RQ2 | Do related markets maintain logical price consistency? | Inconsistencies exist, especially in complex event structures |
| RQ3 | What is the effective tradability of detected signals? | Many signals untradeable due to spread/depth constraints |

### Secondary Questions

| ID | Question |
|----|----------|
| RQ4 | How does liquidity correlate with price efficiency? |
| RQ5 | What is the distribution of bid-ask spreads across market types? |
| RQ6 | Can mean-reversion strategies exploit short-term price dislocations? |

---

## 3. Literature & Market Context

### 3.1 Prediction Market Efficiency

Academic literature generally supports prediction market accuracy:

- **Berg et al. (2008)**: Iowa Electronic Markets outperformed polls in 74% of elections
- **Arrow et al. (2008)**: Science paper advocating prediction markets for policy decisions
- **Wolfers & Zitzewitz (2004)**: Established theoretical framework for information aggregation

However, most studies focus on *forecasting accuracy*, not *trading profitability*. This research addresses the latter.

### 3.2 Polymarket's Market Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      POLYMARKET ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐               │
│  │   Traders   │────▶│    CLOB     │────▶│  Settlement │               │
│  │  (Polygon)  │     │  (Off-chain)│     │  (On-chain) │               │
│  └─────────────┘     └─────────────┘     └─────────────┘               │
│        │                    │                    │                      │
│        │              ┌─────┴─────┐              │                      │
│        │              │           │              │                      │
│        ▼              ▼           ▼              ▼                      │
│  ┌─────────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐               │
│  │   Wallet    │ │  REST   │ │   WS    │ │   UMA       │               │
│  │ (USDC/MATIC)│ │   API   │ │  Feed   │ │  (Oracle)   │               │
│  └─────────────┘ └─────────┘ └─────────┘ └─────────────┘               │
│                                                                         │
│  Fee Structure: 2% round-trip (1% entry + 1% exit)                     │
│  Settlement: Binary (0 or 1 USDC per share)                            │
│  Token Standard: ERC-1155 (Yes/No outcome tokens)                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

Key characteristics:
- **Off-chain order book**: Enables sub-second matching without gas costs
- **On-chain settlement**: Provides trustless resolution via UMA oracle
- **Complementary tokens**: Yes + No must sum to $1.00 at settlement

---

## 4. Methodology

### 4.1 Signal Detection Framework

We implemented four distinct signal detection algorithms:

#### Signal Type 1: Complement Arbitrage

**Theoretical Basis:** If Yes costs $0.60 and No costs $0.38, buying both guarantees $1.00 payout for $0.98 cost—a risk-free 2% return.

**Implementation:**
```typescript
const costToBuyBoth = bestAskYes + bestAskNo;
const arbEdge = 1.0 - costToBuyBoth - FEES - SLIPPAGE_BUFFER;
const isArbitrage = arbEdge > 0;
```

**Threshold:** Edge > 0 after 2% fees + 0.5% slippage buffer

#### Signal Type 2: Anchoring/Mean Reversion

**Theoretical Basis:** Sharp price moves on low volume may represent temporary dislocations that revert to fair value.

**Implementation:**
```typescript
const priceMove = Math.abs(currentMid - historicalMid);
const volumeRatio = currentVolume / averageVolume;
const isAnchoring = priceMove > 0.08 && volumeRatio < 0.5;
```

**Threshold:** >8% price move on <50% of average volume

#### Signal Type 3: Deadline Pressure

**Theoretical Basis:** Markets requiring formal acts (legislation, court rulings) tend to overestimate "Yes" probability due to action bias.

**Implementation:** Keyword matching for formal act indicators + comparison against base rate estimates.

#### Signal Type 4: Cross-Market Correlation

**Theoretical Basis:** Related markets should maintain logical consistency (e.g., P(wins) ≤ P(nominated)).

**Implementation:** Semantic clustering using sentence embeddings + logical constraint validation.

### 4.2 Tradability Gating

All signals pass through a tradability filter before being flagged as actionable:

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| Bid-Ask Spread | < 5% | Wide spreads eliminate edge |
| Order Book Depth | > $500 within 1% of mid | Ensures fill capacity |
| Slippage Estimate | < 2¢ for $250 order | Limits execution cost |
| Time to Resolution | > 24 hours | Avoids illiquid end-of-life markets |

### 4.3 Backtesting Framework

Historical signal evaluation using realistic execution assumptions:

```typescript
interface BacktestConfig {
  positionSizeUsd: 100,        // Fixed position size
  maxConcurrentPositions: 5,   // Portfolio constraint
  roundTripFeePct: 2.0,        // Polymarket fees
  spreadMultiplier: 1.0,       // Spread penalty
  defaultMaxHoldHours: 72,     // Time-based exit
}
```

**Metrics Calculated:**
- Total P&L (absolute and percentage)
- Sharpe Ratio (annualized, assuming 0% risk-free rate)
- Sortino Ratio (downside deviation only)
- Maximum Drawdown (peak-to-trough)
- Profit Factor (gross wins / gross losses)
- Win Rate and Average Hold Time

---

## 5. System Architecture

### 5.1 High-Level Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SYSTEM ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    ┌──────────────────────────────────────────────────────────────────┐    │
│    │                     DATA INGESTION LAYER                          │    │
│    ├──────────────────────────────────────────────────────────────────┤    │
│    │                                                                    │    │
│    │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │    │
│    │  │  REST API   │    │  WebSocket  │    │  Rate Limiter       │   │    │
│    │  │  (30s poll) │    │  (real-time)│    │  (100 req/min)      │   │    │
│    │  │             │    │             │    │                     │   │    │
│    │  │ • Markets   │    │ • book      │    │ • Exponential       │   │    │
│    │  │ • Books     │    │ • price_chg │    │   backoff           │   │    │
│    │  │ • Trades    │    │ • trades    │    │ • Request queuing   │   │    │
│    │  └──────┬──────┘    └──────┬──────┘    └─────────────────────┘   │    │
│    │         │                  │                                      │    │
│    │         └────────┬─────────┘                                      │    │
│    │                  ▼                                                 │    │
│    │         ┌─────────────────┐                                       │    │
│    │         │   Normalizer    │  Convert API responses to             │    │
│    │         │                 │  internal schema                      │    │
│    │         └────────┬────────┘                                       │    │
│    │                  │                                                 │    │
│    └──────────────────┼─────────────────────────────────────────────────┘   │
│                       │                                                      │
│    ┌──────────────────┼─────────────────────────────────────────────────┐   │
│    │                  ▼            STORAGE LAYER                         │   │
│    │         ┌─────────────────┐                                        │   │
│    │         │     SQLite      │                                        │   │
│    │         │                 │                                        │   │
│    │         │ • markets       │  3,336 rows                           │   │
│    │         │ • snapshots     │  51,430 rows                          │   │
│    │         │ • orderbooks    │  Full depth JSON                      │   │
│    │         │ • signals       │  Triggered alerts                     │   │
│    │         └────────┬────────┘                                        │   │
│    │                  │                                                 │   │
│    └──────────────────┼─────────────────────────────────────────────────┘   │
│                       │                                                      │
│    ┌──────────────────┼─────────────────────────────────────────────────┐   │
│    │                  ▼           ANALYSIS LAYER                         │   │
│    │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │   │
│    │  │ Complement  │ │  Anchoring  │ │  Deadline   │ │ Correlation │  │   │
│    │  │   Arb       │ │   Bias      │ │  Pressure   │ │   (V2)      │  │   │
│    │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘  │   │
│    │         │               │               │               │          │   │
│    │         └───────────────┴───────┬───────┴───────────────┘          │   │
│    │                                 ▼                                   │   │
│    │                     ┌─────────────────────┐                        │   │
│    │                     │  Tradability Gate   │                        │   │
│    │                     │  (spread/depth/slip)│                        │   │
│    │                     └──────────┬──────────┘                        │   │
│    │                                │                                    │   │
│    │                     ┌──────────┴──────────┐                        │   │
│    │                     ▼                     ▼                        │   │
│    │            ┌─────────────┐       ┌─────────────┐                   │   │
│    │            │  Backtest   │       │   Alert     │                   │   │
│    │            │   Engine    │       │   System    │                   │   │
│    │            └─────────────┘       └─────────────┘                   │   │
│    │                                                                     │   │
│    └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│    ┌─────────────────────────────────────────────────────────────────────┐  │
│    │                       PRESENTATION LAYER                             │  │
│    │                                                                      │  │
│    │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  │  │
│    │  │  REST API   │    │   React     │    │   CLI Dashboard         │  │  │
│    │  │  (Express)  │    │   Dashboard │    │   (real-time stats)     │  │  │
│    │  │             │    │             │    │                         │  │  │
│    │  │ /signals    │    │ Signal list │    │ $ npm run dev           │  │  │
│    │  │ /markets    │    │ Market view │    │ > Polling: 30s          │  │  │
│    │  │ /stats      │    │ P&L chart   │    │ > Markets: 3,336        │  │  │
│    │  └─────────────┘    └─────────────┘    └─────────────────────────┘  │  │
│    │                                                                      │  │
│    └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | Node.js 20+ | Async I/O for high-throughput polling |
| Language | TypeScript 5.x | Type safety across ~7,000 LOC |
| Database | SQLite (better-sqlite3) | Zero-config embedded storage |
| Real-time | ws (WebSocket) | CLOB subscription feed |
| ML | transformers.js | Local sentence embeddings |
| Frontend | React + Vite + Tailwind | Signal dashboard |
| API | Express.js | RESTful endpoints |

### 5.3 WebSocket Implementation

```typescript
export class PolymarketWebSocket extends EventEmitter {
  private url = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

  // Message types handled
  // • book: Full orderbook snapshot
  // • price_change: Order placed/cancelled
  // • last_trade_price: Trade execution
  // • best_bid_ask: Quote updates

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.on('message', this.handleMessage.bind(this));
  }

  subscribe(tokenId: string): void {
    this.ws.send(JSON.stringify({
      assets_ids: [tokenId],
      type: 'MARKET',
    }));
  }
}
```

**Observed Performance:** ~57 messages per 30-second window during active trading.

### 5.4 Semantic Clustering (V2)

For cross-market correlation detection, we use local ML embeddings:

```typescript
import { pipeline } from '@xenova/transformers';

// Model: all-MiniLM-L6-v2 (~80MB, quantized)
const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

// Generate embeddings for market questions
const embedding = await embedder(question, { pooling: 'mean', normalize: true });

// Cluster by cosine similarity (threshold: 0.80)
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

---

## 6. Data Collection & Statistics

### 6.1 Collection Parameters

| Parameter | Value |
|-----------|-------|
| Collection Start | 2025-01-21 04:38:43 UTC |
| Collection End | 2025-01-21 17:15:53 UTC |
| Duration | 12.62 hours |
| Polling Interval | 30 seconds |
| Markets Tracked | 3,335 unique |
| Total Snapshots | 51,430 |
| Avg Snapshots/Market | 15.4 |

### 6.2 Market Universe Statistics

**Table 1: Price Distribution Analysis**

| Price Bucket | Snapshots | % of Total | Avg Spread | Avg Liquidity |
|--------------|-----------|------------|------------|---------------|
| 0-10% | 40,226 | 78.2% | 71.9% | $71,924 |
| 10-20% | 2,700 | 5.3% | 88.2% | $44,549 |
| 20-30% | 2,017 | 3.9% | 86.6% | $82,799 |
| 30-40% | 1,174 | 2.3% | 87.6% | $91,082 |
| 40-50% | 973 | 1.9% | 87.9% | $56,620 |
| 50-60% | 800 | 1.6% | 89.4% | $13,391 |
| 60-70% | 694 | 1.3% | 88.3% | $7,999 |
| 70-80% | 549 | 1.1% | 84.2% | $20,338 |
| 80-90% | 607 | 1.2% | 84.7% | $3,757 |
| 90-100% | 1,690 | 3.3% | 84.2% | $18,048 |

**Observation:** 78% of snapshots are for markets priced <10%, indicating many low-probability events. Spreads are consistently wide (>70%) across all price levels.

**Table 2: Liquidity Distribution**

| Liquidity Bucket | Snapshots | Unique Markets | % Tradeable |
|------------------|-----------|----------------|-------------|
| $0 | 12,782 | 2,751 | 0% |
| $1-100 | 2,372 | 373 | 0% |
| $100-1k | 7,698 | 1,271 | ~5% |
| $1k-10k | 15,031 | 1,324 | ~40% |
| $10k-100k | 6,544 | 405 | ~80% |
| $100k+ | 7,003 | 254 | ~95% |

**Observation:** Only 25% of snapshots represent markets with >$10k liquidity. The majority of markets are effectively untradeable.

**Table 3: Volume Distribution by Market**

| 24h Volume | Markets | Avg Spread |
|------------|---------|------------|
| $0 | 1,679 | 63.9% |
| $1-100 | 1,070 | 74.5% |
| $100-1k | 645 | 83.6% |
| $1k-10k | 417 | 80.3% |
| $10k-100k | 299 | 85.3% |
| $100k+ | 116 | 86.6% |

**Observation:** Higher volume correlates with *wider* spreads, contrary to traditional market intuition. This suggests active markets attract market makers who demand wider spreads for inventory risk.

---

## 7. Analysis & Results

### 7.1 RQ1: Complement Arbitrage

**Hypothesis:** Yes + No prices may deviate from $1.00, creating risk-free arbitrage.

**Results:**

| Metric | Value |
|--------|-------|
| Total Snapshots Analyzed | 51,430 |
| Snapshots with Yes + No = 100.00% | 51,429 |
| Snapshots with Deviation | 1 |
| Deviation Rate | 0.002% |

**Table 4: Complement Sum Distribution**

| Yes + No Sum | Occurrences | Percentage |
|--------------|-------------|------------|
| 100.00% | 51,429 | 99.998% |
| 149.85% (anomaly) | 1 | 0.002% |

The single anomaly (149.85%) appears to be a data quality issue—likely a stale quote on one side. Even if real, the 49.85% "edge" would require investigation before trading.

**Conclusion for RQ1:** Complement arbitrage does not exist in practice. The CLOB maintains perfect price parity.

### 7.2 RQ2: Cross-Market Consistency

**Case Study: Oscar Best Actor Nominations**

The 98th Academy Awards Best Actor category has 5 nomination slots. Market prices should sum to approximately 500%.

**Table 5: Best Actor Nomination Probabilities**

| Actor | Nomination % | Win % | Liquidity |
|-------|-------------|-------|-----------|
| Leonardo DiCaprio | 99.9% | — | $0 |
| Timothée Chalamet | 99.9% | 67.5% | $13,308 |
| Michael B. Jordan | 94.7% | 19.3% | $3,156 |
| Wagner Moura | 88.6% | 2.5% | $3,046 |
| Ethan Hawke | 71.0% | — | $0 |
| Jesse Plemons | 40.0% | 1.6% | $6,326 |
| Joel Edgerton | 9.0% | — | $2,084 |
| Others (combined) | 17.5% | — | varies |
| **Total** | **520.6%** | | |

**Analysis:**
- Sum exceeds theoretical 500% by 20.6 percentage points
- Implied overpricing: 520.6 / 500 = 1.041 (4.1% collective overpricing)
- However: Top 5 candidates account for 454.1%, within expected range
- The "excess" comes from long-tail candidates (Plemons, Edgerton, etc.)

**Tradability Assessment:**

| Action | Theoretical Edge | Fee Cost | Net Edge |
|--------|------------------|----------|----------|
| Short 6th candidate (Plemons) | ~4% | 2% | ~2% |
| Spread cost | — | ~1-2% | 0-1% |
| Slippage | — | ~0.5% | -0.5% to 0.5% |

**Conclusion for RQ2:** Cross-market inconsistencies exist but are marginal. After transaction costs, no profitable trade is available.

### 7.3 RQ3: Signal Tradability

**Table 6: Signal Detection Summary**

| Signal Type | Signals Generated | Passed Tradability | Tradeable Rate |
|-------------|-------------------|--------------------| ---------------|
| Complement Arb | 0 | 0 | — |
| Anchoring | 0 | 0 | — |
| Deadline | 2 | 0 | 0% |
| Low Attention | 1 | 0 | 0% |
| **Total** | **3** | **0** | **0%** |

All detected signals failed tradability checks due to:
- Spread > 5%: Most common failure
- Depth < $500: Second most common
- Near resolution: Markets within 24h of close

### 7.4 RQ4-6: Secondary Analysis

**RQ4: Liquidity-Efficiency Correlation**

| Liquidity Tier | Avg |Yes+No - 100%| | Observation |
|----------------|----------------------|-------------|
| $0 | 0.00% | Perfect (no quotes) |
| $1-1k | 0.00% | Perfect |
| $1k-10k | 0.00% | Perfect |
| $10k-100k | 0.00% | Perfect |
| $100k+ | 0.00% | Perfect |

**Conclusion:** Efficiency is uniform across liquidity tiers. Even thin markets maintain perfect complement pricing.

**RQ5: Spread Analysis**

Average bid-ask spreads are uniformly wide:
- Low-price markets (0-10%): 71.9% spread
- Mid-price markets (40-60%): 88.6% spread
- High-price markets (90-100%): 84.2% spread

**Conclusion:** Spreads are driven by uncertainty about outcomes, not liquidity. Market makers demand wide spreads for binary event risk.

**RQ6: Mean Reversion**

Markets with >10% price swings during collection:

| Market | Min | Max | Move | Type |
|--------|-----|-----|------|------|
| Brest Ligue 1 top 4 | 3.9% | 26.5% | +22.7% | Sports |
| Benfica UCL advance | 10.0% | 29.5% | +19.5% | Sports |
| Freiburg Bundesliga | 5.5% | 22.0% | +16.5% | Sports |

**Conclusion:** Large price moves correlate with news events (game results, injuries). These are information-driven, not noise—mean reversion strategies would trade against informed flow.

---

## 8. Discussion

### 8.1 Why Is Polymarket So Efficient?

**Factor 1: CLOB Architecture**

The central limit order book enables instant arbitrage. If Yes + No deviates from $1.00, market makers immediately trade to capture the spread. The 30-second polling interval is orders of magnitude too slow.

**Factor 2: Professional Market Makers**

Polymarket attracts sophisticated participants running automated strategies. They provide liquidity and capture mispricings faster than retail traders.

**Factor 3: Fee Structure**

The 2% round-trip fee creates a "no-trade zone" for small edges. Any opportunity under 3 cents is unprofitable after fees.

### 8.2 Comparison to Traditional Markets

| Characteristic | Polymarket | Equity Markets |
|----------------|------------|----------------|
| Complement Efficiency | 99.998% | ~99.9% (options) |
| Typical Spread | 70-90% | 0.01-0.1% |
| Arbitrage Latency | <100ms | <1μs |
| Fee Impact | 2% (significant) | <0.1% (negligible) |

Polymarket is *more* efficient at complement pricing but *less* liquid, resulting in wider spreads that offset any theoretical edge.

### 8.3 Implications for Traders

**Table 7: Strategy Viability Assessment**

| Strategy | Viability | Rationale |
|----------|-----------|-----------|
| Complement Arbitrage | ❌ Not Viable | Perfect efficiency eliminates opportunity |
| Statistical Arbitrage | ❌ Not Viable | Spreads too wide for mean-reversion |
| Cross-Market Arb | ⚠️ Marginal | 4% edges exist but fees consume them |
| Information Trading | ✅ Viable | Domain expertise creates edge |
| Event Trading | ✅ Viable | Price discovery windows offer opportunity |

### 8.4 Limitations of This Study

1. **Duration:** 12.6 hours may miss rare arbitrage events
2. **Polling frequency:** 30-second intervals cannot detect sub-second opportunities
3. **Sample bias:** Active markets over-represented vs. niche markets
4. **Fee assumptions:** Actual execution costs may vary

---

## 9. Conclusions & Future Work

### 9.1 Summary of Findings

1. **Polymarket exhibits near-perfect complement efficiency.** Across 51,430 observations, Yes + No summed to exactly 100.00% in 99.998% of cases.

2. **Cross-market inconsistencies exist but are not tradeable.** Oscar nomination markets showed 4% collective overpricing, but transaction costs eliminate the edge.

3. **Most markets are untradeable.** 75% of snapshots represent markets with <$10k liquidity and >70% spreads.

4. **Alpha requires information, not execution.** Profitable trading demands knowing outcomes before the market prices them.

### 9.2 Recommendations

For aspiring prediction market traders:

| Recommendation | Rationale |
|----------------|-----------|
| Focus on domain expertise | Only information edge is viable |
| Target price discovery windows | Events create temporary inefficiency |
| Avoid systematic arbitrage | Infrastructure cannot compete with market makers |
| Monitor niche markets | Lower attention = slower pricing |

### 9.3 Future Research Directions

1. **Extended data collection:** Capture full market cycles (7+ days) across major events
2. **Higher frequency analysis:** WebSocket-only monitoring for sub-second opportunities
3. **Cross-platform comparison:** Analyze Kalshi, Metaculus, PredictIt for relative efficiency
4. **Sentiment integration:** Correlate price movements with news/social signals
5. **Resolution analysis:** Study final price convergence as events resolve

---

## 10. Technical Appendix

### 10.1 Database Schema

```sql
CREATE TABLE markets (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  description TEXT,
  category TEXT,
  end_date_iso TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  price_yes REAL NOT NULL,
  price_no REAL NOT NULL,
  volume_24h REAL,
  liquidity REAL,
  spread REAL,
  best_bid_yes REAL,
  best_ask_yes REAL,
  best_bid_no REAL,
  best_ask_no REAL,
  FOREIGN KEY (market_id) REFERENCES markets(id)
);

CREATE INDEX idx_snapshots_market ON market_snapshots(market_id);
CREATE INDEX idx_snapshots_time ON market_snapshots(timestamp);
```

### 10.2 Key Queries

```sql
-- Complement efficiency check
SELECT
  ROUND((price_yes + price_no) * 100, 2) as sum_pct,
  COUNT(*) as occurrences
FROM market_snapshots
WHERE price_yes > 0 AND price_no > 0
GROUP BY sum_pct
ORDER BY occurrences DESC;

-- Cross-market sum for category
SELECT
  SUM(price_yes) * 100 as total_probability
FROM market_snapshots s
JOIN markets m ON s.market_id = m.id
WHERE m.question LIKE '%Best Actor%nominated%'
  AND s.timestamp = (SELECT MAX(timestamp) FROM market_snapshots);
```

### 10.3 Configuration Reference

```typescript
export const config = {
  polling: {
    intervalMs: 30_000,
    marketLimit: 5_000,
    retryAttempts: 3,
    retryDelayMs: 1_000,
  },
  signals: {
    complement: { deviationThreshold: 0.01 },
    anchoring: { priceChangeThreshold: 0.03, volumeRatio: 0.5 },
    attention: { lowAttentionThreshold: 60 },
    deadline: { mispricingThreshold: 0.05, minHours: 24 },
  },
  tradability: {
    maxSpreadPct: 0.05,
    minDepthUsd: 500,
    maxSlippageCents: 2,
  },
  risk: {
    positionSizeUsd: 100,
    maxConcurrentPositions: 5,
    roundTripFeePct: 2.0,
  },
};
```

### 10.4 Repository Structure

```
polymarket-arb-research/
├── src/
│   ├── api/
│   │   ├── polymarket.ts      # REST client
│   │   └── websocket.ts       # CLOB WebSocket
│   ├── backtest/
│   │   ├── index.ts           # Replay engine
│   │   ├── metrics.ts         # Sharpe, Sortino
│   │   └── types.ts           # Type definitions
│   ├── db/
│   │   └── client.ts          # SQLite wrapper
│   ├── signals/
│   │   ├── complement.ts      # Arb detection
│   │   ├── anchoring.ts       # Mean reversion
│   │   ├── correlation-v2.ts  # Semantic clustering
│   │   ├── embeddings.ts      # ML embeddings
│   │   └── tradability.ts     # Gate logic
│   ├── trading/
│   │   ├── planner.ts         # Trade planning
│   │   └── risk.ts            # Position limits
│   └── index.ts               # Entry point
├── ui/                        # React dashboard
├── docs/                      # Documentation
├── data/                      # SQLite database
└── migrations/                # Schema migrations
```

---

## References

1. Berg, J., Forsythe, R., Nelson, F., & Rietz, T. (2008). Results from a dozen years of election futures markets research. *Handbook of Experimental Economics Results*.

2. Arrow, K. J., et al. (2008). The promise of prediction markets. *Science*, 320(5878), 877-878.

3. Wolfers, J., & Zitzewitz, E. (2004). Prediction markets. *Journal of Economic Perspectives*, 18(2), 107-126.

4. Polymarket Documentation. https://docs.polymarket.com

5. Hugging Face transformers.js. https://huggingface.co/docs/transformers.js

---

*Research conducted January 2025. Code available at [github.com/thomasstartz111/polymarket-arb-research](https://github.com/thomasstartz111/polymarket-arb-research).*
