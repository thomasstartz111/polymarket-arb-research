/**
 * Cross-Market Correlation Signal
 *
 * Detects when related markets diverge from their expected correlation.
 * Examples:
 * - "Trump wins" should correlate with "GOP wins presidency"
 * - State elections should somewhat correlate with national outcomes
 * - Related event markets (e.g., different time frames of same event)
 */

import { v4 as uuid } from 'uuid';
import { db } from '../db/client.js';
import type { SignalStrength } from './types.js';

export interface CorrelationSignal {
  signalId: string;
  signalType: 'correlation';
  marketId: string; // Primary market
  relatedMarketId: string; // Correlated market
  isTriggered: boolean;
  strength: SignalStrength;
  score: number;
  direction: 'buy_yes' | 'buy_no' | null;
  edgeCents: number;
  // Correlation-specific
  correlationType: 'subset' | 'related' | 'opposite' | 'time_variant';
  expectedRelation: string; // e.g., "A >= B" or "A + B <= 1"
  marketAPrice: number;
  marketBPrice: number;
  divergence: number;
  divergencePct: number;
  rationale: string;
}

interface MarketPair {
  marketA: { id: string; question: string; priceYes: number };
  marketB: { id: string; question: string; priceYes: number };
  correlationType: 'subset' | 'related' | 'opposite' | 'time_variant';
  expectedRelation: string;
}

// Patterns to detect related markets
const CORRELATION_PATTERNS = [
  // Subset relationships (if A then B, so P(A) <= P(B))
  {
    patternA: /will.+win.+(\d{4})/i,
    patternB: /will.+win.+nomination/i,
    type: 'subset' as const,
    relation: 'nominee price <= winner price makes no sense - check for arb',
  },
  // Time variants (same event, different timeframes)
  {
    patternA: /by (january|february|march|april|may|june|july|august|september|october|november|december)/i,
    patternB: /by (january|february|march|april|may|june|july|august|september|october|november|december)/i,
    type: 'time_variant' as const,
    relation: 'earlier deadline should have lower probability',
  },
  // Opposite outcomes (should sum to ~1 if exhaustive)
  {
    patternA: /will.+more than (\d+)/i,
    patternB: /will.+less than (\d+)/i,
    type: 'opposite' as const,
    relation: 'complementary outcomes should sum near 1',
  },
];

/**
 * Find potentially correlated market pairs from the database
 */
