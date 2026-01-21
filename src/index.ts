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

  // 4. Start ingester
  console.log(`⏱️  Starting ingester (${config.pollIntervalMs / 1000}s interval)...`);
  ingester.start();
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
