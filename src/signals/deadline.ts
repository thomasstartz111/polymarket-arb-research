/**
 * Deadline Pressure Signal
 *
 * Identifies overpriced Yes outcomes on markets that require
 * specific formal acts (legislation, executive orders, etc.) to resolve.
 * These markets often overestimate the probability of action occurring.
 */

import { config } from '../config/index.js';
import { getDayBucket } from '../db/client.js';
import type { DeadlineSignal, SignalStrength } from './types.js';

export interface DeadlineInput {
  marketId: string;
  priceYes: number;
  endDateIso: string;
  resolutionSource: string;
  question: string;
}

// Keywords indicating formal acts required for resolution
const FORMAL_ACT_KEYWORDS: Record<string, string[]> = {
  legislation: ['bill', 'pass', 'congress', 'senate', 'house', 'law', 'legislature', 'vote'],
  executive_order: ['executive order', 'president sign', 'white house announce', 'executive action'],
  announcement: ['announce', 'confirm', 'release', 'publish', 'declare'],
  appointment: ['appoint', 'nominate', 'confirm nomination'],
  court: ['court', 'ruling', 'decision', 'judge', 'verdict', 'supreme court'],
  regulatory: ['fda', 'sec', 'approval', 'regulate', 'agency'],
};

// Base rates for different types of formal acts
const BASE_RATES: Record<string, number> = {
  legislation: 0.15, // Bills rarely pass quickly
  executive_order: 0.35,
  announcement: 0.40,
  appointment: 0.25,
  court: 0.30,
  regulatory: 0.25,
  default: 0.30,
};

/**
 * Compute deadline signal for a market
 */
export function computeDeadlineSignal(input: DeadlineInput): DeadlineSignal {
  const { mispricingThreshold, minHours } = config.signals.deadline;

  // Calculate hours to resolution
  const endDate = new Date(input.endDateIso);
  const now = new Date();
  const hoursToResolution = Math.max(
    0,
    (endDate.getTime() - now.getTime()) / (1000 * 60 * 60)
  );

  // Parse resolution text for formal act indicators
  const combinedText = `${input.resolutionSource} ${input.question}`.toLowerCase();

  let requiresFormalAct = false;
  let formalActType: string | null = null;

  for (const [actType, keywords] of Object.entries(FORMAL_ACT_KEYWORDS)) {
    if (keywords.some((kw) => combinedText.includes(kw))) {
      requiresFormalAct = true;
      formalActType = actType;
      break;
    }
  }

  // Get base rate for this type of act
  let baseRateEstimate = BASE_RATES[formalActType || 'default'];

  // Adjust base rate based on time remaining
  if (hoursToResolution < 168) {
    // Less than 1 week
    baseRateEstimate *= 0.7; // Harder to pass something quickly
  } else if (hoursToResolution < 720) {
    // Less than 1 month
    baseRateEstimate *= 0.85;
  }

  const impliedProbability = input.priceYes;
  const mispricing = impliedProbability - baseRateEstimate;

  // Thresholds for weak/strong signals
  const strongThreshold = mispricingThreshold; // 0.15 (15 points)
  const weakThreshold = 0.08; // 8 points

  // Trigger conditions - now includes weak signals
  const meetsStrongCriteria =
    requiresFormalAct &&
    mispricing > strongThreshold &&
    hoursToResolution > minHours;

  const meetsWeakCriteria =
    requiresFormalAct &&
    mispricing > weakThreshold &&
    hoursToResolution > minHours;

  const isTriggered = meetsWeakCriteria;

  let direction: 'buy_no' | null = null;
  let edgeCents = 0;
  let strength: SignalStrength = 'weak';

  if (isTriggered) {
    direction = 'buy_no';
    edgeCents = mispricing * 100;
    strength = meetsStrongCriteria ? 'strong' : 'weak';
  }

  // Score based on mispricing magnitude
  let score = 0;
  if (meetsStrongCriteria) {
    // Strong: score 0.5-1.0
    score = 0.5 + Math.min(0.5, mispricing / 0.3);
  } else if (meetsWeakCriteria) {
    // Weak: score 0-0.5
    score = (mispricing - weakThreshold) / (strongThreshold - weakThreshold) * 0.5;
  }

  const rationaleDetail = requiresFormalAct
    ? `Market requires ${formalActType} to resolve Yes. ${hoursToResolution.toFixed(0)}h remain. ` +
      `Yes priced at ${(impliedProbability * 100).toFixed(0)}% vs estimated ${(baseRateEstimate * 100).toFixed(0)}% base rate.`
    : 'No formal act required for resolution.';

  return {
    signalId: `deadline:${input.marketId}:${getDayBucket()}`,
    signalType: 'deadline',
    marketId: input.marketId,
    isTriggered,
    strength,
    score,
    direction,
    edgeCents,
    hoursToResolution,
    requiresFormalAct,
    formalActType,
    impliedProbability,
    baseRateEstimate,
    rationaleDetail,
  };
}

/**
 * Generate human-readable rationale
 */
export function generateDeadlineRationale(signal: DeadlineSignal): string {
  return signal.rationaleDetail;
}
