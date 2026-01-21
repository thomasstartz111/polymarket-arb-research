import { useState, useEffect } from 'react';
import { SignalQueue } from './components/SignalQueue';
import { MarketDrilldown } from './components/MarketDrilldown';
import { TradeList } from './components/TradeList';
import { Stats } from './components/Stats';

type View = 'signals' | 'trades';

export default function App() {
  const [view, setView] = useState<View>('signals');
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshKey((k) => k + 1);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <h1 className="text-xl font-bold text-emerald-400">
            📊 Polymarket Scanner
          </h1>
          <nav className="flex gap-2">
            <button
              onClick={() => setView('signals')}
              className={`px-4 py-2 rounded-lg transition ${
                view === 'signals'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Signals
            </button>
            <button
              onClick={() => setView('trades')}
              className={`px-4 py-2 rounded-lg transition ${
                view === 'trades'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Trades
            </button>
          </nav>
        </div>
      </header>

      {/* Stats Bar */}
      <Stats key={`stats-${refreshKey}`} />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-12 gap-4">
          {/* Left Panel: List View */}
          <div className="col-span-5">
            {view === 'signals' && (
              <SignalQueue
                key={`signals-${refreshKey}`}
                onSelectMarket={setSelectedMarket}
                selectedMarket={selectedMarket}
              />
            )}
            {view === 'trades' && <TradeList key={`trades-${refreshKey}`} />}
          </div>

          {/* Right Panel: Drilldown */}
          <div className="col-span-7">
            {selectedMarket ? (
              <MarketDrilldown
                key={`market-${selectedMarket}-${refreshKey}`}
                marketId={selectedMarket}
                onTradeExecuted={() => setRefreshKey((k) => k + 1)}
              />
            ) : (
              <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-500">
                <p className="text-lg mb-2">Select a market to view details</p>
                <p className="text-sm">
                  Click on a signal from the queue to see order book, history,
                  and trading options
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
