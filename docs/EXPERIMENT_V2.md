# Polymarket Scanner V2 Experiment Plan

## Goal
Run a week-long experiment to detect tradeable inefficiencies in Polymarket prediction markets.

## Current State (Jan 2025)
- Scanner running, ingesting 5000+ markets
- 4 signal types: complement arbitrage, anchoring bias, low attention, deadline mispricing
- Paper trading system ready
- Zero tradeable signals found with previous thresholds (market is efficient)

---

## Phase 1: Loosened Thresholds (APPLIED)

Config changes in `src/config/index.ts`:

```typescript
signals: {
  complement: {
    deviationThreshold: 0.01, // 1 cent (was 2) - catch micro-arbs
  },
  anchoring: {
    priceChangeThreshold: 0.03, // 3% (was 5%) - smaller reversions
    volumeRatioThreshold: 0.8,  // 80% (was 70%)
  },
  attention: {
    lowAttentionThreshold: 60,  // (was 40) - way more signals
  },
  deadline: {
    mispricingThreshold: 0.05,  // 5% (was 10%)
    minHours: 6,                // (was 12)
  },
}
```

---

## Phase 2: New Signal Types (TODO)

### 2.1 Cross-Market Correlation
Related markets should be correlated. Detect when they diverge.

Create `src/signals/correlation.ts`:
```typescript
// Example pairs to track:
// - "Trump wins" vs "GOP wins presidency"
// - "Fed raises rates" vs "Inflation stays high"
// - State-level vs national election outcomes

interface CorrelationSignal {
  marketA: string;
  marketB: string;
  expectedCorrelation: number; // -1 to 1
  actualCorrelation: number;
  divergence: number;
}
```

### 2.2 Volume Spike Detection
Unusual activity often precedes price moves.

Create `src/signals/volume.ts`:
```typescript
// Detect when:
// - Volume > 3x 24h average
// - Order book depth changes suddenly
// - Large orders appear

interface VolumeSignal {
  marketId: string;
  volumeRatio: number;
  priceBeforeSpike: number;
  suggestedDirection: 'follow' | 'fade';
}
```

### 2.3 Spread Analysis
When spreads tighten/widen, it signals confidence changes.

Create `src/signals/spread.ts`:
```typescript
// Track spread changes over time
// Tightening spread + price move = confidence
// Widening spread = uncertainty, possible opportunity
```

### 2.4 Momentum/Mean Reversion
Track price trends and predict reversions.

---

## Phase 3: Better Logging & Monitoring

### 3.1 Add tradability failure tracking
Update `src/signals/tradability.ts` to log WHY signals fail:
- Spread too wide
- Depth too shallow
- Slippage too high
- Already near resolution

### 3.2 Near-miss logging
Log signals that almost passed tradability for analysis.

### 3.3 Health endpoint
Add `/api/health` returning:
```json
{
  "uptime": "3d 4h 12m",
  "marketsTracked": 5073,
  "signalsToday": 47,
  "tradeableToday": 2,
  "lastIngestion": "2025-01-20T12:34:56Z"
}
```

---

## Phase 4: Running the Experiment

### Start Commands

```bash
# Terminal 1: Backend
cd polymarket-arb-research
npm run dev

# Terminal 2: UI Dashboard
cd polymarket-arb-research/ui
npm install  # first time only
npm run dev
# Opens http://localhost:5173
```

### Background Service (macOS)

Create `~/Library/LaunchAgents/com.polymarket.scanner.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.polymarket.scanner</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/polymarket-arb-research/dist/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/polymarket-scanner.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/polymarket-scanner.err</string>
</dict>
</plist>
```

Load with: `launchctl load ~/Library/LaunchAgents/com.polymarket.scanner.plist`

### Docker Alternative
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY data ./data
CMD ["node", "dist/index.js"]
```

---

## Phase 5: Analysis Queries

After running for 7 days, analyze results:

### Signal Distribution
```sql
SELECT
  signal_type,
  COUNT(*) as total,
  SUM(CASE WHEN tradeable = 1 THEN 1 ELSE 0 END) as tradeable,
  AVG(strength) as avg_strength
FROM signals
WHERE created_at > datetime('now', '-7 days')
GROUP BY signal_type;
```

### Best Performing Signals
```sql
SELECT
  s.id,
  s.signal_type,
  s.strength,
  s.market_id,
  m.question,
  t.pnl_usd
FROM signals s
JOIN markets m ON s.market_id = m.id
LEFT JOIN trades t ON t.signal_id = s.id
WHERE s.created_at > datetime('now', '-7 days')
ORDER BY t.pnl_usd DESC NULLS LAST
LIMIT 20;
```

### Tradability Failures
```sql
SELECT
  failure_reason,
  COUNT(*) as count
FROM signal_failures
WHERE created_at > datetime('now', '-7 days')
GROUP BY failure_reason
ORDER BY count DESC;
```

### Market Efficiency Over Time
```sql
SELECT
  date(created_at) as day,
  COUNT(*) as signals,
  AVG(deviation) as avg_deviation
FROM signals
WHERE signal_type = 'complement'
GROUP BY day
ORDER BY day;
```

---

## Success Criteria

After 7 days, evaluate:

1. **Signal Volume**: Are we generating >10 signals/day?
2. **Tradeable Rate**: What % pass tradability checks?
3. **Paper P&L**: Would we be profitable?
4. **Market Timing**: When do opportunities appear? (news events? low volume hours?)

---

## Next Steps After Experiment

If successful:
1. Implement real trading with small capital ($100-500)
2. Add more sophisticated signals (ML-based?)
3. Connect to Polymarket API for live execution

If no edge found:
1. Market is efficient - focus elsewhere
2. Consider higher-frequency data (websockets)
3. Look at other prediction markets (Kalshi, Metaculus)
