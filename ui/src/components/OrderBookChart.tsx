interface OrderLevel {
  price: string;
  size: string;
}

interface Props {
  bids: OrderLevel[];
  asks: OrderLevel[];
}

export function OrderBookChart({ bids, asks }: Props) {
  // Parse and sort
  const parsedBids = bids
    .map((b) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }))
    .sort((a, b) => b.price - a.price);

  const parsedAsks = asks
    .map((a) => ({ price: parseFloat(a.price), size: parseFloat(a.size) }))
    .sort((a, b) => a.price - b.price);

  // Calculate cumulative sizes
  let bidCumulative = 0;
  const bidsWithCumulative = parsedBids.map((b) => {
    bidCumulative += b.size;
    return { ...b, cumulative: bidCumulative };
  });

  let askCumulative = 0;
  const asksWithCumulative = parsedAsks.map((a) => {
    askCumulative += a.size;
    return { ...a, cumulative: askCumulative };
  });

  const maxCumulative = Math.max(
    bidsWithCumulative[bidsWithCumulative.length - 1]?.cumulative || 0,
    asksWithCumulative[asksWithCumulative.length - 1]?.cumulative || 0
  );

  // Show top 5 levels
  const topBids = bidsWithCumulative.slice(0, 5);
  const topAsks = asksWithCumulative.slice(0, 5);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Bids (Buy orders) */}
      <div>
        <div className="text-xs text-gray-400 mb-2 flex justify-between">
          <span>Bids</span>
          <span>Size</span>
        </div>
        <div className="space-y-1">
          {topBids.map((bid, i) => (
            <div key={i} className="relative">
              <div
                className="absolute inset-0 bg-emerald-900/50 rounded"
                style={{
                  width: `${(bid.cumulative / maxCumulative) * 100}%`,
                }}
              />
              <div className="relative flex justify-between px-2 py-1 text-sm">
                <span className="text-emerald-400 font-mono">
                  {(bid.price * 100).toFixed(1)}¢
                </span>
                <span className="text-gray-300 font-mono">
                  {bid.size.toFixed(0)}
                </span>
              </div>
            </div>
          ))}
          {topBids.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-2">
              No bids
            </div>
          )}
        </div>
      </div>

      {/* Asks (Sell orders) */}
      <div>
        <div className="text-xs text-gray-400 mb-2 flex justify-between">
          <span>Asks</span>
          <span>Size</span>
        </div>
        <div className="space-y-1">
          {topAsks.map((ask, i) => (
            <div key={i} className="relative">
              <div
                className="absolute inset-0 bg-red-900/50 rounded"
                style={{
                  width: `${(ask.cumulative / maxCumulative) * 100}%`,
                }}
              />
              <div className="relative flex justify-between px-2 py-1 text-sm">
                <span className="text-red-400 font-mono">
                  {(ask.price * 100).toFixed(1)}¢
                </span>
                <span className="text-gray-300 font-mono">
                  {ask.size.toFixed(0)}
                </span>
              </div>
            </div>
          ))}
          {topAsks.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-2">
              No asks
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
