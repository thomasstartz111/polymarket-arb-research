import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config/index.js';
import { buildAuthHeaders, hasCredentials, type PolymarketCredentials } from './auth.js';
import type {
  PolymarketMarket,
  OrderBook,
  MarketTrade,
  BookDepth,
  OrderBookLevel,
} from './types.js';

/**
 * Polymarket CLOB API Client
 * Handles all communication with Polymarket's Central Limit Order Book API
 */
export class PolymarketClient {
  private http: AxiosInstance;
  private maxRetries = 3;
  private retryDelayMs = 1000;
  private credentials: PolymarketCredentials | null = null;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || config.polymarketBaseUrl;
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    // Load credentials from config if available
    if (hasCredentials(config.polymarketAuth)) {
      this.credentials = config.polymarketAuth;
      console.log('Polymarket API credentials loaded');
    } else {
      console.warn('Polymarket API credentials not configured - authenticated endpoints will fail');
    }
  }

  /**
   * Check if authenticated requests are available
   */
  hasAuth(): boolean {
    return this.credentials !== null;
  }

  /**
   * Sleep helper for retries
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build the full request path with query params for signature
   */
  private buildPathWithParams(url: string, params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) {
      return url;
    }
    const queryString = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return queryString ? `${url}?${queryString}` : url;
  }

  /**
   * Make a request with retry logic
   */
  private async requestWithRetry<T>(
    method: 'get' | 'post',
    url: string,
    params?: Record<string, unknown>,
    authenticated = false
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Build request config
        const requestConfig: Record<string, unknown> = {
          method,
          url,
          params: method === 'get' ? params : undefined,
          data: method === 'post' ? params : undefined,
        };

        // Add auth headers if needed
        if (authenticated && this.credentials) {
          const pathWithParams = method === 'get'
            ? this.buildPathWithParams(url, params)
            : url;
          const body = method === 'post' && params ? JSON.stringify(params) : undefined;

          const authHeaders = buildAuthHeaders(
            this.credentials,
            method,
            pathWithParams,
            body
          );
          requestConfig.headers = authHeaders;
        }

        const response = await this.http.request<T>(requestConfig);
        return response.data;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on 4xx errors (client errors)
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          if (axiosError.response?.status && axiosError.response.status >= 400 && axiosError.response.status < 500) {
            throw error;
          }
        }

        // Exponential backoff
        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
          console.warn(`Request failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Fetch all markets (with optional filters)
   */
  async getMarkets(params?: {
    next_cursor?: string;
    limit?: number;
    active?: boolean;
    closed?: boolean;
    archived?: boolean;
  }): Promise<{ data: PolymarketMarket[]; next_cursor?: string }> {
    // The API returns paginated results
    const response = await this.requestWithRetry<{
      data?: PolymarketMarket[];
      next_cursor?: string;
    }>('get', '/markets', {
      limit: params?.limit || 100,
      active: params?.active,
      closed: params?.closed,
      archived: params?.archived,
      next_cursor: params?.next_cursor,
    });

    return {
      data: response.data || [],
      next_cursor: response.next_cursor,
    };
  }

  /**
   * Fetch all active markets (handles pagination)
   */
  async getAllActiveMarkets(): Promise<PolymarketMarket[]> {
    const allMarkets: PolymarketMarket[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.getMarkets({
        active: true,
        closed: false,
        limit: 100,
        next_cursor: cursor,
      });

      allMarkets.push(...response.data);
      cursor = response.next_cursor;

      // Safety limit to prevent infinite loops
      if (allMarkets.length > 5000) {
        console.warn('Hit safety limit of 5000 markets');
        break;
      }
    } while (cursor);

    return allMarkets;
  }

  /**
   * Fetch single market by condition_id
   */
  async getMarket(conditionId: string): Promise<PolymarketMarket | null> {
    try {
      const response = await this.requestWithRetry<PolymarketMarket>(
        'get',
        `/markets/${conditionId}`
      );
      return response;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetch order book for a token
   */
  async getOrderBook(tokenId: string): Promise<OrderBook | null> {
    try {
      const response = await this.requestWithRetry<OrderBook>('get', '/book', {
        token_id: tokenId,
      });
      return response;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetch recent trades for a token (requires authentication)
   */
  async getTrades(
    tokenId: string,
    limit = 100
  ): Promise<MarketTrade[]> {
    if (!this.credentials) {
      // Skip silently if no auth - trades are optional for basic scanning
      return [];
    }

    try {
      const response = await this.requestWithRetry<MarketTrade[] | { data: MarketTrade[] }>(
        'get',
        '/trades',
        {
          asset_id: tokenId,
          limit,
        },
        true // authenticated
      );
      // Handle both array and object response formats
      return Array.isArray(response) ? response : response.data || [];
    } catch (error) {
      console.warn(`Failed to fetch trades for ${tokenId}:`, error);
      return [];
    }
  }

  /**
   * Calculate midpoint price from order book
   */
  getMidpointPrice(book: OrderBook): number | null {
    if (!book.bids.length || !book.asks.length) {
      return null;
    }
    const bestBid = parseFloat(book.bids[0].price);
    const bestAsk = parseFloat(book.asks[0].price);
    return (bestBid + bestAsk) / 2;
  }

  /**
   * Calculate book depth (total size within X% of midpoint)
   */
  calculateBookDepth(book: OrderBook, pctFromMid = 0.05): BookDepth {
    if (!book.bids.length || !book.asks.length) {
      return { bidDepth: 0, askDepth: 0, midpoint: null, spread: 0 };
    }

    const bestBid = parseFloat(book.bids[0].price);
    const bestAsk = parseFloat(book.asks[0].price);
    const mid = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;

    const bidThreshold = mid * (1 - pctFromMid);
    const askThreshold = mid * (1 + pctFromMid);

    const bidDepth = book.bids
      .filter((b) => parseFloat(b.price) >= bidThreshold)
      .reduce((sum, b) => sum + parseFloat(b.size) * parseFloat(b.price), 0);

    const askDepth = book.asks
      .filter((a) => parseFloat(a.price) <= askThreshold)
      .reduce((sum, a) => sum + parseFloat(a.size) * parseFloat(a.price), 0);

    return { bidDepth, askDepth, midpoint: mid, spread };
  }

  /**
   * Calculate 24h volume from recent trades
   */
  calculate24hVolume(trades: MarketTrade[]): { volume: number; count: number } {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const recentTrades = trades.filter((t) => {
      const tradeTime = new Date(t.timestamp).getTime();
      return tradeTime > oneDayAgo;
    });

    const volume = recentTrades.reduce((sum, t) => {
      return sum + parseFloat(t.size) * parseFloat(t.price);
    }, 0);

    return { volume, count: recentTrades.length };
  }

  /**
   * Parse order book levels to our internal format
   */
  parseOrderBookLevels(levels: OrderBookLevel[]): Array<{ price: number; size: number }> {
    return levels.map((level) => ({
      price: parseFloat(level.price),
      size: parseFloat(level.size),
    }));
  }
}

// Singleton instance
export const polymarketClient = new PolymarketClient();
