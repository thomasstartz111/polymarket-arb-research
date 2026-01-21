import { polymarketClient } from '../api/polymarket.js';
import { gammaClient, type ParsedGammaMarket } from '../api/gamma.js';
import { db, nowISO } from '../db/client.js';
import { config } from '../config/index.js';

export interface IngestStats {
  marketsProcessed: number;
  snapshotsCreated: number;
  orderbooksStored: number;
  errors: string[];
  durationMs: number;
}

/**
 * Ingester Service
 * Polls Polymarket API at regular intervals and stores market data
 */
export class Ingester {
  private running = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number;
  private onCycleComplete?: (stats: IngestStats) => void;

  constructor(intervalMs?: number) {
    this.intervalMs = intervalMs || config.pollIntervalMs;
  }

  /**
   * Set callback for when each cycle completes
   */
  setOnCycleComplete(callback: (stats: IngestStats) => void): void {
    this.onCycleComplete = callback;
  }

  /**
   * Start continuous polling
   */
  start(): void {
    if (this.running) {
      console.warn('Ingester already running');
      return;
    }

    this.running = true;
    console.log(`🔄 Starting ingester with ${this.intervalMs / 1000}s interval`);

    // Run immediately, then on interval
    this.runCycle().catch(console.error);
    this.intervalHandle = setInterval(() => {
      this.runCycle().catch(console.error);
    }, this.intervalMs);
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log('⏹️  Ingester stopped');
  }

  /**
   * Check if ingester is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Run a single ingest cycle
   */
  async runCycle(): Promise<IngestStats> {
    const startTime = Date.now();
    const timestamp = nowISO();
    const stats: IngestStats = {
      marketsProcessed: 0,
      snapshotsCreated: 0,
      orderbooksStored: 0,
      errors: [],
      durationMs: 0,
    };

    try {
      // 1. Fetch all active markets from Gamma API (has actually live data)
      console.log('📥 Fetching active markets from Gamma API...');
      const markets = await gammaClient.getAllActiveMarkets();
      console.log(`   Found ${markets.length} active binary markets with order books`);

      // 2. Process each market
      for (const market of markets) {
        try {
          await this.processMarket(market, timestamp, stats);
        } catch (error) {
          const errMsg = `Error processing market ${market.conditionId}: ${error}`;
          stats.errors.push(errMsg);
          // Don't log every error to avoid spam, just count
        }
      }

      // 4. Update last ingest timestamp
      db.run(
        `UPDATE system_state SET value = ?, updated_at = ? WHERE key = 'last_ingest'`,
        [timestamp, timestamp]
      );

    } catch (error) {
      const errMsg = `Fatal ingest error: ${error}`;
      stats.errors.push(errMsg);
      console.error('❌', errMsg);
    }

    stats.durationMs = Date.now() - startTime;

    // Log summary
    const errorSuffix = stats.errors.length > 0 ? ` (${stats.errors.length} errors)` : '';
    console.log(
      `✅ Ingest complete: ${stats.marketsProcessed} markets, ` +
      `${stats.snapshotsCreated} snapshots in ${stats.durationMs}ms${errorSuffix}`
    );

    // Notify callback if set
    if (this.onCycleComplete) {
      this.onCycleComplete(stats);
    }

    return stats;
  }

