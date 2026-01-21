/**
 * Signal Engine (V2 - With Tradability Gating)
 *
 * Orchestrates signal computation across all market snapshots.
 * V2 improvements:
 * - Uses executable prices (bid/ask) instead of last trade
 * - Gates all signals with tradability checks
 * - Passes order book data to signals for better accuracy
 */

import { db, nowISO } from '../db/client.js';
import { config } from '../config/index.js';
import {
  computeComplementSignal,
  generateComplementRationale,
} from './complement.js';
import {
  computeAnchoringSignal,
  buildAnchoringInput,
  generateAnchoringRationale,
} from './anchoring.js';
import {
  computeAttentionSignal,
  generateAttentionRationale,
} from './attention.js';
import {
  computeDeadlineSignal,
  generateDeadlineRationale,
} from './deadline.js';
import {
  scanForCorrelationSignals,
  generateCorrelationRationale,
  type CorrelationSignal,
} from './correlation.js';
import { computeTradability, type Tradability } from './tradability.js';
import { rankSignals, getTopSignals } from './ranking.js';
import type {
  Signal,
  RankedSignal,
  MarketData,
  HistoricalSnapshot,
} from './types.js';
import type { OrderBook } from '../api/types.js';

interface MarketRow {
  id: string;
  question: string;
  description: string | null;
  end_date_iso: string | null;
  category: string | null;
  price_yes: number;
  price_no: number;
  volume_24h: number;
  trade_count_24h: number;
  liquidity: number;
  spread: number;
  // New executable price columns
  best_bid_yes: number | null;
  best_ask_yes: number | null;
  best_bid_no: number | null;
  best_ask_no: number | null;
  mid_yes: number | null;
  mid_no: number | null;
  depth_usd: number | null;
}

interface SnapshotRow {
  timestamp: string;
  price_yes: number;
  price_no: number;
  volume_24h: number;
  trade_count_24h: number;
  liquidity: number;
  mid_yes: number | null;
  mid_no: number | null;
}

interface OrderBookRow {
  side: 'yes' | 'no';
  bids_json: string;
  asks_json: string;
}

interface SignalRow {
  signal_id: string;
  market_id: string;
  signal_type: string;
  score: number;
  composite_score: number;
  rationale: string;
  features_json: string;
  question: string;
  category: string;
  end_date_iso: string;
}

// Minimum tradability score to accept a signal (DISABLED for testing)
const MIN_TRADABILITY_SCORE = 0; // Was 20, set to 0 to see what signals would fire

