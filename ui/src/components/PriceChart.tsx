import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import type { Snapshot } from '../types';

interface Props {
  data: Snapshot[];
}

export function PriceChart({ data }: Props) {
  // Reverse to show oldest first
  const chartData = [...data]
    .reverse()
    .map((d) => ({
      time: new Date(d.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      yes: d.price_yes * 100,
      no: d.price_no * 100,
      fullTime: d.timestamp,
    }));

  // Reduce data points if too many
  const maxPoints = 100;
  const step = Math.ceil(chartData.length / maxPoints);
  const reducedData =
    chartData.length > maxPoints
      ? chartData.filter((_, i) => i % step === 0)
      : chartData;

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={reducedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="time"
            tick={{ fill: '#9CA3AF', fontSize: 10 }}
            tickLine={{ stroke: '#4B5563' }}
            axisLine={{ stroke: '#4B5563' }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: '#9CA3AF', fontSize: 10 }}
            tickLine={{ stroke: '#4B5563' }}
            axisLine={{ stroke: '#4B5563' }}
            tickFormatter={(v) => `${v}¢`}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1F2937',
              border: '1px solid #374151',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#9CA3AF' }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)}¢`,
              name.toUpperCase(),
            ]}
          />
          <Line
            type="monotone"
            dataKey="yes"
            stroke="#10B981"
            strokeWidth={2}
            dot={false}
            name="yes"
          />
          <Line
            type="monotone"
            dataKey="no"
            stroke="#EF4444"
            strokeWidth={2}
            dot={false}
            name="no"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
