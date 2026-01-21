/**
 * Risk Management System
 *
 * Checks all trades against risk limits before execution.
 * Implements position sizing, exposure limits, and circuit breakers.
 */

import { config } from '../config/index.js';
import { db } from '../db/client.js';
import type { TradePlan, RiskCheckResult, PortfolioState, MarketInfo } from './types.js';

// Keywords that trigger "do not trade" rules
const BLACKLISTED_KEYWORDS = ['death', 'violence', 'assassination', 'terrorist'];

interface TradeRow {
  size_usd: number;
  market_id: string;
  realized_pnl: number | null;
  status: string;
}

/**
 * Get current portfolio state from database
 */
export function getPortfolioState(): PortfolioState {
  // Get today's P&L
  const today = new Date().toISOString().split('T')[0];
  const todayTrades = db.all<TradeRow>(
    `SELECT size_usd, realized_pnl FROM trades
     WHERE status = 'closed' AND exit_timestamp >= ?`,
    [today]
  );

  const totalPnl = todayTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
  const dailyPnlPct = totalPnl / config.risk.totalBankrollUsd;

  // Count consecutive losses
  const recentTrades = db.all<TradeRow>(
    `SELECT realized_pnl FROM trades
     WHERE status = 'closed'
     ORDER BY exit_timestamp DESC
     LIMIT 10`
  );

  let consecutiveLosses = 0;
  for (const trade of recentTrades) {
    if ((trade.realized_pnl || 0) < 0) {
      consecutiveLosses++;
    } else {
      break;
    }
  }

  // Get open positions
  const openPositions = db.all<TradeRow>(
    `SELECT market_id, size_usd FROM trades WHERE status = 'open'`
  );

  const totalOpen = openPositions.reduce((sum, t) => sum + t.size_usd, 0);
  const openByMarket = new Map<string, number>();
  for (const pos of openPositions) {
    const current = openByMarket.get(pos.market_id) || 0;
    openByMarket.set(pos.market_id, current + pos.size_usd);
  }

  return {
    dailyPnlPct,
    consecutiveLosses,
    totalOpenPositionsUsd: totalOpen,
    openPositionsByMarket: openByMarket,
  };
}

/**
 * Check if a trade passes all risk rules
 */
export function checkTradeRisk(
  plan: TradePlan,
  market: MarketInfo,
  portfolio?: PortfolioState
): RiskCheckResult {
  const riskConfig = config.risk;
  const state = portfolio || getPortfolioState();

  // 1. Check blacklisted keywords
  const questionLower = market.question.toLowerCase();
  for (const keyword of BLACKLISTED_KEYWORDS) {
    if (questionLower.includes(keyword)) {
      return {
        allowed: false,
        reason: `Question contains blacklisted keyword: ${keyword}`,
        adjustedSizeUsd: null,
      };
    }
  }

  // 2. Check minimum liquidity
  if (market.liquidity < riskConfig.minMarketLiquidityUsd) {
    return {
      allowed: false,
      reason: `Liquidity $${market.liquidity.toFixed(0)} below minimum $${riskConfig.minMarketLiquidityUsd}`,
      adjustedSizeUsd: null,
    };
  }

  // 3. Check time to resolution
  if (market.endDateIso) {
    const hoursToRes =
      (new Date(market.endDateIso).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursToRes < riskConfig.minHoursToResolution) {
      return {
        allowed: false,
        reason: `Only ${hoursToRes.toFixed(0)}h to resolution, minimum is ${riskConfig.minHoursToResolution}h`,
        adjustedSizeUsd: null,
      };
    }
  }

  // 4. Check daily loss limit (circuit breaker)
  if (state.dailyPnlPct < -riskConfig.dailyLossLimitPct) {
    return {
      allowed: false,
      reason: `Daily loss limit hit: ${(state.dailyPnlPct * 100).toFixed(1)}%`,
      adjustedSizeUsd: null,
    };
  }

  // 5. Check consecutive losses (circuit breaker)
  if (state.consecutiveLosses >= riskConfig.consecutiveLossLimit) {
    return {
      allowed: false,
      reason: `${state.consecutiveLosses} consecutive losses, limit is ${riskConfig.consecutiveLossLimit}`,
      adjustedSizeUsd: null,
    };
  }

  // 6. Check total exposure
  const maxExposure = riskConfig.totalBankrollUsd * riskConfig.maxTotalExposurePct;
  if (state.totalOpenPositionsUsd >= maxExposure) {
    return {
      allowed: false,
      reason: `Total exposure $${state.totalOpenPositionsUsd.toFixed(0)} at limit $${maxExposure.toFixed(0)}`,
      adjustedSizeUsd: null,
    };
  }

  // 7. Calculate allowed size with all constraints
  let allowedSize = plan.entrySizeUsd;

  // Max by percentage of bankroll
  const maxByPct = riskConfig.totalBankrollUsd * riskConfig.maxPositionPct;

  // Max by absolute limit
  const maxByUsd = riskConfig.maxPositionUsd;

  // Max by book impact (don't consume more than X% of liquidity)
  const maxByLiquidity = market.liquidity * riskConfig.maxBookImpactPct;

  // Max by remaining exposure room
  const maxByExposure = maxExposure - state.totalOpenPositionsUsd;

  // Take the minimum
  allowedSize = Math.min(
    allowedSize,
    maxByPct,
    maxByUsd,
    maxByLiquidity,
    maxByExposure
  );

  // Minimum viable trade size
  const MIN_TRADE_SIZE = 10;
  if (allowedSize < MIN_TRADE_SIZE) {
    return {
      allowed: false,
      reason: `Position size $${allowedSize.toFixed(2)} too small after risk adjustments`,
      adjustedSizeUsd: null,
    };
  }

  return {
    allowed: true,
    reason: null,
    adjustedSizeUsd: allowedSize,
  };
}

/**
 * Calculate Kelly-inspired position sizing
 */
export function calculateKellySize(
  winProbability: number,
  winAmount: number,
  lossAmount: number,
  bankroll: number,
  kellyFraction = 0.25 // Quarter Kelly for safety
): number {
  // Kelly formula: f* = (p * b - q) / b
  // where p = win prob, q = 1 - p, b = win/loss ratio
  const p = winProbability;
  const q = 1 - p;
  const b = winAmount / lossAmount;

  const kellyPct = (p * b - q) / b;

  // Apply fraction and ensure non-negative
  const adjustedPct = Math.max(0, kellyPct * kellyFraction);

  return bankroll * adjustedPct;
}
