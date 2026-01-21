/**
 * Paper Trading Executor
 *
 * Simulates trade execution without real money.
 * Records trades to database for P&L tracking.
 */

import { v4 as uuidv4 } from 'uuid';
import { db, nowISO } from '../db/client.js';
import type { TradePlan, Trade } from './types.js';

interface TradeRow {
  trade_id: string;
  signal_id: string | null;
  market_id: string;
  mode: string;
  side: string;
  direction: string;
  entry_price: number;
  target_price: number | null;
  stop_loss_price: number | null;
  size_usd: number;
  size_shares: number | null;
  status: string;
  exit_price: number | null;
  exit_reason: string | null;
  realized_pnl: number | null;
  entry_timestamp: string;
  exit_timestamp: string | null;
  max_hold_hours: number | null;
  notes: string | null;
}

/**
 * Paper Trading Executor
 */
class PaperExecutor {
  /**
   * Execute a paper trade from a plan
   */
  async execute(plan: TradePlan): Promise<Trade> {
    const tradeId = uuidv4();
    const entryTimestamp = nowISO();

    // Calculate shares from USD size
    const sizeShares = plan.entrySizeUsd / plan.entryPrice;

    // Insert trade record
    db.run(
      `INSERT INTO trades (
        trade_id, signal_id, market_id, mode, side, direction,
        entry_price, target_price, stop_loss_price,
        size_usd, size_shares, status,
        entry_timestamp, max_hold_hours, notes
      ) VALUES (?, ?, ?, 'paper', ?, 'buy', ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      [
        tradeId,
        plan.signalId,
        plan.marketId,
        plan.entrySide,
        plan.entryPrice,
        plan.targetPrice,
        plan.stopLossPrice,
        plan.entrySizeUsd,
        sizeShares,
        entryTimestamp,
        plan.maxHoldHours,
        `Strategy: ${plan.strategy}. ${plan.sizingRationale}`,
      ]
    );

    return {
      tradeId,
      signalId: plan.signalId,
      marketId: plan.marketId,
      mode: 'paper',
      side: plan.entrySide,
      direction: 'buy',
      entryPrice: plan.entryPrice,
      targetPrice: plan.targetPrice,
      stopLossPrice: plan.stopLossPrice,
      sizeUsd: plan.entrySizeUsd,
      sizeShares,
      status: 'open',
      exitPrice: null,
      exitReason: null,
      realizedPnl: null,
      entryTimestamp,
      exitTimestamp: null,
      maxHoldHours: plan.maxHoldHours,
      notes: `Strategy: ${plan.strategy}`,
    };
  }

  /**
   * Close a paper trade
   */
  async closeTrade(
    tradeId: string,
    exitPrice: number,
    reason: 'target' | 'stop' | 'time' | 'manual' | 'resolution'
  ): Promise<Trade | null> {
    const trade = this.getTrade(tradeId);
    if (!trade || trade.status !== 'open') {
      return null;
    }

    const exitTimestamp = nowISO();

    // Calculate P&L
    // For a "buy" direction:
    // - If we bought Yes and exit price is higher, we profit
    // - If we bought No and exit price is higher, we profit
    const priceDiff = exitPrice - trade.entryPrice;
    const returnPct = priceDiff / trade.entryPrice;
    const realizedPnl = trade.sizeUsd * returnPct;

    db.run(
      `UPDATE trades SET
        status = 'closed',
        exit_price = ?,
        exit_reason = ?,
        realized_pnl = ?,
        exit_timestamp = ?
       WHERE trade_id = ?`,
      [exitPrice, reason, realizedPnl, exitTimestamp, tradeId]
    );

    return {
      ...trade,
      status: 'closed',
      exitPrice,
      exitReason: reason,
      realizedPnl,
      exitTimestamp,
    };
  }

  /**
   * Cancel a paper trade
   */
  async cancelTrade(tradeId: string): Promise<boolean> {
    const result = db.run(
      `UPDATE trades SET status = 'cancelled' WHERE trade_id = ? AND status = 'open'`,
      [tradeId]
    );
    return result.changes > 0;
  }

  /**
   * Get a trade by ID
   */
  getTrade(tradeId: string): Trade | null {
    const row = db.first<TradeRow>(
      `SELECT * FROM trades WHERE trade_id = ?`,
      [tradeId]
    );

    if (!row) return null;

    return this.rowToTrade(row);
  }

  /**
   * Get all open trades
   */
  getOpenTrades(): Trade[] {
    const rows = db.all<TradeRow>(`SELECT * FROM trades WHERE status = 'open'`);
    return rows.map(this.rowToTrade);
  }

  /**
   * Get recent trades
   */
  getRecentTrades(limit = 50): Trade[] {
    const rows = db.all<TradeRow>(
      `SELECT * FROM trades ORDER BY entry_timestamp DESC LIMIT ?`,
      [limit]
    );
    return rows.map(this.rowToTrade);
  }

  /**
   * Get trades by market
   */
  getTradesByMarket(marketId: string): Trade[] {
    const rows = db.all<TradeRow>(
      `SELECT * FROM trades WHERE market_id = ? ORDER BY entry_timestamp DESC`,
      [marketId]
    );
    return rows.map(this.rowToTrade);
  }

  /**
   * Calculate total P&L
   */
  getTotalPnl(): { total: number; wins: number; losses: number; winRate: number } {
    const rows = db.all<{ realized_pnl: number }>(
      `SELECT realized_pnl FROM trades WHERE status = 'closed' AND realized_pnl IS NOT NULL`
    );

    const total = rows.reduce((sum, r) => sum + r.realized_pnl, 0);
    const wins = rows.filter((r) => r.realized_pnl > 0).length;
    const losses = rows.filter((r) => r.realized_pnl <= 0).length;
    const winRate = rows.length > 0 ? wins / rows.length : 0;

    return { total, wins, losses, winRate };
  }

  /**
   * Check open trades against current prices and auto-close if needed
   */
  async checkAndCloseOpenTrades(
    getCurrentPrice: (marketId: string, side: 'yes' | 'no') => Promise<number | null>
  ): Promise<Trade[]> {
    const openTrades = this.getOpenTrades();
    const closedTrades: Trade[] = [];

    for (const trade of openTrades) {
      const currentPrice = await getCurrentPrice(trade.marketId, trade.side);
      if (currentPrice === null) continue;

      // Check stop loss
      if (trade.stopLossPrice && trade.stopLossPrice > 0) {
        if (trade.side === 'yes' && currentPrice <= trade.stopLossPrice) {
          const closed = await this.closeTrade(trade.tradeId, currentPrice, 'stop');
          if (closed) closedTrades.push(closed);
          continue;
        }
        if (trade.side === 'no' && currentPrice <= trade.stopLossPrice) {
          const closed = await this.closeTrade(trade.tradeId, currentPrice, 'stop');
          if (closed) closedTrades.push(closed);
          continue;
        }
      }

      // Check target
      if (trade.targetPrice) {
        if (currentPrice >= trade.targetPrice) {
          const closed = await this.closeTrade(trade.tradeId, currentPrice, 'target');
          if (closed) closedTrades.push(closed);
          continue;
        }
      }

      // Check time limit
      if (trade.maxHoldHours) {
        const holdHours =
          (Date.now() - new Date(trade.entryTimestamp).getTime()) / (1000 * 60 * 60);
        if (holdHours >= trade.maxHoldHours) {
          const closed = await this.closeTrade(trade.tradeId, currentPrice, 'time');
          if (closed) closedTrades.push(closed);
          continue;
        }
      }
    }

    return closedTrades;
  }

  /**
   * Convert database row to Trade object
   */
  private rowToTrade(row: TradeRow): Trade {
    return {
      tradeId: row.trade_id,
      signalId: row.signal_id,
      marketId: row.market_id,
      mode: row.mode as 'paper' | 'live',
      side: row.side as 'yes' | 'no',
      direction: row.direction as 'buy' | 'sell',
      entryPrice: row.entry_price,
      targetPrice: row.target_price,
      stopLossPrice: row.stop_loss_price,
      sizeUsd: row.size_usd,
      sizeShares: row.size_shares,
      status: row.status as 'open' | 'closed' | 'cancelled',
      exitPrice: row.exit_price,
      exitReason: row.exit_reason as Trade['exitReason'],
      realizedPnl: row.realized_pnl,
      entryTimestamp: row.entry_timestamp,
      exitTimestamp: row.exit_timestamp,
      maxHoldHours: row.max_hold_hours,
      notes: row.notes,
    };
  }
}

export const paperExecutor = new PaperExecutor();