export function findCorrelatedPairs(): MarketPair[] {
  const pairs: MarketPair[] = [];

  // Get all active markets with recent prices
  const markets = db.all<{
    id: string;
    question: string;
    price_yes: number;
    category: string | null;
  }>(`
    SELECT DISTINCT m.id, m.question, s.price_yes, m.category
    FROM markets m
    JOIN market_snapshots s ON m.id = s.market_id
    WHERE m.active = 1
      AND s.timestamp = (SELECT MAX(timestamp) FROM market_snapshots WHERE market_id = m.id)
  `);

  // Group by category first (most likely to be related)
  const byCategory = new Map<string, typeof markets>();
  for (const m of markets) {
    const cat = m.category || 'uncategorized';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(m);
  }

  // Also group by question similarity for uncategorized markets
  // Extract key phrases to group related questions
  const byPhrase = new Map<string, typeof markets>();
  for (const m of markets) {
    // Extract key identifying phrase (first 40 chars minus numbers/percentages)
    const phrase = m.question
      .toLowerCase()
      .replace(/\d+%?/g, 'X')
      .replace(/at least|or more|or less|fewer than|more than/gi, '')
      .trim()
      .slice(0, 40);
    if (!byPhrase.has(phrase)) byPhrase.set(phrase, []);
    byPhrase.get(phrase)!.push(m);
  }

  // Add phrase-grouped markets to category groups
  for (const [phrase, phraseMarkets] of byPhrase) {
    if (phraseMarkets.length >= 2) {
      const key = `phrase:${phrase}`;
      byCategory.set(key, phraseMarkets);
    }
  }

  // Within each category, look for related pairs
  for (const [category, categoryMarkets] of byCategory) {
    if (categoryMarkets.length < 2) continue;

    // Check for RANGE brackets (e.g., "250,000-500,000") - these should sum to 1
    const rangePattern = /(\d+(?:,\d+)*)\s*[-–]\s*(\d+(?:,\d+)*)/;
    const rangeMarkets = categoryMarkets.filter(m => rangePattern.test(m.question));

    // Group range markets by their base question (everything except the numbers)
    const rangeGroups = new Map<string, typeof categoryMarkets>();
    for (const m of rangeMarkets) {
      const base = m.question.toLowerCase()
        .replace(/\d+(?:,\d+)*\s*[-–]\s*\d+(?:,\d+)*/g, 'RANGE')
        .replace(/less than \d+(?:,\d+)*/gi, 'RANGE')
        .replace(/\d+(?:,\d+)* or more/gi, 'RANGE')
        .trim()
        .slice(0, 50);
      if (!rangeGroups.has(base)) rangeGroups.set(base, []);
      rangeGroups.get(base)!.push(m);
    }

    // Check if range groups sum to approximately 1
    for (const [base, group] of rangeGroups) {
      if (group.length >= 2) {
        const totalProbability = group.reduce((sum, m) => sum + m.price_yes, 0);
        const deviation = Math.abs(totalProbability - 1.0);

        // If brackets don't sum to 1, there's a potential opportunity
        if (deviation > 0.03) { // 3% threshold
          // Find the most over/underpriced brackets
          const avgExpected = 1.0 / group.length;
          for (const market of group) {
            const marketDeviation = market.price_yes - avgExpected;
            if (Math.abs(marketDeviation) > 0.02) {
              // This bracket is mispriced relative to expected equal distribution
              // For a proper signal, we'd need more sophisticated analysis
            }
          }

          // Create pairs between adjacent brackets to check monotonicity
          const sorted = [...group].sort((a, b) => {
            const matchA = a.question.match(/(\d+(?:,\d+)*)/);
            const matchB = b.question.match(/(\d+(?:,\d+)*)/);
            const numA = parseInt(matchA?.[1]?.replace(/,/g, '') || '0');
            const numB = parseInt(matchB?.[1]?.replace(/,/g, '') || '0');
            return numA - numB;
          });

          // Log for debugging
          console.log(`📊 Range group "${base.slice(0, 40)}": ${group.length} markets, sum=${(totalProbability * 100).toFixed(1)}%`);
        }
      }
    }

    // Check for cumulative threshold patterns (bracket markets)
    const bracketPattern = /(\d+(?:,\d+)*%?)\s*(or more|or less|or fewer|\+|-|plus|minus|at least|fewer than|more than|less than)/i;
    const bracketMarkets = categoryMarkets.filter(m => bracketPattern.test(m.question));

    // Group bracket markets by their base question
    const bracketGroups = new Map<string, typeof categoryMarkets>();
    for (const m of bracketMarkets) {
      // Extract base question without the number - more aggressive normalization
      const base = m.question
        .toLowerCase()
        .replace(/\d+(?:\.\d+)?%?/g, 'X') // Replace all numbers
        .replace(/at least|or more|or less|fewer than|more than|less than/gi, 'THRESHOLD')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      if (!bracketGroups.has(base)) bracketGroups.set(base, []);
      bracketGroups.get(base)!.push(m);
    }

    // Debug log bracket groups
    for (const [base, group] of bracketGroups) {
      if (group.length >= 2) {
        console.log(`📊 Cumulative group "${base.slice(0, 40)}": ${group.length} markets`);
        for (const m of group) {
          console.log(`   - ${m.question.slice(0, 50)} @ ${(m.price_yes * 100).toFixed(2)}%`);
        }
      }
    }

    // Look for mispriced brackets (probabilities should be monotonic)
    for (const [base, group] of bracketGroups) {
      if (group.length >= 2) {
        // Sort by the number in the question
        const sorted = group.sort((a, b) => {
          const numA = parseInt(a.question.match(/(\d+(?:,\d+)*)/)?.[1]?.replace(/,/g, '') || '0');
          const numB = parseInt(b.question.match(/(\d+(?:,\d+)*)/)?.[1]?.replace(/,/g, '') || '0');
          return numA - numB;
        });

        // Check adjacent pairs for monotonicity violations
        for (let i = 0; i < sorted.length - 1; i++) {
          const marketA = sorted[i];
          const marketB = sorted[i + 1];

          // "X or more" should decrease as X increases
          // "X or less" should increase as X increases
          const isOrMore = /or more|\+|plus/i.test(marketA.question);

          pairs.push({
            marketA: { id: marketA.id, question: marketA.question, priceYes: marketA.price_yes },
            marketB: { id: marketB.id, question: marketB.question, priceYes: marketB.price_yes },
            correlationType: 'related',
            expectedRelation: isOrMore
              ? 'Lower threshold should have higher probability'
              : 'Higher threshold should have higher probability',
          });
        }
      }
    }

    // Look for exact opposite markets
    for (let i = 0; i < categoryMarkets.length; i++) {
      for (let j = i + 1; j < categoryMarkets.length; j++) {
        const a = categoryMarkets[i];
        const b = categoryMarkets[j];

        // Check if questions are opposites
        const aLower = a.question.toLowerCase();
        const bLower = b.question.toLowerCase();

        // Simple heuristic: same core question but one has "not" or negation
        if (
          (aLower.includes(' not ') && !bLower.includes(' not ') &&
           aLower.replace(' not ', ' ').includes(bLower.substring(0, 30))) ||
          (bLower.includes(' not ') && !aLower.includes(' not ') &&
           bLower.replace(' not ', ' ').includes(aLower.substring(0, 30)))
        ) {
          pairs.push({
            marketA: { id: a.id, question: a.question, priceYes: a.price_yes },
            marketB: { id: b.id, question: b.question, priceYes: b.price_yes },
            correlationType: 'opposite',
            expectedRelation: 'Opposite outcomes should sum near 1',
          });
        }
      }
    }
  }

  return pairs;
}

