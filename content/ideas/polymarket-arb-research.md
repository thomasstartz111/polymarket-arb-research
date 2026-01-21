# Building a Polymarket Arbitrage Scanner: What I Learned About Efficient Markets

## The Goal

Polymarket has over 5,000 active prediction markets with real money on the line. Where there's money and markets, there should be arbitrage opportunities—mispriced outcomes, correlated markets moving out of sync, or slow reactions to breaking news. I set out to build a system that could find these edges.

Spoiler: the market is far more efficient than I expected.

## Architecture

The system has four main components:

**1. Market Scanner** - Polls the Polymarket API every 30 seconds, ingests market metadata and price snapshots into SQLite. Captured 5,000+ markets with full orderbook depth.

**2. Real-time WebSocket** - Direct connection to Polymarket's CLOB WebSocket at `wss://ws-subscriptions-clob.polymarket.com/ws/market`. This fires on every order book change—we saw 57 price updates in 30 seconds during active trading. Message types include `book` (full snapshot), `price_change` (new orders), and `last_trade_price` (executions).

**3. Signal Detection** - Two approaches to finding mispricing:
- V1: String matching to find related markets (e.g., "Fed rate cut" markets)
- V2: Semantic embeddings using `all-MiniLM-L6-v2` to cluster similar questions

**4. Backtest Framework** - Replay historical snapshots through signal functions, tracking P&L, Sharpe ratio, Sortino ratio, and max drawdown.

## Key Finding: The Market Is Brutally Efficient

The first thing I looked for was simple arbitrage: if "Yes" is at 60 cents and "No" is at 40 cents, that's free money since they should sum to ~100%.

Results across hundreds of markets:

```
Yes + No = 100.00%
Yes + No = 100.00%
Yes + No = 100.00%
```

Every single active market priced perfectly. The CLOB keeps complementary tokens in lockstep.

## What About Correlated Markets?

If "Bitcoin hits $100K in 2025" is at 40% and "Bitcoin hits $150K in 2025" is at 35%, that's a mispricing—$150K implies $100K. The semantic embedding approach found these relationships automatically:

```typescript
// Cluster markets by question similarity using transformers.js
const embeddings = await embedBatch(questions);
const clusters = clusterBySimilarity(embeddings, 0.80);

// Detect logical violations
// - Range brackets should sum to ~100%
// - Cumulative thresholds should be monotonic
// - "At least 5%" should have higher probability than "at least 10%"
```

The system found real clusters—Elon Musk budget cut markets, Fed rate decisions, sports outcomes. But even here, prices were largely consistent within clusters.

## Where Alpha Actually Lives

After scanning thousands of markets, the pattern became clear:

**Skip: Fed rate markets** - These are used for institutional hedging. The "real" price is baked in from CME futures. Not prediction markets, just proxy instruments.

**Skip: High-profile political markets** - Presidential races, major policy outcomes. Too many eyes, prices converge instantly.

**Watch: Entertainment** - Oscar nominations, reality TV outcomes. Less sophisticated money, shorter time horizons. The Oscars announce tomorrow (Jan 23) and there are dozens of active markets.

**Watch: Sports** - Especially less popular events. Super Bowl markets (Jan 26) will see heavy volume with potential inefficiencies in prop bets.

**Watch: IPO/Tech events** - Specific threshold markets ("Will X IPO above Y valuation") sometimes misprice relative to each other.

## The WebSocket Implementation

The real-time feed was the most interesting engineering challenge:

```typescript
export class PolymarketWebSocket extends EventEmitter {
  private url = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

  // Subscribe to specific tokens for order book updates
  subscribe(tokenId: string): void {
    this.ws.send(JSON.stringify({
      assets_ids: [tokenId],
      type: 'MARKET',
    }));
  }
}
```

Polymarket sends different event types:
- `book` - Full orderbook snapshot on subscribe or after trades
- `price_change` - When orders are placed/cancelled (most frequent)
- `last_trade_price` - Trade executions
- `best_bid_ask` - Best bid/ask changes (feature-flagged)

We parse these into normalized `PriceUpdate` events with best bid, best ask, and mid price.

## The Backtest Framework

To validate any signal, you need to replay history:

```typescript
export async function runBacktest(
  signalFn: SignalFunction,
  config: Partial<BacktestConfig> = {}
): Promise<BacktestResults> {
  // Load historical snapshots
  const snapshots = loadSnapshots(cfg);

  // Process chronologically
  for (const snapshot of sortedSnapshots) {
    // Get signal from strategy
    const signal = signalFn(snapshot, history, market);

    // Open/close positions based on signal
    // Track P&L with realistic fees and spread
  }

  // Calculate metrics
  return {
    trades: closedTrades,
    metrics: calculateMetrics(closedTrades, cfg),
    equity: buildEquityCurve(closedTrades, cfg),
  };
}
```

Metrics include:
- Sharpe ratio (risk-adjusted returns, annualized)
- Sortino ratio (downside-only volatility)
- Max drawdown (peak-to-trough)
- Profit factor (gross wins / gross losses)
- Exit reason breakdown (target, stop, time, resolution)

## Local Embeddings with transformers.js

For semantic clustering, I used Xenova's transformers.js with the `all-MiniLM-L6-v2` model (~80MB, runs locally):

```typescript
import { pipeline } from '@xenova/transformers';

const embedder = await pipeline(
  'feature-extraction',
  'Xenova/all-MiniLM-L6-v2',
  { quantized: true }
);

// Cluster by cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

This found real semantic relationships: markets about the same entity (Elon, Trump, Fed) clustered together even with different wording.

## What's Next

**Immediate opportunities:**
- Oscar nominations (Jan 23) - Entertainment markets with less sophisticated pricing
- Super Bowl (Jan 26) - Prop bet markets often misprice relative to each other

**System improvements:**
- Persistent WebSocket monitoring with alerting
- Cross-market correlation dashboard
- Historical replay of major events (elections, Fed decisions)

## The Takeaway

Polymarket is surprisingly efficient. The CLOB mechanism keeps Yes/No pairs perfectly priced. Semantic analysis finds related markets but they're largely consistent too.

The edge isn't in obvious arbitrage—it's in information asymmetry. Markets where you have better domain knowledge than the crowd, or where you can react faster to breaking news.

The infrastructure is ready: real-time streaming, backtest validation, semantic clustering. Now it's about finding the right markets at the right time.

---

*Built with TypeScript, SQLite, transformers.js, and the Polymarket CLOB WebSocket API.*
