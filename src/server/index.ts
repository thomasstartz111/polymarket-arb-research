/**
 * Express API Server
 *
 * Exposes REST endpoints for the React dashboard.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { db } from '../db/client.js';
import { signalEngine } from '../signals/index.js';
import { generateTradePlan } from '../trading/planner.js';
import { checkTradeRisk, getPortfolioState } from '../trading/risk.js';
import { paperExecutor } from '../trading/paper.js';
import { config } from '../config/index.js';

const app = express();

app.use(cors());
app.use(express.json());

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('API Error:', err);
  res.status(500).json({ error: err.message });
});

// Types for database rows
interface MarketRow {
  id: string;
  question: string;
  slug: string | null;
  description: string | null;
  end_date_iso: string | null;
  category: string | null;
  active: number;
}

interface SnapshotRow {
  timestamp: string;
  price_yes: number;
  price_no: number;
  volume_24h: number;
  trade_count_24h: number;
  liquidity: number;
  spread: number;
}

interface OrderBookRow {
  side: string;
  bids_json: string;
  asks_json: string;
}

interface SignalRow {
  signal_id: string;
  signal_type: string;
  score: number;
  direction: string | null;
  rationale: string;
  features_json: string;
}

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
  status: string;
  exit_price: number | null;
  exit_reason: string | null;
  realized_pnl: number | null;
  entry_timestamp: string;
  exit_timestamp: string | null;
  question?: string;
}

/**
 * GET /api/signals
 * Returns ranked active signals
 */
