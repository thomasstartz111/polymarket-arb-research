/**
 * Polymarket Gamma API Client
 *
 * The Gamma API provides market discovery for actually active markets.
 * Unlike the CLOB API which returns stale data, Gamma shows live markets
 * with order books enabled.
 *
 * We use Gamma for market discovery, then CLOB for order book data.
 */

import axios, { AxiosInstance } from 'axios';

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  description: string;
  endDate: string;
  endDateIso: string;
  startDate: string;
  category?: string;
  outcomes: string; // JSON array string like '["Yes", "No"]'
  outcomePrices: string; // JSON array string like '["0.55", "0.45"]'
  clobTokenIds: string; // JSON array string with token IDs
  active: boolean;
  closed: boolean;
  archived: boolean;
  enableOrderBook: boolean;
  acceptingOrders: boolean;
  volume24hr: number;
  liquidityClob: number;
  liquidity: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  resolutionSource: string;
}

export interface ParsedGammaMarket {
  conditionId: string;
  question: string;
  slug: string;
  description: string;
  endDateIso: string;
  category: string | null;
  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  acceptingOrders: boolean;
  yesTokenId: string;
  noTokenId: string;
  priceYes: number;
  priceNo: number;
  volume24h: number;
  liquidity: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  resolutionSource: string;
}

/**
 * Gamma API Client for market discovery
 */
export class GammaClient {
  private http: AxiosInstance;
  private baseUrl = 'https://gamma-api.polymarket.com';

  constructor() {
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /**
   * Fetch active markets from Gamma API
   */
  async getActiveMarkets(limit = 100, offset = 0): Promise<GammaMarket[]> {
    const response = await this.http.get<GammaMarket[]>('/markets', {
      params: {
        closed: false,
        limit,
        offset,
      },
    });
    return response.data;
  }

  /**
   * Fetch all active markets (handles pagination)
   */
  async getAllActiveMarkets(): Promise<ParsedGammaMarket[]> {
    const allMarkets: GammaMarket[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const batch = await this.getActiveMarkets(limit, offset);

      if (batch.length === 0) break;

      allMarkets.push(...batch);
      offset += batch.length;

      // Safety limit
      if (allMarkets.length > 5000) {
        console.warn('Hit safety limit of 5000 markets');
        break;
      }

      // If we got less than limit, we've reached the end
      if (batch.length < limit) break;
    }

    // Parse and filter to binary markets with order books
    return allMarkets
      .filter(m => m.enableOrderBook && m.acceptingOrders)
      .map(m => this.parseMarket(m))
      .filter((m): m is ParsedGammaMarket => m !== null);
  }

  /**
   * Parse Gamma market into our internal format
   */
  private parseMarket(market: GammaMarket): ParsedGammaMarket | null {
    try {
      // Parse outcomes
      const outcomes = JSON.parse(market.outcomes) as string[];
      if (outcomes.length !== 2 || !outcomes.includes('Yes') || !outcomes.includes('No')) {
        return null; // Skip non-binary markets
      }

      // Parse prices
      const prices = JSON.parse(market.outcomePrices) as string[];
      const yesIndex = outcomes.indexOf('Yes');
      const noIndex = outcomes.indexOf('No');

      // Parse token IDs
      const tokenIds = JSON.parse(market.clobTokenIds) as string[];
      if (tokenIds.length !== 2) {
        return null;
      }

      return {
        conditionId: market.conditionId,
        question: market.question,
        slug: market.slug,
        description: market.description,
        endDateIso: market.endDateIso,
        category: null, // Gamma doesn't return category directly
        active: market.active,
        closed: market.closed,
        enableOrderBook: market.enableOrderBook,
        acceptingOrders: market.acceptingOrders,
        yesTokenId: tokenIds[yesIndex],
        noTokenId: tokenIds[noIndex],
        priceYes: parseFloat(prices[yesIndex]),
        priceNo: parseFloat(prices[noIndex]),
        volume24h: market.volume24hr || 0,
        liquidity: market.liquidityClob || parseFloat(market.liquidity) || 0,
        bestBid: market.bestBid || 0,
        bestAsk: market.bestAsk || 0,
        spread: market.spread || 0,
        resolutionSource: market.resolutionSource || '',
      };
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const gammaClient = new GammaClient();