/**
 * Compute correlation signal for a market pair
 */
export function computeCorrelationSignal(pair: MarketPair): CorrelationSignal {
  const { marketA, marketB, correlationType, expectedRelation } = pair;

  let divergence = 0;
  let direction: 'buy_yes' | 'buy_no' | null = null;
  let triggered = false;
  let rationale = '';

  switch (correlationType) {
    case 'opposite': {
      // Opposite outcomes should sum to ~1
      const sum = marketA.priceYes + marketB.priceYes;
      divergence = Math.abs(sum - 1.0);

      if (divergence > 0.03) { // 3% threshold
        triggered = true;
        if (sum > 1.0) {
          // Overpriced overall - sell the higher one (buy no)
          direction = marketA.priceYes > marketB.priceYes ? 'buy_no' : 'buy_yes';
          rationale = `Opposite markets sum to ${(sum * 100).toFixed(1)}% (>${100}%). ` +
            `Combined they're overpriced by ${(divergence * 100).toFixed(1)}%.`;
        } else {
          // Underpriced - buy the underpriced one
          direction = marketA.priceYes < marketB.priceYes ? 'buy_yes' : 'buy_no';
          rationale = `Opposite markets sum to ${(sum * 100).toFixed(1)}% (<${100}%). ` +
            `Combined they're underpriced by ${(divergence * 100).toFixed(1)}%.`;
        }
      }
      break;
    }

    case 'related': {
      // For bracket markets, check monotonicity
      // "at least X" / "X or more" / "more than X": Lower threshold should have HIGHER probability
      // "at most X" / "X or less" / "fewer than X": Lower threshold should have LOWER probability
      const isAtLeastStyle = /or more|at least|more than|\+|plus/i.test(marketA.question);

      if (isAtLeastStyle) {
        // marketA is lower threshold, should have higher probability
        // e.g., "at least 5%" should be >= "at least 10%"
        if (marketA.priceYes < marketB.priceYes) {
          divergence = marketB.priceYes - marketA.priceYes;
          if (divergence > 0.002) { // 0.2% threshold for micro-arbs
            triggered = true;
            direction = 'buy_yes'; // Buy the underpriced lower threshold
            rationale = `Monotonicity violation: "${marketA.question.slice(0, 60)}..." at ${(marketA.priceYes * 100).toFixed(2)}% ` +
              `should be >= "${marketB.question.slice(0, 60)}..." at ${(marketB.priceYes * 100).toFixed(2)}%. ` +
              `Edge: ${(divergence * 100).toFixed(2)}%`;
          }
        }
      } else {
        // marketA is lower threshold "X or less", should have LOWER probability
        if (marketA.priceYes > marketB.priceYes) {
          divergence = marketA.priceYes - marketB.priceYes;
          if (divergence > 0.002) {
            triggered = true;
            direction = 'buy_no'; // Sell the overpriced lower threshold
            rationale = `Monotonicity violation: "${marketA.question.slice(0, 60)}..." at ${(marketA.priceYes * 100).toFixed(2)}% ` +
              `should be <= "${marketB.question.slice(0, 60)}..." at ${(marketB.priceYes * 100).toFixed(2)}%. ` +
              `Edge: ${(divergence * 100).toFixed(2)}%`;
          }
        }
      }
      break;
    }

    case 'subset': {
      // If A implies B, then P(A) <= P(B)
      if (marketA.priceYes > marketB.priceYes + 0.02) {
        divergence = marketA.priceYes - marketB.priceYes;
        triggered = true;
        direction = 'buy_no'; // Sell the subset (it's overpriced)
        rationale = `Subset violation: "${marketA.question.slice(0, 50)}..." implies "${marketB.question.slice(0, 50)}..." ` +
          `but is priced higher (${(marketA.priceYes * 100).toFixed(1)}% vs ${(marketB.priceYes * 100).toFixed(1)}%).`;
      }
      break;
    }

    case 'time_variant': {
      // Earlier deadline should have lower probability (less time for event to happen)
      // This requires parsing the dates which we'll simplify for now
      divergence = Math.abs(marketA.priceYes - marketB.priceYes);
      if (divergence > 0.05) {
        triggered = true;
        rationale = `Time-variant markets show ${(divergence * 100).toFixed(1)}% price difference. ` +
          `Check if probability relationship matches time relationship.`;
      }
      break;
    }
  }

  const score = Math.min(1.0, divergence * 10); // Scale divergence to 0-1
  const strength: SignalStrength = divergence > 0.05 ? 'strong' : 'weak';
  const edgeCents = Math.round(divergence * 100);

  return {
    signalId: `corr-${uuid().slice(0, 8)}`,
    signalType: 'correlation',
    marketId: marketA.id,
    relatedMarketId: marketB.id,
    isTriggered: triggered,
    strength,
    score,
    direction,
    edgeCents,
    correlationType,
    expectedRelation,
    marketAPrice: marketA.priceYes,
    marketBPrice: marketB.priceYes,
    divergence,
    divergencePct: divergence * 100,
    rationale: rationale || `No significant divergence detected (${(divergence * 100).toFixed(2)}%).`,
  };
}

/**
 * Generate human-readable rationale
 */
export function generateCorrelationRationale(signal: CorrelationSignal): string {
  return signal.rationale;
}

/**
 * Scan all markets for correlation signals
 */
export function scanForCorrelationSignals(): CorrelationSignal[] {
  const pairs = findCorrelatedPairs();
  const signals: CorrelationSignal[] = [];

  for (const pair of pairs) {
    const signal = computeCorrelationSignal(pair);
    if (signal.isTriggered) {
      signals.push(signal);
    }
  }

  // Sort by divergence (highest first)
  signals.sort((a, b) => b.divergence - a.divergence);

  return signals;
}