app.get('/api/signals', (_req: Request, res: Response) => {
  try {
    const limit = parseInt(_req.query.limit as string) || 20;
    const signals = signalEngine.getRankedSignals(limit);
    res.json({ signals, count: signals.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/markets
 * Returns list of all active markets
 */
app.get('/api/markets', (_req: Request, res: Response) => {
  try {
    const limit = parseInt(_req.query.limit as string) || 100;
    const markets = db.all<MarketRow>(
      `SELECT m.id, m.question, m.slug, m.category, m.end_date_iso, m.active,
              s.price_yes, s.price_no, s.volume_24h, s.liquidity
       FROM markets m
       LEFT JOIN (
         SELECT market_id, price_yes, price_no, volume_24h, liquidity,
                ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY timestamp DESC) as rn
         FROM market_snapshots
       ) s ON m.id = s.market_id AND s.rn = 1
       WHERE m.active = 1
       ORDER BY s.volume_24h DESC
       LIMIT ?`,
      [limit]
    );
    res.json({ markets, count: markets.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/markets/:id
 * Returns market details with history and order book
 */
app.get('/api/markets/:id', (req: Request, res: Response) => {
  try {
    const marketId = req.params.id;

    // Get market
    const market = db.first<MarketRow>(
      `SELECT * FROM markets WHERE id = ?`,
      [marketId]
    );

    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    // Get price history (last 7 days)
    const history = db.all<SnapshotRow>(
      `SELECT timestamp, price_yes, price_no, volume_24h, trade_count_24h, liquidity, spread
       FROM market_snapshots
       WHERE market_id = ?
       ORDER BY timestamp DESC
       LIMIT 336`,
      [marketId]
    );

    // Get latest order book
    const orderbook = db.all<OrderBookRow>(
      `SELECT side, bids_json, asks_json
       FROM orderbook_snapshots
       WHERE market_id = ?
       ORDER BY timestamp DESC
       LIMIT 2`,
      [marketId]
    );

    // Get active signals for this market
    const signals = db.all<SignalRow>(
      `SELECT signal_id, signal_type, score, direction, rationale, features_json
       FROM signals
       WHERE market_id = ? AND status = 'active'
       ORDER BY score DESC`,
      [marketId]
    );

    // Get trades for this market
    const trades = db.all<TradeRow>(
      `SELECT * FROM trades WHERE market_id = ? ORDER BY entry_timestamp DESC`,
      [marketId]
    );

    res.json({
      market,
      history,
      orderbook: {
        yes: orderbook.find((o) => o.side === 'yes'),
        no: orderbook.find((o) => o.side === 'no'),
      },
      signals,
      trades,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/trades
 * Execute a paper trade
 */
app.post('/api/trades', async (req: Request, res: Response) => {
  try {
    const { signal_id, strategy } = req.body;

    if (!signal_id) {
      res.status(400).json({ error: 'signal_id required' });
      return;
    }

    // Get signal
    const signal = db.first<SignalRow & { market_id: string }>(
      `SELECT s.*, m.question, m.end_date_iso
       FROM signals s
       JOIN markets m ON s.market_id = m.id
       WHERE s.signal_id = ?`,
      [signal_id]
    );

    if (!signal) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }

    // Get latest market data
    const marketData = db.first<SnapshotRow & { id: string; question: string; end_date_iso: string | null }>(
      `SELECT m.id, m.question, m.end_date_iso, s.price_yes, s.price_no, s.liquidity
       FROM markets m
       JOIN market_snapshots s ON m.id = s.market_id
       WHERE m.id = ?
       ORDER BY s.timestamp DESC
       LIMIT 1`,
      [signal.market_id]
    );

    if (!marketData) {
      res.status(404).json({ error: 'Market data not found' });
      return;
    }

    const marketInfo = {
      id: marketData.id,
      question: marketData.question,
      priceYes: marketData.price_yes,
      priceNo: marketData.price_no,
      liquidity: marketData.liquidity,
      endDateIso: marketData.end_date_iso,
    };

    // Parse signal features
    const signalFeatures = JSON.parse(signal.features_json);

    // Generate trade plan
    const plan = generateTradePlan(
      signalFeatures,
      marketInfo,
      strategy || 'mean_reversion'
    );

    // Risk check
    const portfolio = getPortfolioState();
    const riskCheck = checkTradeRisk(plan, marketInfo, portfolio);

    if (!riskCheck.allowed) {
      res.status(400).json({
        error: 'Risk check failed',
        reason: riskCheck.reason,
      });
      return;
    }

    // Adjust size if needed
    if (riskCheck.adjustedSizeUsd) {
      plan.entrySizeUsd = riskCheck.adjustedSizeUsd;
    }

    // Execute paper trade
    const trade = await paperExecutor.execute(plan);

    // Mark signal as traded
    signalEngine.markAsTraded(signal_id);

    res.json({ trade, plan });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/trades
 * List all trades
 */
app.get('/api/trades', (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string) || 100;

    let query = `
      SELECT t.*, m.question
      FROM trades t
      JOIN markets m ON t.market_id = m.id
    `;

    const params: unknown[] = [];

    if (status) {
      query += ` WHERE t.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY t.entry_timestamp DESC LIMIT ?`;
    params.push(limit);

    const trades = db.all<TradeRow>(query, params);

    res.json({ trades, count: trades.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/trades/:id/close
 * Close a paper trade manually
 */
app.post('/api/trades/:id/close', async (req: Request, res: Response) => {
  try {
    const tradeId = req.params.id;
    const { exit_price } = req.body;

    if (!exit_price) {
      res.status(400).json({ error: 'exit_price required' });
      return;
    }

    const trade = await paperExecutor.closeTrade(tradeId, exit_price, 'manual');

    if (!trade) {
      res.status(404).json({ error: 'Trade not found or already closed' });
      return;
    }

    res.json({ trade });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/stats
 * System statistics
 */
app.get('/api/stats', (_req: Request, res: Response) => {
  try {
    const markets = db.first<{ count: number }>(
      `SELECT COUNT(*) as count FROM markets WHERE active = 1`
    );
    const snapshots = db.first<{ count: number }>(
      `SELECT COUNT(*) as count FROM market_snapshots`
    );
    const signals = db.first<{ count: number }>(
      `SELECT COUNT(*) as count FROM signals WHERE status = 'active'`
    );
    const trades = db.first<{ count: number }>(
      `SELECT COUNT(*) as count FROM trades`
    );

    const pnl = paperExecutor.getTotalPnl();
    const portfolio = getPortfolioState();

    res.json({
      markets: markets?.count || 0,
      snapshots: snapshots?.count || 0,
      activeSignals: signals?.count || 0,
      totalTrades: trades?.count || 0,
      totalPnl: pnl.total,
      winRate: pnl.winRate,
      wins: pnl.wins,
      losses: pnl.losses,
      openPositions: portfolio.totalOpenPositionsUsd,
      dailyPnl: portfolio.dailyPnlPct * config.risk.totalBankrollUsd,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/signals/:id/dismiss
 * Dismiss a signal
 */
app.post('/api/signals/:id/dismiss', (req: Request, res: Response) => {
  try {
    const signalId = req.params.id;
    signalEngine.dismissSignal(signalId);
    res.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * Start the server
 */
export function startServer(port?: number): void {
  const serverPort = port || config.serverPort;
  app.listen(serverPort, () => {
    console.log(`🚀 API server running on http://localhost:${serverPort}`);
  });
}

export { app };
