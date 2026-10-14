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

// A short, self-resolving event on an otherwise healthy machine: a
// triangular pulse (ramps up to a peak at the midpoint, then back down to
// zero) added on top of the normal noise. Modeled on real, physically
// plausible causes per machine type so each one's trend tells a distinct
// story instead of all 5 non-incident machines looking like flat noise —
// but all fully recover, unlike CNC-03's sustained drift below.
interface TransientEvent {
  start: number;
  duration: number;
  powerDelta: number; // kW added at peak (negative = dip)
  vibrationDelta: number; // mm/s added at peak
  cycleTimeDelta: number; // seconds added at peak
}

function triangularPulse(i: number, event: TransientEvent): number {
  const { start, duration } = event;
  if (i < start || i >= start + duration) return 0;
  const mid = duration / 2;
  const distFromMid = Math.abs(i - start - mid);
  return Math.max(0, 1 - distFromMid / mid);
}

// noiseStd/cyclePeriods/cyclePhase give each machine a visually distinct
// trend shape (different wobble amplitude and a different number/offset of
// load cycles across the shift) instead of all 6 looking like the same
// wiggly line shifted up/down by `base` alone.
const MACHINE_DEFS = [
  {
    id: 'CNC-01', name: 'CNC Mill 01', type: 'milling', base: 45, warning: 5, critical: 10, noiseStd: 0.8, cyclePeriods: 1, cyclePhase: 0,
    // Coolant-flow hiccup: brief extra load while flow self-corrects.
    event: { start: 500, duration: 20, powerDelta: 2, vibrationDelta: 0.4, cycleTimeDelta: 3 },
  },
  {
    id: 'CNC-02', name: 'CNC Mill 02', type: 'milling', base: 42, warning: 5, critical: 10, noiseStd: 1.4, cyclePeriods: 3, cyclePhase: 1.1,
    // Cold-start warm-up: higher friction/power right at shift start, settles as the machine warms.
    event: { start: 0, duration: 150, powerDelta: 2.2, vibrationDelta: 0.3, cycleTimeDelta: 4 },
  },
  { id: 'CNC-03', name: 'CNC Mill 03', type: 'milling', base: 48, warning: 5, critical: 10, noiseStd: 0.8, cyclePeriods: 1, cyclePhase: 0 },
  {
    id: 'CNC-04', name: 'CNC Lathe 04', type: 'turning', base: 38, warning: 5, critical: 10, noiseStd: 0.5, cyclePeriods: 6, cyclePhase: 2.4,
    // Lighter material batch: less cutting force needed for a run of parts.
    event: { start: 1200, duration: 30, powerDelta: -1.8, vibrationDelta: -0.2, cycleTimeDelta: -2 },
  },
  {
    id: 'GRD-01', name: 'Grinder 01', type: 'grinding', base: 30, warning: 5, critical: 10, noiseStd: 1.8, cyclePeriods: 2, cyclePhase: 3.6,
    // Wheel dressing: not cutting (power dips) but the dressing tool raises vibration.
    event: { start: 1800, duration: 12, powerDelta: -1, vibrationDelta: 1.1, cycleTimeDelta: 1 },
  },
  {
    id: 'PRS-01', name: 'Press 01', type: 'stamping', base: 55, warning: 5, critical: 10, noiseStd: 2.2, cyclePeriods: 4, cyclePhase: 0.6,
    // Die lubrication pass: slower strokes and lower power during the pass.
    event: { start: 700, duration: 20, powerDelta: -2, vibrationDelta: -0.1, cycleTimeDelta: 15 },
  },
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
  noiseStd?: number;
  cyclePeriods?: number;
  cyclePhase?: number;
  event?: TransientEvent;
}

export function generateMachineSeries(def: MachineDef, rng: () => number = mulberry32(SEED)): Sample[] {
  const series: Sample[] = [];
  const noiseStd = def.noiseStd ?? 0.8;
  const cyclePeriods = def.cyclePeriods ?? 1;
  const cyclePhase = def.cyclePhase ?? 0;

  for (let i = 0; i < N; i++) {
    const hour = 6 + (i * DT) / 3600;
    const timestamp = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;

    // Base expected power (diurnal variation): cyclePeriods/cyclePhase give
    // each machine a different wobble shape so trend charts look distinct.
    const expected = def.base + Math.sin((i / N) * Math.PI * 2 * cyclePeriods + cyclePhase) * 2;

    // Actual power: expected + noise
    let actual = gauss(rng, expected, noiseStd);

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

    // Every other machine gets one short, fully-recovering event instead of
    // CNC-03's sustained unresolved drift — a real but ordinary operating
    // moment (warm-up, lubrication pass, material change), not a fault.
    if (def.event) {
      const w = triangularPulse(i, def.event);
      if (w > 0) {
        actual += def.event.powerDelta * w;
        vibration += def.event.vibrationDelta * w;
        cycleTime += def.event.cycleTimeDelta * w;
      }
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
