#!/usr/bin/env python3
"""
Generate a chart showing Yes + No prices converging to ~1.0 for a high-volume market.
Demonstrates that arbitrage opportunities are quickly closed.
"""

import sqlite3
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import os

DB_PATH = os.environ.get('DB_PATH', '../polymarket-scanner/data/polymarket.db')
OUTPUT_PATH = 'docs/images/price-convergence.png'

def main():
    conn = sqlite3.connect(DB_PATH)

    # First find a high-volume market with good data
    market_query = """
    SELECT
        m.id,
        m.question,
        COUNT(s.id) as snapshots,
        AVG(s.volume_24h) as avg_volume
    FROM markets m
    JOIN market_snapshots s ON m.id = s.market_id
    WHERE s.price_yes > 0.05 AND s.price_yes < 0.95
    GROUP BY m.id
    HAVING snapshots > 1000
    ORDER BY avg_volume DESC
    LIMIT 1
    """

    market = pd.read_sql_query(market_query, conn).iloc[0]
    market_id = market['id']
    question = market['question'][:80] + '...' if len(market['question']) > 80 else market['question']

    print(f'Using market: {question}')
    print(f'Market ID: {market_id}')

    # Get price data for this market
    price_query = """
    SELECT
        timestamp,
        price_yes,
        price_no,
        price_yes + price_no as total,
        spread
    FROM market_snapshots
    WHERE market_id = ?
    ORDER BY timestamp
    """

    df = pd.read_sql_query(price_query, conn, params=[market_id])
    conn.close()

    df['timestamp'] = pd.to_datetime(df['timestamp'])

    # Create visualization
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), gridspec_kw={'height_ratios': [2, 1]})
    fig.patch.set_facecolor('#1a1a1a')

    # Top: Individual prices
    ax1.set_facecolor('#1a1a1a')
    ax1.plot(df['timestamp'], df['price_yes'] * 100, color='#10b981',
             linewidth=1.5, label='Yes Price', alpha=0.8)
    ax1.plot(df['timestamp'], df['price_no'] * 100, color='#ef4444',
             linewidth=1.5, label='No Price', alpha=0.8)
    ax1.axhline(y=50, color='#6b7280', linestyle='--', alpha=0.3)

    ax1.set_ylabel('Price (cents)', color='white', fontsize=12)
    ax1.set_title(f'Price Movement: {question}',
                  color='white', fontsize=14, fontweight='bold', pad=10)
    ax1.tick_params(colors='white')
    ax1.legend(loc='upper right', facecolor='#2d2d2d', edgecolor='#4a5568', labelcolor='white')
    ax1.spines['bottom'].set_color('#4a5568')
    ax1.spines['left'].set_color('#4a5568')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.set_ylim(0, 100)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d %H:%M'))

    # Bottom: Sum (Yes + No) showing it stays near 1.0
    ax2.set_facecolor('#1a1a1a')
    ax2.fill_between(df['timestamp'], 98, df['total'] * 100,
                     where=(df['total'] * 100 < 98), color='#ef4444', alpha=0.3)
    ax2.plot(df['timestamp'], df['total'] * 100, color='#3b82f6',
             linewidth=1.5, label='Yes + No')
    ax2.axhline(y=100, color='#6b7280', linestyle='--', alpha=0.5, label='$1.00')
    ax2.axhline(y=98, color='#ef4444', linestyle='--', alpha=0.5, label='$0.98 (fee threshold)')

    ax2.set_ylabel('Total Price (cents)', color='white', fontsize=12)
    ax2.set_xlabel('Time (UTC)', color='white', fontsize=12)
    ax2.tick_params(colors='white')
    ax2.legend(loc='lower right', facecolor='#2d2d2d', edgecolor='#4a5568', labelcolor='white')
    ax2.spines['bottom'].set_color('#4a5568')
    ax2.spines['left'].set_color('#4a5568')
    ax2.spines['top'].set_visible(False)
    ax2.spines['right'].set_visible(False)
    ax2.set_ylim(96, 102)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d %H:%M'))

    plt.tight_layout()

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    plt.savefig(OUTPUT_PATH, dpi=150, facecolor='#1a1a1a', bbox_inches='tight')
    print(f'Saved: {OUTPUT_PATH}')

    # Stats
    print(f'\n--- Price Convergence Stats ---')
    print(f'Snapshots: {len(df)}')
    print(f'Avg total: {df["total"].mean() * 100:.2f} cents')
    print(f'Std dev: {df["total"].std() * 100:.3f} cents')
    print(f'Min total: {df["total"].min() * 100:.2f} cents')
    print(f'Max total: {df["total"].max() * 100:.2f} cents')
    print(f'% below $0.98: {(df["total"] < 0.98).sum() / len(df) * 100:.2f}%')

if __name__ == '__main__':
    main()
