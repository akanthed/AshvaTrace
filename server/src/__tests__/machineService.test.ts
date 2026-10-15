import { describe, it, expect, beforeEach } from 'vitest';
import {
  initShiftData,
  getMachines,
  getMachineById,
  getMachineSeries,
  getMachineStatus,
} from '../services/machineService';

describe('machineService', () => {
  beforeEach(() => {
    initShiftData();
  });

  it('getMachines returns all seeded machines', () => {
    const machines = getMachines();
    expect(machines).toHaveLength(6);
    expect(machines.map((m) => m.id)).toEqual([
      'CNC-01',
      'CNC-02',
      'CNC-03',
      'LATHE-01',
      'GRD-01',
      'PRS-01',
    ]);
  });

  it('getMachineById returns the machine or null', () => {
    expect(getMachineById('CNC-03')?.name).toBe('CNC Mill 03');
    expect(getMachineById('NOPE')).toBeNull();
  });

  it('getMachineStatus returns normal for a healthy machine', () => {
    const status = getMachineStatus('CNC-01');
    expect(status).not.toBeNull();
    expect(status!.status).toBe('normal');
    expect(Math.abs(status!.devPct)).toBeLessThanOrEqual(5);
    expect(status!.machineId).toBe('CNC-01');
    expect(status!.actual).toBeGreaterThan(0);
    expect(status!.expected).toBeGreaterThan(0);
  });

  it('CNC-02 shows warning at end of shift', () => {
    const status = getMachineStatus('CNC-02');
    expect(status).not.toBeNull();
    expect(status!.status).toBe('warning');
    expect(status!.devPct).toBeGreaterThan(5);
    expect(status!.devPct).toBeLessThan(10);
  });

  it('CNC-03 shows critical at end of shift', () => {
    const status = getMachineStatus('CNC-03');
    expect(status).not.toBeNull();
    expect(status!.status).toBe('critical');
    expect(status!.devPct).toBeGreaterThan(10);
  });

  it('getMachineStatus returns null for unknown machine', () => {
    expect(getMachineStatus('NOPE')).toBeNull();
  });

  it('getMachineSeries returns full series by default', () => {
    const series = getMachineSeries('CNC-01');
    expect(series).not.toBeNull();
    expect(series!.machineId).toBe('CNC-01');
    expect(series!.samples).toBe(2400);
    expect(series!.series).toHaveLength(2400);
  });

  it('getMachineSeries supports from/to slicing', () => {
    const series = getMachineSeries('CNC-01', 100, 200);
    expect(series!.from).toBe(100);
    expect(series!.to).toBe(200);
    expect(series!.samples).toBe(100);
    expect(series!.series).toHaveLength(100);
  });

  it('getMachineSeries returns null for unknown machine', () => {
    expect(getMachineSeries('NOPE')).toBeNull();
  });
});
