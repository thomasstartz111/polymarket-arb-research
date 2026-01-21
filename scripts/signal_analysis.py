#!/usr/bin/env python3
"""
Analyze signal data and generate summary statistics for the README.
"""

import sqlite3
import pandas as pd
import json
import os

DB_PATH = os.environ.get('DB_PATH', '../polymarket-scanner/data/polymarket.db')

def main():
    conn = sqlite3.connect(DB_PATH)

    # Overall stats
    overview = pd.read_sql_query("""
    SELECT
        'market_snapshots' as table_name, COUNT(*) as count FROM market_snapshots
    UNION ALL SELECT 'signals', COUNT(*) FROM signals
    UNION ALL SELECT 'markets', COUNT(*) FROM markets
    UNION ALL SELECT 'trades', COUNT(*) FROM trades
    """, conn)

    print('=== DATA OVERVIEW ===')
    for _, row in overview.iterrows():
        print(f'{row["table_name"]}: {row["count"]:,}')

    # Time range
    time_range = pd.read_sql_query("""
    SELECT
        MIN(timestamp) as first_snapshot,
        MAX(timestamp) as last_snapshot,
        ROUND((julianday(MAX(timestamp)) - julianday(MIN(timestamp))) * 24, 1) as hours
    FROM market_snapshots
    """, conn).iloc[0]

    print(f'\nTime range: {time_range["first_snapshot"][:19]} to {time_range["last_snapshot"][:19]}')
    print(f'Duration: {time_range["hours"]} hours ({time_range["hours"]/24:.1f} days)')

    # Signal breakdown by type
    signals = pd.read_sql_query("""
    SELECT
        signal_type,
        COUNT(*) as count,
        ROUND(AVG(score), 3) as avg_score,
        ROUND(AVG(edge_estimate), 2) as avg_edge,
        ROUND(AVG(composite_score), 3) as avg_composite
    FROM signals
    GROUP BY signal_type
    ORDER BY count DESC
    """, conn)

    print('\n=== SIGNALS BY TYPE ===')
    print(signals.to_string(index=False))

    # Tradability analysis (spread < 5%)
    # Parse features_json to check spread
    all_signals = pd.read_sql_query("""
    SELECT signal_type, features_json, score, edge_estimate
    FROM signals
    """, conn)

    def get_spread(features_json):
        try:
            features = json.loads(features_json)
            return features.get('spread', 1.0)  # Default to 100% spread if missing
        except:
            return 1.0

    all_signals['spread'] = all_signals['features_json'].apply(get_spread)
    all_signals['tradeable'] = all_signals['spread'] < 0.05

    tradeable_by_type = all_signals.groupby('signal_type').agg({
        'tradeable': ['sum', 'mean']
    }).round(3)
    tradeable_by_type.columns = ['tradeable_count', 'tradeable_pct']

    print('\n=== TRADABILITY (spread < 5%) ===')
    for signal_type in ['complement', 'anchoring', 'low_attention', 'deadline']:
        if signal_type in tradeable_by_type.index:
            row = tradeable_by_type.loc[signal_type]
            print(f'{signal_type}: {int(row["tradeable_count"])} tradeable ({row["tradeable_pct"]*100:.1f}%)')
        else:
            print(f'{signal_type}: 0 signals detected')

    # Complement arbitrage specifically
    complement_count = len(all_signals[all_signals['signal_type'] == 'complement'])
    print(f'\n=== COMPLEMENT ARBITRAGE ===')
    print(f'Total opportunities found: {complement_count}')
    if complement_count > 0:
        complement = all_signals[all_signals['signal_type'] == 'complement']
        print(f'Average edge: {complement["edge_estimate"].mean():.2f} cents')
        print(f'Tradeable (spread < 5%): {complement["tradeable"].sum()}')

    # Market efficiency check
    efficiency = pd.read_sql_query("""
    SELECT
        AVG(1.0 - (price_yes + price_no)) * 100 as avg_gap_cents,
        MIN(1.0 - (price_yes + price_no)) * 100 as min_gap_cents,
        MAX(1.0 - (price_yes + price_no)) * 100 as max_gap_cents,
        SUM(CASE WHEN (1.0 - (price_yes + price_no)) * 100 < 2 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as pct_efficient
    FROM market_snapshots
    WHERE price_yes > 0 AND price_no > 0
    """, conn).iloc[0]

    print('\n=== MARKET EFFICIENCY ===')
    print(f'Average gap from $1.00: {efficiency["avg_gap_cents"]:.3f} cents')
    print(f'Gap range: {efficiency["min_gap_cents"]:.3f} to {efficiency["max_gap_cents"]:.3f} cents')
    print(f'% of snapshots with gap < 2c (fee): {efficiency["pct_efficient"]:.1f}%')

    conn.close()

    # Output markdown table for README
    print('\n=== MARKDOWN TABLE FOR README ===')
    print('| Signal Type | Count | Tradeable (spread <5%) |')
    print('|-------------|-------|------------------------|')
    for signal_type in ['complement', 'anchoring', 'low_attention', 'deadline']:
        if signal_type in tradeable_by_type.index:
            total = len(all_signals[all_signals['signal_type'] == signal_type])
            tradeable = int(tradeable_by_type.loc[signal_type, 'tradeable_count'])
            pct = tradeable_by_type.loc[signal_type, 'tradeable_pct'] * 100
            print(f'| {signal_type.replace("_", " ").title()} | {total:,} | {tradeable} ({pct:.0f}%) |')
        else:
            print(f'| {signal_type.replace("_", " ").title()} | 0 | - |')

if __name__ == '__main__':
    main()
