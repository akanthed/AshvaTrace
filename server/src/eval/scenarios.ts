import type { Sample } from '../utils/synthetic';

// Scripted fault scenarios with a KNOWN root cause. The eval harness feeds
// each one through the real tool executor, retrieval and grounding code, so
// accuracy is measured against ground truth rather than judged by an AI.
export interface Scenario {
  id: string;
  machineId: string;
  description: string;
  // The true cause as a pattern: a hypothesis "matches" if its title matches.
  expectedCause: RegExp;
  // Generators over progress t in [0,1] across the window.
  power: (t: number) => number; // deviation % vs expected
  vibration: (t: number) => number; // mm/s
  cycleTime: (t: number) => number; // seconds
}

const SAMPLES = 240;
const EXPECTED_KW = 18;

export function buildSeries(s: Scenario): Sample[] {
  const start = Date.parse('2026-10-01T06:00:00Z');
  return Array.from({ length: SAMPLES }, (_, i) => {
    const t = i / (SAMPLES - 1);
    // Small deterministic ripple so the data is not perfectly smooth.
    const ripple = Math.sin(i * 1.7) * 0.15;
    return {
      timestamp: new Date(start + i * 12000).toISOString(),
      expected: EXPECTED_KW,
      actual: Math.round(EXPECTED_KW * (1 + (s.power(t) + ripple) / 100) * 100) / 100,
      vibration: Math.round((s.vibration(t) + ripple * 0.1) * 100) / 100,
      cycleTime: Math.round((s.cycleTime(t) + ripple) * 10) / 10,
    };
  });
}

export function currentSignals(series: Sample[]): { devPct: number; signals: Record<string, number> } {
  const last = series[series.length - 1];
  const devPct = Math.round(((last.actual - last.expected) / last.expected) * 1000) / 10;
  return {
    devPct,
    signals: {
      powerDevPct: devPct,
      vibration: last.vibration,
      cycleTime: last.cycleTime,
      actualPower: last.actual,
      expectedPower: last.expected,
    },
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'tool-wear',
    machineId: 'CNC-01',
    description: 'Power drifts up steadily, vibration climbs, cycle time slows — dull cutting tool',
    expectedCause: /tool|insert|cutting|edge/i,
    power: (t) => 1 + 9 * t,
    vibration: (t) => 2 + 2.6 * t,
    cycleTime: (t) => 96 + 14 * t,
  },
  {
    id: 'spindle-bearing',
    machineId: 'CNC-02',
    description: 'High, rising vibration with moderate power rise and slowing cycles — spindle bearing wear',
    expectedCause: /bearing|spindle/i,
    power: (t) => 1 + 6 * t,
    vibration: (t) => 3 + 4 * t,
    cycleTime: (t) => 95 + 6 * t,
  },
  {
    id: 'calibration-drift',
    machineId: 'LATHE-01',
    description: 'Power offset with flat vibration and flat cycle time — calibration or load change, not wear',
    expectedCause: /calibrat|load|sensor|baseline|setting/i,
    power: (t) => 1 + 6.5 * Math.min(1, t * 4),
    vibration: () => 1.8,
    cycleTime: () => 98,
  },
  {
    id: 'tool-change-transient',
    machineId: 'PRS-01',
    description: 'Brief early vibration spike has settled; a small steady power offset remains — per SOP-101/102 a calibration or load change, not wear',
    expectedCause: /calibrat|load|tool.?change|transient|offset/i,
    power: (t) => (t < 0.3 ? 3.5 : 3.2),
    vibration: (t) => (t > 0.15 && t < 0.25 ? 4.8 : 1.9),
    cycleTime: () => 97,
  },
];