class SignalEngine {
  /**
   * Process new snapshots and generate signals
   */
  async processNewSnapshots(timestamp: string): Promise<Signal[]> {
    const signals: Signal[] = [];

    // Get all active markets with their latest snapshots (including executable prices)
    const markets = db.all<MarketRow>(
      `SELECT m.id, m.question, m.description, m.end_date_iso, m.category,
              s.price_yes, s.price_no, s.volume_24h, s.trade_count_24h, s.liquidity, s.spread,
              s.best_bid_yes, s.best_ask_yes, s.best_bid_no, s.best_ask_no,
              s.mid_yes, s.mid_no, s.depth_usd
       FROM markets m
       JOIN market_snapshots s ON m.id = s.market_id
       WHERE m.active = 1 AND s.timestamp = ?`,
      [timestamp]
    );

    if (markets.length === 0) {
      console.log('No markets found for timestamp:', timestamp);
      return signals;
    }

    // Calculate total volume for attention scores
    const totalVolume = markets.reduce((sum, m) => sum + (m.volume_24h || 0), 0);

    let skippedForTradability = 0;

    for (const market of markets) {
      // Get order books for tradability check
      const orderBooks = this.getOrderBooks(market.id, timestamp);
      const tradability = computeTradability(orderBooks.yes, orderBooks.no);

      // Skip untradable markets (DISABLED for testing - checking score only)
      if (tradability.score < MIN_TRADABILITY_SCORE) {
        skippedForTradability++;
        continue;
      }

      // Get historical snapshots for this market
      const history = db.all<SnapshotRow>(
        `SELECT timestamp, price_yes, price_no, volume_24h, trade_count_24h, liquidity, mid_yes, mid_no
         FROM market_snapshots
         WHERE market_id = ? AND timestamp <= ?
         ORDER BY timestamp DESC
         LIMIT 48`,
        [market.id, timestamp]
      );

      // 1. Complement Signal (using executable prices)
      if (config.signals.complement.enabled) {
        const signal = computeComplementSignal({
          marketId: market.id,
          yesAsk: market.best_ask_yes,
          yesBid: market.best_bid_yes,
          noAsk: market.best_ask_no,
          noBid: market.best_bid_no,
          priceYes: market.price_yes,
          priceNo: market.price_no,
        });

        if (signal.isTriggered) {
          signals.push(signal);
          this.storeSignal(signal, market, tradability, generateComplementRationale(signal));
        }
      }

      // 2. Anchoring Signal (using midpoints)
      if (config.signals.anchoring.enabled && history.length >= 5) {
        const anchoringInput = buildAnchoringInput(
          market.id,
          history.map((h) => ({
            timestamp: h.timestamp,
            priceYes: h.price_yes,
            priceNo: h.price_no,
            volume24h: h.volume_24h,
            tradeCount24h: h.trade_count_24h,
            liquidity: h.liquidity,
            midYes: h.mid_yes,
            midNo: h.mid_no,
          }))
        );

        if (anchoringInput) {
          const signal = computeAnchoringSignal(anchoringInput);
          if (signal.isTriggered) {
            signals.push(signal);
            this.storeSignal(signal, market, tradability, generateAnchoringRationale(signal));
          }
        }
      }

      // 3. Attention Signal (with tradability gate already passed)
      if (config.signals.attention.enabled) {
        const signal = computeAttentionSignal({
          marketId: market.id,
          volume24h: market.volume_24h || 0,
          tradeCount24h: market.trade_count_24h || 0,
          bookDepthYes: market.liquidity / 2,
          bookDepthNo: market.liquidity / 2,
          spread: market.spread || 0.02,
          hoursSinceLastTrade: 0,
          totalMarketsVolume24h: totalVolume,
        });

        if (signal.isLowAttention) {
          signals.push(signal);
          this.storeSignal(signal, market, tradability, generateAttentionRationale(signal));
        }
      }

      // 4. Deadline Signal
      if (config.signals.deadline.enabled && market.end_date_iso) {
        const signal = computeDeadlineSignal({
          marketId: market.id,
          priceYes: market.mid_yes || market.price_yes,
          endDateIso: market.end_date_iso,
          resolutionSource: market.description || '',
          question: market.question,
        });

        if (signal.isTriggered) {
          signals.push(signal);
          this.storeSignal(signal, market, tradability, generateDeadlineRationale(signal));
        }
      }
    }

    // 5. Correlation Signals (runs once per cycle, not per market)
    const correlationSignals = scanForCorrelationSignals();
    for (const signal of correlationSignals) {
      signals.push(signal as unknown as Signal);
      // Store with minimal tradability (correlation signals span multiple markets)
      const dummyMarket = markets.find(m => m.id === signal.marketId);
      if (dummyMarket) {
        const orderBooks = this.getOrderBooks(signal.marketId, timestamp);
        const tradability = computeTradability(orderBooks.yes, orderBooks.no);
        this.storeSignal(
          signal as unknown as Signal,
          dummyMarket,
          tradability,
          generateCorrelationRationale(signal)
        );
      }
    }

    console.log(
      `📊 Signal engine: ${signals.length} signals from ${markets.length} markets ` +
      `(${skippedForTradability} skipped for tradability, ${correlationSignals.length} correlation)`
    );
    return signals;
  }

  /**
   * Get order books for a market from the database
   */
  private getOrderBooks(
    marketId: string,
    timestamp: string
  ): { yes: OrderBook | null; no: OrderBook | null } {
    const rows = db.all<OrderBookRow>(
      `SELECT side, bids_json, asks_json
       FROM orderbook_snapshots
       WHERE market_id = ? AND timestamp = ?`,
      [marketId, timestamp]
    );

    let yesBook: OrderBook | null = null;
    let noBook: OrderBook | null = null;

    for (const row of rows) {
      const book: OrderBook = {
        market: marketId,
        asset_id: '',
        hash: '',
        bids: JSON.parse(row.bids_json),
        asks: JSON.parse(row.asks_json),
        timestamp,
      };

      if (row.side === 'yes') {
        yesBook = book;
      } else {
        noBook = book;
      }
    }

    return { yes: yesBook, no: noBook };
  }

