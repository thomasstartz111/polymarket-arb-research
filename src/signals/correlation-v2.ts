/**
 * Correlation Signal V2 - Semantic Analysis
 *
 * Uses embeddings to find related markets, then applies
 * logical analysis to detect mispriced correlations.
 */

import { v4 as uuid } from 'uuid';
import { db } from '../db/client.js';
import { clusterMarkets, type MarketCluster } from './embeddings.js';
import type { SignalStrength } from './types.js';

export interface CorrelationSignalV2 {
  signalId: string;
  signalType: 'correlation';
  marketId: string;
  relatedMarketId: string;
  isTriggered: boolean;
  strength: SignalStrength;
  score: number;
  direction: 'buy_yes' | 'buy_no' | null;
  edgeCents: number;
  // V2-specific
  clusterType: 'range_bracket' | 'cumulative' | 'semantic_similar';
  clusterSize: number;
  avgSimilarity: number;
  marketAPrice: number;
  marketBPrice: number;
  divergence: number;
  divergencePct: number;
  rationale: string;
}

interface MarketData {
  id: string;
  question: string;
  priceYes: number;
}

/**
 * Extract numeric threshold from question
 */
function extractThreshold(question: string): number | null {
  // Match patterns like "250,000" or "10%" or "750,000 or more"
  const matches = question.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(%|or more|or less|at least)?/gi);
  if (!matches || matches.length === 0) return null;

  // Get the first significant number
  const match = matches[0];
  const numStr = match.replace(/,/g, '').replace(/%.*|or.*|at.*/gi, '');
  const num = parseFloat(numStr);

  // If it's a percentage, keep it small
  if (match.includes('%')) return num;

  return num;
}

/**
 * Detect cluster type based on question patterns
 */
function detectClusterType(
  markets: MarketData[]
): 'range_bracket' | 'cumulative' | 'semantic_similar' {
  const questions = markets.map((m) => m.question.toLowerCase());

  // Check for range brackets (e.g., "250,000-500,000")
  const hasRanges = questions.some((q) => /\d+(?:,\d+)*\s*[-–]\s*\d+(?:,\d+)*/.test(q));
  if (hasRanges) return 'range_bracket';

  // Check for cumulative thresholds (e.g., "at least X", "X or more")
  const hasCumulative = questions.some((q) =>
    /at least|or more|or less|fewer than|more than/i.test(q)
  );
  if (hasCumulative) return 'cumulative';

  return 'semantic_similar';
}

/**
 * Analyze a cluster of range bracket markets
 * These should sum to ~100% (mutually exclusive)
 */
function analyzeRangeBrackets(markets: MarketData[]): CorrelationSignalV2[] {
  const signals: CorrelationSignalV2[] = [];
  const totalProb = markets.reduce((sum, m) => sum + m.priceYes, 0);
  const deviation = Math.abs(totalProb - 1.0);

  if (deviation > 0.05) {
    // Brackets don't sum to 100% - find the outliers
    const avgProb = totalProb / markets.length;

    for (const market of markets) {
      const marketDeviation = Math.abs(market.priceYes - avgProb);
      if (marketDeviation > 0.03) {
        const isOverpriced = market.priceYes > avgProb;
        signals.push({
          signalId: `corr-v2-${uuid().slice(0, 8)}`,
          signalType: 'correlation',
          marketId: market.id,
          relatedMarketId: markets[0].id === market.id ? markets[1]?.id || '' : markets[0].id,
          isTriggered: true,
          strength: deviation > 0.10 ? 'strong' : 'weak',
          score: Math.min(1, deviation * 5),
          direction: isOverpriced ? 'buy_no' : 'buy_yes',
          edgeCents: Math.round(marketDeviation * 100),
          clusterType: 'range_bracket',
          clusterSize: markets.length,
          avgSimilarity: 0.9,
          marketAPrice: market.priceYes,
          marketBPrice: avgProb,
          divergence: deviation,
          divergencePct: deviation * 100,
          rationale: `Range brackets sum to ${(totalProb * 100).toFixed(1)}% (should be ~100%). ` +
            `"${market.question.slice(0, 50)}..." at ${(market.priceYes * 100).toFixed(1)}% ` +
            `is ${isOverpriced ? 'overpriced' : 'underpriced'} vs expected.`,
        });
      }
    }
  }

  return signals;
}

/**
 * Analyze cumulative threshold markets
 * "at least 5%" should have HIGHER probability than "at least 10%"
 */
