// Deterministic synthetic data generator (seeded PRNG)
// Same seed → same data, reproducible across reloads

export interface Sample {
  timestamp: string;
  actual: number;
  expected: number;
  vibration: number;
  cycleTime: number;
}

// Asymmetric deviation-% thresholds: upper bounds fire on actual > expected,
// lower bounds fire on actual < expected. Alarm (critical) always wins over
// warning when both are crossed.
export interface Thresholds {
  upperAlarm: number;
  upperWarning: number;
  lowerWarning: number;
  lowerAlarm: number;
}

export interface MachineInfo {
  id: string;
  name: string;
  type: string;
  thresholds: Thresholds;
  series: Sample[];
}

export interface ShiftData {
  machines: MachineInfo[];
  N: number;
  DT: number;
}

// Seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller for Gaussian
function gauss(rng: () => number, mean: number, std: number): number {
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

const N = 2400; // 2400 samples
const DT = 12; // 12 seconds per sample
const SEED = 4207;

const MACHINE_DEFS = [
  { id: 'CNC-01', name: 'CNC Mill 01', type: 'milling', base: 45, warning: 5, critical: 10 },
  { id: 'CNC-02', name: 'CNC Mill 02', type: 'milling', base: 42, warning: 5, critical: 10 },
  { id: 'CNC-03', name: 'CNC Mill 03', type: 'milling', base: 48, warning: 5, critical: 10 },
  { id: 'CNC-04', name: 'CNC Lathe 04', type: 'turning', base: 38, warning: 5, critical: 10 },
  { id: 'GRD-01', name: 'Grinder 01', type: 'grinding', base: 30, warning: 5, critical: 10 },
  { id: 'PRS-01', name: 'Press 01', type: 'stamping', base: 55, warning: 5, critical: 10 },
];

// CNC-03 has a scripted incident: drift starts at sample 960
const DRIFT_START = 960;
const DRIFT_RATE = 0.008; // 0.8% per sample
const TOOL_CHANGE = 650; // Tool change event at sample 650

interface MachineDef {
  id: string;
  name: string;
  type: string;
  base: number;
  warning: number;
  critical: number;
}

export function generateMachineSeries(def: MachineDef, rng: () => number = mulberry32(SEED)): Sample[] {
  const series: Sample[] = [];

  for (let i = 0; i < N; i++) {
    const hour = 6 + (i * DT) / 3600;
    const timestamp = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;

    // Base expected power (slight diurnal variation)
    const expected = def.base + Math.sin((i / N) * Math.PI * 2) * 2;

    // Actual power: expected + noise
    let actual = gauss(rng, expected, 0.8);

    // CNC-03: tool change event at 650 (brief spike)
    if (def.id === 'CNC-03' && i >= TOOL_CHANGE && i < TOOL_CHANGE + 20) {
      actual += 3 + rng() * 2;
    }

    // CNC-03: drift starts at 960
    if (def.id === 'CNC-03' && i >= DRIFT_START) {
      const driftSamples = i - DRIFT_START;
      actual += driftSamples * DRIFT_RATE * def.base;
    }

    // Vibration (mm/s)
    let vibration = gauss(rng, 2.0, 0.3);
    if (def.id === 'CNC-03' && i >= DRIFT_START) {
      vibration += (i - DRIFT_START) * 0.003;
    }

    // Cycle time (seconds)
    let cycleTime = gauss(rng, 90, 5);
    if (def.id === 'CNC-03' && i >= DRIFT_START) {
      cycleTime += (i - DRIFT_START) * 0.02;
    }

    series.push({
      timestamp,
      actual: Math.round(actual * 100) / 100,
      expected: Math.round(expected * 100) / 100,
      vibration: Math.round(vibration * 100) / 100,
      cycleTime: Math.round(cycleTime * 10) / 10,
    });
  }

  return series;
}

// A def's seed warning/critical become symmetric upper/lower bounds by
// default — the user can later make them asymmetric via the Threshold tab.
export function defaultThresholds(warning: number, critical: number): Thresholds {
  return { upperAlarm: critical, upperWarning: warning, lowerWarning: -warning, lowerAlarm: -critical };
}

export function generateShiftData(): { data: ShiftData; machines: MachineInfo[] } {
  const rng = mulberry32(SEED);
  const machines: MachineInfo[] = [];

  for (const def of MACHINE_DEFS) {
    machines.push({
      id: def.id,
      name: def.name,
      type: def.type,
      thresholds: defaultThresholds(def.warning, def.critical),
      series: generateMachineSeries(def, rng),
    });
  }

  return {
    data: { machines, N, DT },
    machines: machines.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      thresholds: m.thresholds,
      series: [], // Don't include full series in machine list
    })),
  };
}
