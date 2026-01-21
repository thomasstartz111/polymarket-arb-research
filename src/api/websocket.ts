/**
 * Polymarket WebSocket Client
 *
 * Real-time order book updates via WebSocket.
 * Much faster than polling (milliseconds vs 30 seconds).
 *
 * Polymarket WebSocket API:
 * - wss://ws-subscriptions-clob.polymarket.com/ws/market
 * - Subscribe to specific token IDs for order book updates
 *
 * Message types from Polymarket:
 * - book: Full orderbook snapshot on subscribe or after trades
 * - price_change: When orders are placed/cancelled
 * - last_trade_price: When trades execute
 * - best_bid_ask: Best bid/ask changes (feature-flagged)
 * - tick_size_change: Tick size changes at extreme prices
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface BookUpdate {
  asset_id: string;
  market: string;
  timestamp: number;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

export interface PriceChangeUpdate {
  asset_id: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  best_bid: string;
  best_ask: string;
}

export interface PriceUpdate {
  tokenId: string;
  marketId: string;
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  timestamp: Date;
  eventType: string; // Track which event triggered this
}

type WebSocketEvents = {
  price: [PriceUpdate];
  book: [BookUpdate];
  priceChange: [{ market: string; changes: PriceChangeUpdate[] }];
  trade: [{ market: string; asset_id: string; price: string; size: string }];
  connected: [];
  disconnected: [];
  error: [Error];
  rawMessage: [unknown]; // For debugging - emit all raw messages
};

export class PolymarketWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private url = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
  private subscribedTokens: Set<string> = new Set();
  private pendingSubscriptions: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isConnecting = false;
  private isReady = false;

  constructor() {
    super();
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          console.log('🔌 WebSocket connected to Polymarket');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.isReady = true;

          // Start ping interval to keep connection alive
          this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.ping();
            }
          }, 30000);

          // Send initial subscription with all pending tokens (max 500 per Polymarket limit)
          const tokensToSubscribe = Array.from(this.subscribedTokens).slice(0, 500);
          if (tokensToSubscribe.length > 0) {
            this.sendBatchSubscribe(tokensToSubscribe);
          }

          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (e) {
            // Ignore parse errors for non-JSON messages
          }
        });

        this.ws.on('close', () => {
          console.log('🔌 WebSocket disconnected');
          this.isConnecting = false;
          this.cleanup();
          this.emit('disconnected');
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
          console.error('🔌 WebSocket error:', error.message);
          this.isConnecting = false;
          this.emit('error', error);
          reject(error);
        });

        this.ws.on('pong', () => {
          // Connection is alive
        });

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Subscribe to order book updates for a token
   */
  subscribe(tokenId: string): void {
    this.subscribedTokens.add(tokenId);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(tokenId);
    }
  }

  /**
   * Subscribe to multiple tokens
   */
  subscribeMany(tokenIds: string[]): void {
    for (const tokenId of tokenIds) {
      this.subscribe(tokenId);
    }
  }

  /**
   * Unsubscribe from a token
   */
  unsubscribe(tokenId: string): void {
    this.subscribedTokens.delete(tokenId);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        assets_ids: [tokenId],
        operation: 'unsubscribe',
      }));
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.maxReconnectAttempts = 0; // Prevent reconnect
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log('🔌 WebSocket client stopped');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get subscribed token count
   */
  getSubscriptionCount(): number {
    return this.subscribedTokens.size;
  }

  // Private methods

  private sendSubscribe(tokenId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Polymarket format: assets_ids for token subscriptions
      this.ws.send(JSON.stringify({
        assets_ids: [tokenId],
        type: 'MARKET',
      }));
    }
  }

  private sendBatchSubscribe(tokenIds: string[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Polymarket allows up to 500 assets per connection
      console.log(`🔌 Subscribing to ${tokenIds.length} tokens...`);
      this.ws.send(JSON.stringify({
        assets_ids: tokenIds,
        type: 'MARKET',
      }));
    }
  }

  private messageCount = 0;
  private messageTypeCounts: Record<string, number> = {};
  private debugMode = true; // Enable verbose logging for debugging

  /**
   * Enable/disable debug logging
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  private handleMessage(message: any): void {
    this.messageCount++;

    // Handle array messages - these are initial book snapshots on subscription
    // Polymarket sends an array of book updates when you first subscribe
    if (Array.isArray(message)) {
      this.messageTypeCounts['book_array'] = (this.messageTypeCounts['book_array'] || 0) + 1;

      if (this.debugMode && this.messageCount <= 5) {
        console.log(`🔌 WS Message #${this.messageCount} [book_array]: ${message.length} books`);
      }

      // Process each book in the array
      for (const book of message) {
        if (book && (book.bids || book.asks)) {
          this.handleBookMessage(book);
        }
      }
      return;
    }

    // Track message type counts
    const eventType = message.event_type || message.type || 'unknown';
    this.messageTypeCounts[eventType] = (this.messageTypeCounts[eventType] || 0) + 1;

    // Emit raw message for debugging
    this.emit('rawMessage', message);

    // Debug logging
    if (this.debugMode) {
      if (this.messageCount <= 10) {
        console.log(`🔌 WS Message #${this.messageCount} [${eventType}]:`, JSON.stringify(message).slice(0, 300));
      } else if (this.messageCount % 50 === 0) {
        console.log(`🔌 WS stats: ${this.messageCount} msgs | Types:`, this.messageTypeCounts);
      }
    }

    // Handle different message types from Polymarket
    switch (eventType) {
      case 'book':
        this.handleBookMessage(message);
        break;

      case 'price_change':
        this.handlePriceChangeMessage(message);
        break;

      case 'last_trade_price':
        this.handleTradeMessage(message);
        break;

      case 'best_bid_ask':
        this.handleBestBidAskMessage(message);
        break;

      case 'tick_size_change':
        // Log but don't process - these are rare
        if (this.debugMode) {
          console.log('🔌 Tick size change:', message);
        }
        break;

      default:
        // Log unknown message types for debugging
        if (this.debugMode && this.messageCount <= 20) {
          console.log(`🔌 Unknown message type [${eventType}]:`, JSON.stringify(message).slice(0, 200));
        }
    }
  }

  /**
   * Handle full orderbook snapshot
   */
  private handleBookMessage(message: any): void {
    const bookUpdate: BookUpdate = {
      asset_id: message.asset_id || message.market,
      market: message.market || message.asset_id,
      timestamp: parseInt(message.timestamp) || Date.now(),
      bids: message.bids || [],
      asks: message.asks || [],
    };

    this.emit('book', bookUpdate);

    // Also emit a simplified price update
    const bestBid = bookUpdate.bids.length > 0
      ? parseFloat(bookUpdate.bids[0].price)
      : null;
    const bestAsk = bookUpdate.asks.length > 0
      ? parseFloat(bookUpdate.asks[0].price)
      : null;

    const priceUpdate: PriceUpdate = {
      tokenId: bookUpdate.asset_id,
      marketId: bookUpdate.market,
      bestBid,
      bestAsk,
      mid: bestBid !== null && bestAsk !== null
        ? (bestBid + bestAsk) / 2
        : null,
      timestamp: new Date(bookUpdate.timestamp),
      eventType: 'book',
    };

    this.emit('price', priceUpdate);
  }

  /**
   * Handle price change events (new orders placed/cancelled)
   * This is the most common event type for price updates
   */
  private handlePriceChangeMessage(message: any): void {
    const market = message.market;
    const changes: PriceChangeUpdate[] = message.price_changes || [];

    if (changes.length === 0) return;

    this.emit('priceChange', { market, changes });

    // Emit price update for each asset with best bid/ask
    for (const change of changes) {
      const priceUpdate: PriceUpdate = {
        tokenId: change.asset_id,
        marketId: market,
        bestBid: change.best_bid ? parseFloat(change.best_bid) : null,
        bestAsk: change.best_ask ? parseFloat(change.best_ask) : null,
        mid: null,
        timestamp: new Date(parseInt(message.timestamp) || Date.now()),
        eventType: 'price_change',
      };

      // Calculate mid if both available
      if (priceUpdate.bestBid !== null && priceUpdate.bestAsk !== null) {
        priceUpdate.mid = (priceUpdate.bestBid + priceUpdate.bestAsk) / 2;
      }

      this.emit('price', priceUpdate);
    }
  }

  /**
   * Handle trade execution events
   */
  private handleTradeMessage(message: any): void {
    const market = message.market;
    // last_trade_price messages may have different structure
    const assetId = message.asset_id;
    const price = message.price;
    const size = message.size;

    if (assetId && price) {
      this.emit('trade', { market, asset_id: assetId, price, size: size || '0' });
    }
  }

  /**
   * Handle best bid/ask change events (feature-flagged)
   */
  private handleBestBidAskMessage(message: any): void {
    // Similar structure to price_change but specifically for best bid/ask
    const market = message.market;
    const assetId = message.asset_id;
    const bestBid = message.best_bid ? parseFloat(message.best_bid) : null;
    const bestAsk = message.best_ask ? parseFloat(message.best_ask) : null;

    if (assetId) {
      const priceUpdate: PriceUpdate = {
        tokenId: assetId,
        marketId: market,
        bestBid,
        bestAsk,
        mid: bestBid !== null && bestAsk !== null
          ? (bestBid + bestAsk) / 2
          : null,
        timestamp: new Date(parseInt(message.timestamp) || Date.now()),
        eventType: 'best_bid_ask',
      };

      this.emit('price', priceUpdate);
    }
  }

  /**
   * Get message statistics
   */
  getStats(): { messageCount: number; typeCounts: Record<string, number> } {
    return {
      messageCount: this.messageCount,
      typeCounts: { ...this.messageTypeCounts },
    };
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('🔌 Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`🔌 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
  }

  // Type-safe event methods
  override on<K extends keyof WebSocketEvents>(
    event: K,
    listener: (...args: WebSocketEvents[K]) => void
  ): this {
    return super.on(event, listener as (...args: any[]) => void);
  }

  override emit<K extends keyof WebSocketEvents>(
    event: K,
    ...args: WebSocketEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
export const polymarketWS = new PolymarketWebSocket();