  /**
   * Store signal to database with tradability info
   */
  private storeSignal(
    signal: Signal,
    market: MarketRow,
    tradability: Tradability,
    rationale: string
  ): void {
    const now = nowISO();
    const expiresAt = this.calculateExpiry(signal);

    // Enrich signal with tradability info
    const enrichedSignal = {
      ...signal,
      tradability: {
        score: tradability.score,
        spreadPct: tradability.spreadPct,
        depthUsd: tradability.depthUsd,
        slippageFor250: tradability.slippageFor250,
      },
      bookState: {
        yesBid: market.best_bid_yes,
        yesAsk: market.best_ask_yes,
        noBid: market.best_bid_no,
        noAsk: market.best_ask_no,
        midYes: market.mid_yes,
        midNo: market.mid_no,
      },
    };

    // Enhanced rationale with tradability info
    const enhancedRationale =
      `${rationale} | Tradability: ${tradability.score.toFixed(0)}/100, ` +
      `Spread: ${(tradability.spreadPct * 100).toFixed(1)}%, ` +
      `Depth: $${tradability.depthUsd.toFixed(0)}`;

    try {
      db.run(
        `INSERT INTO signals (signal_id, market_id, signal_type, detected_at, expires_at, score, composite_score, edge_estimate, direction, features_json, rationale, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
         ON CONFLICT(signal_id) DO UPDATE SET
           score = excluded.score,
           composite_score = excluded.composite_score,
           edge_estimate = excluded.edge_estimate,
           features_json = excluded.features_json,
           rationale = excluded.rationale`,
        [
          signal.signalId,
          signal.marketId,
          signal.signalType,
          now,
          expiresAt,
          signal.score,
          signal.score, // Will be updated by ranking
          signal.edgeCents,
          signal.direction,
          JSON.stringify(enrichedSignal),
          enhancedRationale,
        ]
      );
    } catch (error) {
      console.error(`Failed to store signal ${signal.signalId}:`, error);
    }
  }

  /**
   * Calculate signal expiry time
   */
  private calculateExpiry(signal: Signal): string | null {
    const now = new Date();

    switch (signal.signalType) {
      case 'complement':
      case 'anchoring':
        // Expire in 2 hours
        return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

      case 'low_attention':
        // Expire in 24 hours
        return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      case 'deadline': {
        // Expire at market resolution
        const deadlineSignal = signal as { hoursToResolution: number };
        return new Date(
          now.getTime() + deadlineSignal.hoursToResolution * 60 * 60 * 1000
        ).toISOString();
      }

      default:
        return null;
    }
  }

  /**
   * Get ranked active signals
   */
  getRankedSignals(limit = 20): RankedSignal[] {
    const rows = db.all<SignalRow>(
      `SELECT s.signal_id, s.market_id, s.signal_type, s.score, s.composite_score, s.rationale, s.features_json,
              m.question, m.category, m.end_date_iso
       FROM signals s
       JOIN markets m ON s.market_id = m.id
       WHERE s.status = 'active'
         AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
       ORDER BY s.score DESC
       LIMIT ?`,
      [limit * 2] // Fetch more for ranking
    );

    const signals: Signal[] = rows.map((row) => {
      const features = JSON.parse(row.features_json);
      return {
        ...features,
        signalId: row.signal_id,
        marketId: row.market_id,
        signalType: row.signal_type,
        score: row.score,
      };
    });

    const ranked = rankSignals(signals);

    // Enrich with market data
    return getTopSignals(ranked, limit).map((r) => {
      const row = rows.find((row) => row.signal_id === r.signal.signalId);
      return {
        ...r,
        question: row?.question,
        category: row?.category,
        endDateIso: row?.end_date_iso,
        rationale: row?.rationale,
      };
    });
  }

  /**
   * Expire old signals
   */
  expireOldSignals(): number {
    const result = db.run(
      `UPDATE signals SET status = 'expired'
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < datetime('now')`
    );
    return result.changes;
  }

  /**
   * Dismiss a signal
   */
  dismissSignal(signalId: string): void {
    db.run(`UPDATE signals SET status = 'dismissed' WHERE signal_id = ?`, [signalId]);
  }

  /**
   * Mark signal as traded
   */
  markAsTraded(signalId: string): void {
    db.run(`UPDATE signals SET status = 'traded' WHERE signal_id = ?`, [signalId]);
  }
}

export const signalEngine = new SignalEngine();

// Re-export types and utilities
export type { Signal, RankedSignal, MarketData };
export { rankSignals, getTopSignals };