function analyzeCumulativeThresholds(markets: MarketData[]): CorrelationSignalV2[] {
  const signals: CorrelationSignalV2[] = [];

  // Extract thresholds and sort
  const withThresholds = markets
    .map((m) => ({
      ...m,
      threshold: extractThreshold(m.question),
    }))
    .filter((m) => m.threshold !== null)
    .sort((a, b) => (a.threshold || 0) - (b.threshold || 0));

  if (withThresholds.length < 2) return signals;

  // Determine if it's "at least" style (lower threshold = higher prob)
  // or "at most" style (lower threshold = lower prob)
  const isAtLeastStyle = markets.some((m) =>
    /at least|or more|more than/i.test(m.question)
  );

  // Check for monotonicity violations
  for (let i = 0; i < withThresholds.length - 1; i++) {
    const lower = withThresholds[i];
    const higher = withThresholds[i + 1];

    const expectedLowerHasHigherProb = isAtLeastStyle;
    const actualLowerHasHigherProb = lower.priceYes >= higher.priceYes;

    if (expectedLowerHasHigherProb !== actualLowerHasHigherProb) {
      const divergence = Math.abs(lower.priceYes - higher.priceYes);

      signals.push({
        signalId: `corr-v2-${uuid().slice(0, 8)}`,
        signalType: 'correlation',
        marketId: lower.id,
        relatedMarketId: higher.id,
        isTriggered: true,
        strength: divergence > 0.05 ? 'strong' : 'weak',
        score: Math.min(1, divergence * 10),
        direction: expectedLowerHasHigherProb ? 'buy_yes' : 'buy_no',
        edgeCents: Math.round(divergence * 100),
        clusterType: 'cumulative',
        clusterSize: markets.length,
        avgSimilarity: 0.9,
        marketAPrice: lower.priceYes,
        marketBPrice: higher.priceYes,
        divergence,
        divergencePct: divergence * 100,
        rationale: `Monotonicity violation: "${lower.question.slice(0, 40)}..." ` +
          `(threshold: ${lower.threshold}) at ${(lower.priceYes * 100).toFixed(2)}% ` +
          `vs "${higher.question.slice(0, 40)}..." ` +
          `(threshold: ${higher.threshold}) at ${(higher.priceYes * 100).toFixed(2)}%. ` +
          `${isAtLeastStyle ? 'Lower threshold should have higher' : 'Higher threshold should have higher'} probability.`,
      });
    }
  }

  return signals;
}

/**
 * Analyze semantically similar markets for general mispricing
 */
function analyzeSemanticSimilar(
  markets: MarketData[],
  avgSimilarity: number
): CorrelationSignalV2[] {
  const signals: CorrelationSignalV2[] = [];

  // For highly similar markets, check if prices are wildly different
  if (avgSimilarity > 0.90 && markets.length >= 2) {
    const prices = markets.map((m) => m.priceYes);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const spread = maxPrice - minPrice;

    if (spread > 0.15) {
      // Very similar questions with very different prices
      const maxMarket = markets.find((m) => m.priceYes === maxPrice)!;
      const minMarket = markets.find((m) => m.priceYes === minPrice)!;

      signals.push({
        signalId: `corr-v2-${uuid().slice(0, 8)}`,
        signalType: 'correlation',
        marketId: maxMarket.id,
        relatedMarketId: minMarket.id,
        isTriggered: true,
        strength: spread > 0.25 ? 'strong' : 'weak',
        score: Math.min(1, spread * 3),
        direction: null, // Need manual analysis
        edgeCents: Math.round(spread * 100),
        clusterType: 'semantic_similar',
        clusterSize: markets.length,
        avgSimilarity,
        marketAPrice: maxPrice,
        marketBPrice: minPrice,
        divergence: spread,
        divergencePct: spread * 100,
        rationale: `Similar markets with large price spread: ` +
          `"${maxMarket.question.slice(0, 40)}..." at ${(maxPrice * 100).toFixed(1)}% ` +
          `vs "${minMarket.question.slice(0, 40)}..." at ${(minPrice * 100).toFixed(1)}%. ` +
          `Similarity: ${(avgSimilarity * 100).toFixed(0)}%, Spread: ${(spread * 100).toFixed(1)}%`,
      });
    }
  }

  return signals;
}

/**
 * Analyze a single cluster of related markets
 */
function analyzeCluster(cluster: MarketCluster): CorrelationSignalV2[] {
  const { markets, avgSimilarity } = cluster;

  if (markets.length < 2) return [];

  const clusterType = detectClusterType(markets);
  console.log(
    `📊 Analyzing ${clusterType} cluster with ${markets.length} markets ` +
      `(similarity: ${(avgSimilarity * 100).toFixed(0)}%)`
  );

  switch (clusterType) {
    case 'range_bracket':
      return analyzeRangeBrackets(markets);
    case 'cumulative':
      return analyzeCumulativeThresholds(markets);
    case 'semantic_similar':
      return analyzeSemanticSimilar(markets, avgSimilarity);
    default:
      return [];
  }
}

/**
 * Main entry point: scan all markets for correlation signals
 */
export async function scanForCorrelationSignalsV2(): Promise<CorrelationSignalV2[]> {
  console.log('🔍 Scanning for correlation signals (V2 - semantic)...');

  // Get all active markets with recent prices
  const markets = db.all<{
    id: string;
    question: string;
    price_yes: number;
  }>(`
    SELECT DISTINCT m.id, m.question, s.price_yes
    FROM markets m
    JOIN market_snapshots s ON m.id = s.market_id
    WHERE m.active = 1
      AND s.timestamp = (SELECT MAX(timestamp) FROM market_snapshots WHERE market_id = m.id)
    LIMIT 1000
  `);

  if (markets.length === 0) {
    console.log('No markets found');
    return [];
  }

  console.log(`Found ${markets.length} active markets`);

  // Convert to expected format
  const marketData: MarketData[] = markets.map((m) => ({
    id: m.id,
    question: m.question,
    priceYes: m.price_yes,
  }));

  // Cluster markets by semantic similarity
  const clusters = await clusterMarkets(marketData, 0.75);

  // Analyze each cluster
  const signals: CorrelationSignalV2[] = [];
  for (const cluster of clusters) {
    const clusterSignals = analyzeCluster(cluster);
    signals.push(...clusterSignals);
  }

  // Sort by divergence
  signals.sort((a, b) => b.divergence - a.divergence);

  console.log(`✅ Found ${signals.length} correlation signals`);
  return signals;
}

/**
 * Generate rationale for display
 */
export function generateCorrelationRationaleV2(signal: CorrelationSignalV2): string {
  return signal.rationale;
}