  /**
   * Process a single market
   */
  private async processMarket(
    market: ParsedGammaMarket,
    timestamp: string,
    stats: IngestStats
  ): Promise<void> {
    // Upsert market metadata
    db.run(
      `INSERT INTO markets (id, question, slug, description, end_date_iso, category, active, outcome_yes_token, outcome_no_token, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         question = excluded.question,
         description = excluded.description,
         active = excluded.active,
         updated_at = excluded.updated_at`,
      [
        market.conditionId,
        market.question,
        market.slug,
        market.description,
        market.endDateIso,
        market.category,
        market.active ? 1 : 0,
        market.yesTokenId,
        market.noTokenId,
        timestamp,
      ]
    );
    stats.marketsProcessed++;

    // Fetch order books for both sides from CLOB API (in parallel)
    const [yesBook, noBook] = await Promise.all([
      polymarketClient.getOrderBook(market.yesTokenId).catch(() => null),
      polymarketClient.getOrderBook(market.noTokenId).catch(() => null),
    ]);

    // Calculate metrics from order books
    let liquidity = 0;
    let spread = 0;
    let bestBidYes: number | null = null;
    let bestAskYes: number | null = null;
    let bestBidNo: number | null = null;
    let bestAskNo: number | null = null;
    let midYes: number | null = null;
    let midNo: number | null = null;
    let depthUsd = 0;

    if (yesBook) {
      const yesDepth = polymarketClient.calculateBookDepth(yesBook);
      liquidity += yesDepth.bidDepth + yesDepth.askDepth;
      depthUsd += yesDepth.bidDepth + yesDepth.askDepth;
      spread = yesDepth.spread;

      // Extract best bid/ask for executable prices
      if (yesBook.bids.length > 0) {
        bestBidYes = parseFloat(yesBook.bids[0].price);
      }
      if (yesBook.asks.length > 0) {
        bestAskYes = parseFloat(yesBook.asks[0].price);
      }
      if (bestBidYes !== null && bestAskYes !== null) {
        midYes = (bestBidYes + bestAskYes) / 2;
      }
    }

    if (noBook) {
      const noDepth = polymarketClient.calculateBookDepth(noBook);
      liquidity += noDepth.bidDepth + noDepth.askDepth;
      depthUsd += noDepth.bidDepth + noDepth.askDepth;

      // Extract best bid/ask for executable prices
      if (noBook.bids.length > 0) {
        bestBidNo = parseFloat(noBook.bids[0].price);
      }
      if (noBook.asks.length > 0) {
        bestAskNo = parseFloat(noBook.asks[0].price);
      }
      if (bestBidNo !== null && bestAskNo !== null) {
        midNo = (bestBidNo + bestAskNo) / 2;
      }
    }

    // Use Gamma API volume data (no auth required)
    const volume24h = market.volume24h;
    const tradeCount24h = 0; // Not available from Gamma, but not critical

    // Insert snapshot with executable prices (idempotent via UNIQUE constraint)
    try {
      db.run(
        `INSERT INTO market_snapshots (
          market_id, timestamp, price_yes, price_no, volume_24h, trade_count_24h,
          liquidity, spread, best_bid_yes, best_ask_yes, best_bid_no, best_ask_no,
          mid_yes, mid_no, depth_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          market.conditionId,
          timestamp,
          market.priceYes,
          market.priceNo,
          volume24h,
          tradeCount24h,
          liquidity,
          spread,
          bestBidYes,
          bestAskYes,
          bestBidNo,
          bestAskNo,
          midYes,
          midNo,
          depthUsd,
        ]
      );
      stats.snapshotsCreated++;
    } catch (error: unknown) {
      // Ignore duplicate key errors (idempotent)
      if (!(error instanceof Error && error.message.includes('UNIQUE constraint'))) {
        throw error;
      }
    }

    // Store order book snapshots (top 10 levels)
    if (yesBook) {
      this.storeOrderBook(market.conditionId, timestamp, 'yes', yesBook, stats);
    }
    if (noBook) {
      this.storeOrderBook(market.conditionId, timestamp, 'no', noBook, stats);
    }
  }

  /**
   * Store order book snapshot
   */
  private storeOrderBook(
    marketId: string,
    timestamp: string,
    side: 'yes' | 'no',
    book: { bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }> },
    stats: IngestStats
  ): void {
    const bids = book.bids.slice(0, 10);
    const asks = book.asks.slice(0, 10);

    try {
      db.run(
        `INSERT INTO orderbook_snapshots (market_id, timestamp, side, bids_json, asks_json)
         VALUES (?, ?, ?, ?, ?)`,
        [marketId, timestamp, side, JSON.stringify(bids), JSON.stringify(asks)]
      );
      stats.orderbooksStored++;
    } catch (error: unknown) {
      // Ignore duplicate key errors
      if (!(error instanceof Error && error.message.includes('UNIQUE constraint'))) {
        throw error;
      }
    }
  }
}

// Singleton instance
export const ingester = new Ingester();
