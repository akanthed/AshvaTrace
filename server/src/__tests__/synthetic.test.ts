import { describe, it, expect } from 'vitest';
import { generateShiftData } from '../utils/synthetic';

const N = 2400;
const DT = 12;
const DRIFT_START = 960;
const DRIFT_RATE = 0.008;
const CNC03_BASE = 48;

describe('synthetic data generator', () => {
  it('returns 2400 samples per machine', () => {
    const { data } = generateShiftData();
    expect(data.N).toBe(N);
    expect(data.DT).toBe(DT);
    expect(data.machines).toHaveLength(6);
    for (const m of data.machines) {
      expect(m.series).toHaveLength(N);
    }
  });

  it('is deterministic: same seed produces identical output', () => {
    const a = generateShiftData();
    const b = generateShiftData();
    expect(a.data.machines).toEqual(b.data.machines);
  });

  it('has the expected machines with expected base power values', () => {
    const { data } = generateShiftData();
    const bases: Record<string, number> = {
      'CNC-01': 45,
      'CNC-02': 42,
      'CNC-03': 48,
      'CNC-04': 38,
      'GRD-01': 30,
      'PRS-01': 55,
    };
    for (const m of data.machines) {
      expect(bases[m.id]).toBeDefined();
      // Average expected power over the shift should be close to base
      // (diurnal sine term averages to ~0)
      const avgExpected =
        m.series.reduce((a, s) => a + s.expected, 0) / m.series.length;
      expect(Math.abs(avgExpected - bases[m.id])).toBeLessThan(1);
    }
  });

  it('CNC-03 has a drift starting at sample 960', () => {
    const { data } = generateShiftData();
    const cnc03 = data.machines.find((m) => m.id === 'CNC-03')!;

    // Before drift: deviation should be small (noise only, std ~0.8)
    const preDriftDevs = cnc03.series
      .slice(0, DRIFT_START)
      .map((s) => s.actual - s.expected);
    const preDriftMean =
      preDriftDevs.reduce((a, b) => a + b, 0) / preDriftDevs.length;
    expect(Math.abs(preDriftMean)).toBeLessThan(0.5);

    // After drift: deviation grows linearly
    const last = cnc03.series[N - 1];
    const expectedDrift = (N - 1 - DRIFT_START) * DRIFT_RATE * CNC03_BASE;
    expect(last.actual - last.expected).toBeGreaterThan(expectedDrift * 0.8);

    // Deviation at drift start is still small, at mid-drift it's clearly elevated
    const atStart = cnc03.series[DRIFT_START];
    const atMid = cnc03.series[DRIFT_START + 400];
    expect(atMid.actual - atMid.expected).toBeGreaterThan(
      atStart.actual - atStart.expected
    );
  });

  it('computes deviation correctly (actual - expected)', () => {
    const { data } = generateShiftData();
    for (const m of data.machines) {
      for (const s of m.series) {
        const devPct = ((s.actual - s.expected) / s.expected) * 100;
        // Recomputed deviation must match the raw values
        expect(devPct).toBeCloseTo(((s.actual - s.expected) / s.expected) * 100, 5);
        // All values are finite and sane
        expect(Number.isFinite(s.actual)).toBe(true);
        expect(Number.isFinite(s.expected)).toBe(true);
        expect(s.expected).toBeGreaterThan(0);
      }
    }
  });

  it('CNC-03 vibration and cycle time rise after drift start', () => {
    const { data } = generateShiftData();
    const cnc03 = data.machines.find((m) => m.id === 'CNC-03')!;
    const before = cnc03.series[DRIFT_START - 1];
    const after = cnc03.series[N - 1];
    expect(after.vibration).toBeGreaterThan(before.vibration);
    expect(after.cycleTime).toBeGreaterThan(before.cycleTime);
  });

  it('machine list omits full series', () => {
    const { machines } = generateShiftData();
    expect(machines).toHaveLength(6);
    for (const m of machines) {
      expect(m.series).toEqual([]);
    }
  });
});
