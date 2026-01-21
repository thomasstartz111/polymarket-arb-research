/**
 * Polymarket Scanner - Main Entry Point
 *
 * Starts the ingester, signal engine, and API server.
 */

import { db } from './db/client.js';
import { ingester } from './ingester/index.js';
import { signalEngine } from './signals/index.js';
import { startServer } from './server/index.js';
import { config } from './config/index.js';
import { polymarketWS, type PriceUpdate } from './api/websocket.js';
import { gammaClient } from './api/gamma.js';

/**
 * Start WebSocket mode for real-time price updates
 */
async function startWebSocketMode(): Promise<void> {
  // First, do an initial poll to get all market tokens
  console.log('📥 Fetching markets for WebSocket subscriptions...');
  const markets = await gammaClient.getAllActiveMarkets();
  console.log(`   Found ${markets.length} markets`);

  // Store initial market data
  const timestamp = new Date().toISOString();
  for (const market of markets.slice(0, 500)) { // Limit for WS connections
    db.run(
      `INSERT INTO markets (id, question, slug, description, end_date_iso, category, active, outcome_yes_token, outcome_no_token, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`,
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
  }

  // Connect to WebSocket
  await polymarketWS.connect();

  // Subscribe to top markets by volume
  const topMarkets = markets
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 200); // Subscribe to top 200 by volume

  console.log(`🔌 Subscribing to ${topMarkets.length} markets...`);
  for (const market of topMarkets) {
    polymarketWS.subscribe(market.yesTokenId);
    polymarketWS.subscribe(market.noTokenId);
  }

  // Track price updates for signal detection
  let updateCount = 0;
  const priceCache = new Map<string, PriceUpdate>();

  polymarketWS.on('price', (update) => {
    updateCount++;
    priceCache.set(update.tokenId, update);

    // Log every 100th update
    if (updateCount % 100 === 0) {
      console.log(`⚡ ${updateCount} real-time updates received`);
    }
  });

  // Run signal detection periodically on WS data
  setInterval(async () => {
    if (priceCache.size > 0) {
      console.log(`📊 Processing ${priceCache.size} cached price updates...`);

      // Update database with latest prices
      const now = new Date().toISOString();
      for (const [tokenId, update] of priceCache) {
        // Find which market this token belongs to
        const market = db.first<{ id: string; outcome_yes_token: string }>(
          `SELECT id, outcome_yes_token FROM markets WHERE outcome_yes_token = ? OR outcome_no_token = ?`,
          [tokenId, tokenId]
        );

        if (market && update.mid !== null) {
          const isYes = market.outcome_yes_token === tokenId;
          const column = isYes ? 'price_yes' : 'price_no';
          const bidColumn = isYes ? 'best_bid_yes' : 'best_bid_no';
          const askColumn = isYes ? 'best_ask_yes' : 'best_ask_no';
          const midColumn = isYes ? 'mid_yes' : 'mid_no';

          // Upsert snapshot
          db.run(
            `INSERT INTO market_snapshots (market_id, timestamp, ${column}, price_yes, price_no, ${bidColumn}, ${askColumn}, ${midColumn})
             VALUES (?, ?, ?, COALESCE((SELECT price_yes FROM market_snapshots WHERE market_id = ? ORDER BY timestamp DESC LIMIT 1), 0.5),
                     COALESCE((SELECT price_no FROM market_snapshots WHERE market_id = ? ORDER BY timestamp DESC LIMIT 1), 0.5), ?, ?, ?)
             ON CONFLICT(market_id, timestamp) DO UPDATE SET
               ${column} = excluded.${column},
               ${bidColumn} = excluded.${bidColumn},
               ${askColumn} = excluded.${askColumn},
               ${midColumn} = excluded.${midColumn}`,
            [market.id, now, update.mid, market.id, market.id, update.bestBid, update.bestAsk, update.mid]
          );
        }
      }

      // Update last ingest timestamp
      db.run(
        `UPDATE system_state SET value = ?, updated_at = ? WHERE key = 'last_ingest'`,
        [now, now]
      );

      // Run signal detection
      const signals = await signalEngine.processNewSnapshots(now);
      if (signals.length > 0) {
        console.log(`   🎯 Generated ${signals.length} new signals!`);
      }

      // Expire old signals
      signalEngine.expireOldSignals();

      // Clear cache for next batch
      priceCache.clear();
    }
  }, 5000); // Process every 5 seconds

  console.log(`   Subscribed to ${polymarketWS.getSubscriptionCount()} tokens`);
}

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║           📊 POLYMARKET SCANNER                       ║');
  console.log('║           Signal Detection & Paper Trading            ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Run database migrations
  console.log('📦 Running database migrations...');
  db.migrate();
  console.log(`   Database: ${db.getPath()}`);
  console.log('');

  // 2. Start API server
  console.log('🌐 Starting API server...');
  startServer(config.serverPort);
  console.log('');

  // 3. Set up signal engine callback to process signals after each ingest
  ingester.setOnCycleComplete(async (stats) => {
    // Get the latest timestamp from system_state
    const lastIngest = db.first<{ value: string }>(
      `SELECT value FROM system_state WHERE key = 'last_ingest'`
    );

    if (lastIngest?.value) {
      // Run signal detection on the new snapshot
      const signals = await signalEngine.processNewSnapshots(lastIngest.value);
      if (signals.length > 0) {
        console.log(`   🎯 Generated ${signals.length} new signals!`);
      }
    }

    // Expire old signals
    const expired = signalEngine.expireOldSignals();
    if (expired > 0) {
      console.log(`   Expired ${expired} old signals`);
    }
  });

  // 4. Start data ingestion (polling or websocket)
  if (config.useWebSocket) {
    console.log('⚡ Starting WebSocket real-time mode...');
    await startWebSocketMode();
  } else {
    console.log(`⏱️  Starting polling mode (${config.pollIntervalMs / 1000}s interval)...`);
    ingester.start();
  }
  console.log('');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Dashboard: http://localhost:5173 (run `cd ui && npm run dev`)');
  console.log(`  API:       http://localhost:${config.serverPort}`);
  console.log('');
  console.log('  Endpoints:');
  console.log('    GET  /api/signals     - Ranked active signals');
  console.log('    GET  /api/markets     - List all markets');
  console.log('    GET  /api/markets/:id - Market details');
  console.log('    POST /api/trades      - Execute paper trade');
  console.log('    GET  /api/trades      - List trades');
  console.log('    GET  /api/stats       - System statistics');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down...');
    ingester.stop();
    if (config.useWebSocket) {
      polymarketWS.disconnect();
    }
    db.close();
    console.log('👋 Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
