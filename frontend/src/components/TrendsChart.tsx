import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { Sample } from '../types';

interface Props {
  series: Sample[];
  machineId: string;
  warningThreshold?: number;
  criticalThreshold?: number;
}

export function TrendsChart({ series, warningThreshold, criticalThreshold }: Props) {
  const data = series.map((s) => ({
    time: s.timestamp,
    actual: s.actual,
    expected: s.expected,
    deviation: ((s.actual - s.expected) / s.expected) * 100,
  }));

  return (
    <div className="chart-container" style={{ width: '100%', height: '100%', minHeight: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
          <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            stroke="#8b949e"
            fontSize={11}
            tickCount={10}
          />
          <YAxis
            stroke="#8b949e"
            fontSize={11}
            domain={['auto', 'auto']}
            label={{ value: 'kW', angle: -90, position: 'insideLeft', fill: '#8b949e' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#8b949e' }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#f39200"
            strokeWidth={2}
            dot={false}
            name="Actual"
          />
          <Line
            type="monotone"
            dataKey="expected"
            stroke="#58a6ff"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            name="Expected"
          />
          {warningThreshold && (
            <ReferenceLine
              y={warningThreshold}
              stroke="#d29922"
              strokeDasharray="3 3"
              label={{ value: 'Warning', fill: '#d29922', fontSize: 10, position: 'right' }}
            />
          )}
          {criticalThreshold && (
            <ReferenceLine
              y={criticalThreshold}
              stroke="#f85149"
              strokeDasharray="3 3"
              label={{ value: 'Critical', fill: '#f85149', fontSize: 10, position: 'right' }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
