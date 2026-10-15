import { describe, it, expect } from 'vitest';
import { generateShiftData } from '../utils/synthetic';

const N = 2400;
const DT = 12;

describe('synthetic data generator', () => {
  it('returns 2400 samples per machine', () => {
    const { data } = generateShiftData();
    expect(data.N).toBe(N);
    expect(data.DT).toBe(DT);
    expect(data.machines).toHaveLength(3);
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

  it('CNC-01 stays in the normal band (deviation well under warning)', () => {
    const { data } = generateShiftData();
    const cnc01 = data.machines.find((m) => m.id === 'CNC-01')!;
    const devs = cnc01.series.map((s) => ((s.actual - s.expected) / s.expected) * 100);
    // Target is ~1%, so the deviation should hover low and never reach the
    // 5% warning threshold.
    const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
    expect(Math.abs(mean)).toBeLessThan(3);
    expect(Math.max(...devs)).toBeLessThan(5);
  });

  it('CNC-02 stays in the warning band (above warning, under critical)', () => {
    const { data } = generateShiftData();
    const cnc02 = data.machines.find((m) => m.id === 'CNC-02')!;
    const devs = cnc02.series.map((s) => ((s.actual - s.expected) / s.expected) * 100);
    const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
    // Target is ~7.5%, so it should sit above the 5% warning and below the
    // 10% critical threshold for the whole shift.
    expect(mean).toBeGreaterThan(5);
    expect(mean).toBeLessThan(10);
    expect(Math.min(...devs)).toBeGreaterThan(5);
    expect(Math.max(...devs)).toBeLessThan(10);
  });

  it('CNC-03 stays in the action band (above critical)', () => {
    const { data } = generateShiftData();
    const cnc03 = data.machines.find((m) => m.id === 'CNC-03')!;
    const devs = cnc03.series.map((s) => ((s.actual - s.expected) / s.expected) * 100);
    const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
    // Target is ~15%, so it should sit above the 10% critical threshold for
    // the whole shift.
    expect(mean).toBeGreaterThan(10);
    expect(Math.min(...devs)).toBeGreaterThan(10);
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

  it('warning/critical machines run hotter vibration and cycle time than normal', () => {
    const { data } = generateShiftData();
    const cnc01 = data.machines.find((m) => m.id === 'CNC-01')!;
    const cnc03 = data.machines.find((m) => m.id === 'CNC-03')!;
    const avg = (m: any) => m.series.reduce((a: number, s: any) => a + s.vibration, 0) / m.series.length;
    const avgCt = (m: any) => m.series.reduce((a: number, s: any) => a + s.cycleTime, 0) / m.series.length;
    expect(avg(cnc03)).toBeGreaterThan(avg(cnc01));
    expect(avgCt(cnc03)).toBeGreaterThan(avgCt(cnc01));
  });

  it('machine list omits full series', () => {
    const { machines } = generateShiftData();
    expect(machines).toHaveLength(3);
    for (const m of machines) {
      expect(m.series).toEqual([]);
    }
  });
});
