/**
 * Application configuration
 * All configurable values in one place
 */

export interface Config {
  // Server
  serverPort: number;

  // Data ingestion
  pollIntervalMs: number;
  useWebSocket: boolean; // Use real-time WebSocket instead of polling

  // Polymarket API
  polymarketBaseUrl: string;
  polymarketAuth: {
    apiKey: string | null;
    apiSecret: string | null;
    passphrase: string | null;
    address: string | null;
  };

  // Risk parameters (paper trading)
  risk: {
    totalBankrollUsd: number;
    maxPositionPct: number;
    maxPositionUsd: number;
    maxEventExposurePct: number;
    maxTotalExposurePct: number;
    minMarketLiquidityUsd: number;
    maxBookImpactPct: number;
    minHoursToResolution: number;
    dailyLossLimitPct: number;
    consecutiveLossLimit: number;
  };

  // Signal thresholds
  signals: {
    complement: {
      enabled: boolean;
      deviationThreshold: number; // Cents deviation from 0.98
      feeRate: number;
    };
    anchoring: {
      enabled: boolean;
      priceChangeThreshold: number; // Percentage move
      volumeRatioThreshold: number; // Volume vs average
      minTrades: number;
    };
    attention: {
      enabled: boolean;
      lowAttentionThreshold: number; // 0-100 score
    };
    deadline: {
      enabled: boolean;
      mispricingThreshold: number; // Points above base rate
      minHours: number;
    };
  };
}

// Default configuration
export const config: Config = {
  serverPort: parseInt(process.env.PORT || '3000', 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000', 10),
  useWebSocket: process.env.USE_WEBSOCKET === 'true', // Enable with USE_WEBSOCKET=true

  polymarketBaseUrl: 'https://clob.polymarket.com',
  polymarketAuth: {
    apiKey: process.env.POLY_API_KEY || null,
    apiSecret: process.env.POLY_API_SECRET || null,
    passphrase: process.env.POLY_PASSPHRASE || null,
    address: process.env.POLY_ADDRESS || null,
  },

  risk: {
    totalBankrollUsd: 10000,
    maxPositionPct: 0.05,
    maxPositionUsd: 500,
    maxEventExposurePct: 0.10,
    maxTotalExposurePct: 0.50,
    minMarketLiquidityUsd: 1000,
    maxBookImpactPct: 0.05,
    minHoursToResolution: 24,
    dailyLossLimitPct: 0.05,
    consecutiveLossLimit: 5,
  },

  signals: {
    complement: {
      enabled: true,
      deviationThreshold: 0.01, // 1 cent - catch micro-arbs
      feeRate: 0.02, // 2% total fees
    },
    anchoring: {
      enabled: true,
      priceChangeThreshold: 0.03, // 3% move - catch smaller reversions
      volumeRatioThreshold: 0.8, // Less than 80% of avg volume
      minTrades: 2,
    },
    attention: {
      enabled: true,
      lowAttentionThreshold: 60, // Attention score below 60 - way more signals
    },
    deadline: {
      enabled: true,
      mispricingThreshold: 0.05, // 5 points above base rate
      minHours: 6, // Catch closer deadlines
    },
  },
};

export default config;
