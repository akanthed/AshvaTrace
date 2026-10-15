import { useMemo, useState } from 'react';
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
  Brush,
} from 'recharts';
import type { Sample } from '../types';
import { formatTimestamp } from '../utils/time';

interface Props {
  series: Sample[];
  machineId: string;
  warningThreshold?: number;
  criticalThreshold?: number;
}

export function TrendsChart({ series, warningThreshold, criticalThreshold }: Props) {
  const data = useMemo(
    () =>
      series.map((s) => ({
        time: s.timestamp,
        actual: s.actual,
        expected: s.expected,
        deviation: ((s.actual - s.expected) / s.expected) * 100,
      })),
    [series]
  );

  // Brush gives drag-to-zoom on the time axis: dragging its handles narrows
  // the main chart to that range, the "Reset zoom" button below snaps it
  // back out to the full series.
  const [brushRange, setBrushRange] = useState<{ startIndex?: number; endIndex?: number }>({});
  const isZoomed = brushRange.startIndex !== undefined || brushRange.endIndex !== undefined;

  return (
    <div className="chart-container" style={{ width: '100%', height: '100%', minHeight: 280, position: 'relative' }}>
      {isZoomed && (
        <button
          className="tab"
          style={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}
          onClick={() => setBrushRange({ startIndex: 0, endIndex: data.length - 1 })}
        >
          Reset zoom
        </button>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
          <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            stroke="#8b949e"
            fontSize={11}
            tickCount={10}
            tickFormatter={formatTimestamp}
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
            labelFormatter={(label) => formatTimestamp(typeof label === 'string' ? label : String(label))}
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
          <Brush
            dataKey="time"
            height={24}
            stroke="#f39200"
            fill="#161b22"
            travellerWidth={8}
            tickFormatter={formatTimestamp}
            startIndex={brushRange.startIndex}
            endIndex={brushRange.endIndex}
            onChange={(range) => setBrushRange(range)}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
