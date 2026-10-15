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
  // Center of the deviation band (percent) this machine should stay in. The
  // live tick mean-reverts toward it so the machine holds its condition.
  targetDevPct?: number;
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

// Three demo machines, each pinned to a fixed condition for the whole shift:
//   CNC-01 → Normal   (deviation hovers near 0–2%, well under the 5% warning)
//   CNC-02 → Warning  (deviation hovers ~6–9%, above warning, under critical)
//   CNC-03 → Action   (deviation hovers ~12–18%, above the 10% critical)
//
// `targetDevPct` is the center of the band the machine's power deviation
// should sit in. The seeded series and the live tick both mean-revert toward
// it, so the values keep changing (realistic wobble) but the machine never
// leaves its condition — which is exactly what we want for a stable demo.
const MACHINE_DEFS = [
  {
    id: 'CNC-01', name: 'CNC Mill 01', type: 'milling', base: 45, warning: 5, critical: 10,
    cyclePeriods: 1, cyclePhase: 0, targetDevPct: 1.0,
  },
  {
    id: 'CNC-02', name: 'CNC Mill 02', type: 'milling', base: 42, warning: 5, critical: 10,
    cyclePeriods: 3, cyclePhase: 1.1, targetDevPct: 7.5,
  },
  {
    id: 'CNC-03', name: 'CNC Mill 03', type: 'milling', base: 48, warning: 5, critical: 10,
    cyclePeriods: 1, cyclePhase: 0, targetDevPct: 15.0,
  },
];

interface MachineDef {
  id: string;
  name: string;
  type: string;
  base: number;
  warning: number;
  critical: number;
  cyclePeriods?: number;
  cyclePhase?: number;
  // Center of the deviation band this machine should stay in (percent).
  targetDevPct?: number;
}

export function generateMachineSeries(def: MachineDef, rng: () => number = mulberry32(SEED)): Sample[] {
  const series: Sample[] = [];
  const cyclePeriods = def.cyclePeriods ?? 1;
  const cyclePhase = def.cyclePhase ?? 0;
  // Where this machine's power deviation should sit (percent). Defaults to 0
  // (healthy) if not specified.
  const targetDevPct = def.targetDevPct ?? 0;

  for (let i = 0; i < N; i++) {
    const hour = 6 + (i * DT) / 3600;
    const timestamp = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;

    // Base expected power (diurnal variation): cyclePeriods/cyclePhase give
    // each machine a different wobble shape so trend charts look distinct.
    const expected = def.base + Math.sin((i / N) * Math.PI * 2 * cyclePeriods + cyclePhase) * 2;

    // Actual power: expected plus a sustained offset that puts the machine in
    // its target condition, plus a small wobble so the line still moves. The
    // resulting deviation is clamped to stay within the machine's condition
    // band, so the machine never leaves its state — stable for the demo.
    const wobble = gauss(rng, 0, def.base * 0.012); // ~±0.3% wobble
    let devPct = targetDevPct + (wobble / expected) * 100;
    // Clamp the deviation to stay safely inside the band.
    const lowerBound = targetDevPct < 5 ? 0 : targetDevPct < 10 ? 5.5 : 11;
    const upperBound = targetDevPct < 5 ? 4 : targetDevPct < 10 ? 9.5 : 20;
    devPct = Math.max(lowerBound, Math.min(upperBound, devPct));
    const actual = expected * (1 + devPct / 100);

    // Vibration (mm/s): healthy machines sit low; the warning/critical
    // machines run a bit hotter to match their condition.
    const vibBase = targetDevPct >= 10 ? 4.0 : targetDevPct >= 5 ? 3.2 : 2.0;
    const vibration = Math.max(0, gauss(rng, vibBase, 0.3));

    // Cycle time (seconds): slightly slower as the machine works harder.
    const ctBase = 90 + (targetDevPct >= 10 ? 25 : targetDevPct >= 5 ? 12 : 0);
    const cycleTime = Math.max(0, gauss(rng, ctBase, 5));

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
      targetDevPct: def.targetDevPct,
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
