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

// Keep the chart responsive: live samples are appended forever, so only the
// most recent points are drawn.
const MAX_POINTS = 600;

export function TrendsChart({ series, warningThreshold, criticalThreshold }: Props) {
  const data = useMemo(
    () =>
      series.slice(-MAX_POINTS).map((s) => ({
        time: s.timestamp,
        actual: s.actual,
        expected: s.expected,
        deviation: s.expected ? ((s.actual - s.expected) / s.expected) * 100 : 0,
      })),
    [series]
  );

  // Brush gives drag-to-zoom on the time axis. It is left uncontrolled (a
  // controlled brush that sets state in onChange re-renders the chart on
  // every drag tick and can loop); "Reset zoom" remounts it to snap back out.
  const [brushKey, setBrushKey] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);

  return (
    <div className="chart-container" style={{ width: '100%', height: '100%', minHeight: 280, position: 'relative' }}>
      {isZoomed && (
        <button
          className="tab"
          style={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}
          onClick={() => {
            setBrushKey((k) => k + 1);
            setIsZoomed(false);
          }}
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
            isAnimationActive={false}
            name="Actual"
          />
          <Line
            type="monotone"
            dataKey="expected"
            stroke="#58a6ff"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            isAnimationActive={false}
            name="Expected"
          />
          {warningThreshold !== undefined && (
            <ReferenceLine
              y={warningThreshold}
              stroke="#d29922"
              strokeDasharray="3 3"
              label={{ value: 'Warning', fill: '#d29922', fontSize: 10, position: 'right' }}
            />
          )}
          {criticalThreshold !== undefined && (
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
            key={brushKey}
            onChange={(range) =>
              setIsZoomed(
                range.startIndex !== undefined &&
                  range.endIndex !== undefined &&
                  (range.startIndex > 0 || range.endIndex < data.length - 1)
              )
            }
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
