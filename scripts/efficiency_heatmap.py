#!/usr/bin/env python3
"""
Generate a heatmap showing market efficiency over time.
Shows how close Yes + No prices sum to 1.0 across all markets.
"""

import sqlite3
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import os

# Use the original DB path (has the data)
DB_PATH = os.environ.get('DB_PATH', '../polymarket-scanner/data/polymarket.db')
OUTPUT_PATH = 'docs/images/efficiency-heatmap.png'

def main():
    conn = sqlite3.connect(DB_PATH)

    # Query: Get hourly average of (1 - (price_yes + price_no))
    # which represents the "gap" from perfect efficiency
    query = """
    SELECT
        strftime('%Y-%m-%d %H:00', timestamp) as hour,
        AVG(1.0 - (price_yes + price_no)) * 100 as avg_gap_cents,
        COUNT(*) as samples,
        MIN(1.0 - (price_yes + price_no)) * 100 as min_gap,
        MAX(1.0 - (price_yes + price_no)) * 100 as max_gap
    FROM market_snapshots
    WHERE price_yes > 0 AND price_no > 0
    GROUP BY hour
    ORDER BY hour
    """

    df = pd.read_sql_query(query, conn)
    conn.close()

    df['hour'] = pd.to_datetime(df['hour'])

    # Create the visualization
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), gridspec_kw={'height_ratios': [2, 1]})
    fig.patch.set_facecolor('#1a1a1a')

    # Top: Gap over time
    ax1.set_facecolor('#1a1a1a')
    ax1.fill_between(df['hour'], df['min_gap'], df['max_gap'],
                     color='#4a5568', alpha=0.3, label='Min-Max Range')
    ax1.plot(df['hour'], df['avg_gap_cents'], color='#10b981',
             linewidth=2, label='Avg Gap (cents)')
    ax1.axhline(y=2, color='#ef4444', linestyle='--', alpha=0.5, label='2% Fee Line')
    ax1.axhline(y=0, color='#6b7280', linestyle='-', alpha=0.3)

    ax1.set_ylabel('Gap from $1.00 (cents)', color='white', fontsize=12)
    ax1.set_title('Market Efficiency: Yes + No Price Gap Over Time',
                  color='white', fontsize=14, fontweight='bold')
    ax1.tick_params(colors='white')
    ax1.legend(loc='upper right', facecolor='#2d2d2d', edgecolor='#4a5568', labelcolor='white')
    ax1.spines['bottom'].set_color('#4a5568')
    ax1.spines['left'].set_color('#4a5568')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d %H:%M'))
    ax1.set_ylim(-1, 5)

    # Bottom: Sample count (shows data density)
    ax2.set_facecolor('#1a1a1a')
    ax2.bar(df['hour'], df['samples'], width=0.03, color='#3b82f6', alpha=0.7)
    ax2.set_ylabel('Snapshots/Hour', color='white', fontsize=12)
    ax2.set_xlabel('Time (UTC)', color='white', fontsize=12)
    ax2.tick_params(colors='white')
    ax2.spines['bottom'].set_color('#4a5568')
    ax2.spines['left'].set_color('#4a5568')
    ax2.spines['top'].set_visible(False)
    ax2.spines['right'].set_visible(False)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d %H:%M'))

    plt.tight_layout()

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    plt.savefig(OUTPUT_PATH, dpi=150, facecolor='#1a1a1a', bbox_inches='tight')
    print(f'Saved: {OUTPUT_PATH}')

    # Print summary stats
    print(f'\n--- Efficiency Summary ---')
    print(f'Total hours: {len(df)}')
    print(f'Avg gap: {df["avg_gap_cents"].mean():.3f} cents')
    print(f'Max gap observed: {df["max_gap"].max():.3f} cents')
    print(f'% of hours with gap < 2c (fee): {(df["avg_gap_cents"] < 2).sum() / len(df) * 100:.1f}%')

if __name__ == '__main__':
    main()
