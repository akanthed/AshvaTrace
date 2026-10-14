import { describe, it, expect, beforeEach } from 'vitest';
import {
  getShiftSummary,
  getThresholdViolations,
  getEnergyReport,
  getMachineComparison,
} from '../services/analyticsService';
import { initShiftData } from '../services/machineService';

describe('analyticsService', () => {
  beforeEach(() => {
    initShiftData();
  });

  describe('getShiftSummary', () => {
    it('returns a summary for all 6 machines', () => {
      const summary = getShiftSummary();
      expect(summary.shiftStart).toBe('06:00');
      expect(summary.shiftEnd).toBe('14:00');
      expect(summary.machines).toHaveLength(6);
    });

    it('flags CNC-03 as critical and healthy machines as non-critical', () => {
      const summary = getShiftSummary();
      const cnc03 = summary.machines.find((m: any) => m.machineId === 'CNC-03')!;
      const cnc01 = summary.machines.find((m: any) => m.machineId === 'CNC-01')!;
      expect(cnc03.status).toBe('critical');
      expect(cnc03.criticals).toBeGreaterThan(0);
      // Healthy machines never cross the critical threshold
      expect(cnc01.status).not.toBe('critical');
      expect(cnc01.criticals).toBe(0);
    });

    it('totals warnings and criticals across machines', () => {
      const summary = getShiftSummary();
      const sumWarnings = summary.machines.reduce((a: number, m: any) => a + m.warnings, 0);
      const sumCriticals = summary.machines.reduce((a: number, m: any) => a + m.criticals, 0);
      expect(summary.totalWarnings).toBe(sumWarnings);
      expect(summary.totalCriticals).toBe(sumCriticals);
      expect(summary.totalCriticals).toBeGreaterThan(0);
    });
  });

  describe('getThresholdViolations', () => {
    it('returns violations for all machines', () => {
      const violations = getThresholdViolations();
      expect(violations.length).toBeGreaterThan(0);
      for (const v of violations) {
        expect(v.machineId).toBeDefined();
        expect(v.severity).toBeOneOf(['warning', 'critical']);
        // devPct is rounded to 1 decimal, so a 5.04% deviation shows as 5.0
        expect(Math.abs(v.devPct)).toBeGreaterThanOrEqual(5);
        expect(v.sampleIndex).toBeGreaterThanOrEqual(0);
        expect(v.sampleIndex).toBeLessThan(2400);
      }
    });

    it('filters by machineId', () => {
      const violations = getThresholdViolations('CNC-03');
      expect(violations.length).toBeGreaterThan(0);
      for (const v of violations) {
        expect(v.machineId).toBe('CNC-03');
      }
    });

    it('severity is critical only when deviation exceeds critical threshold', () => {
      const violations = getThresholdViolations();
      for (const v of violations) {
        if (v.severity === 'critical') {
          expect(Math.abs(v.devPct)).toBeGreaterThan(10);
        } else {
          expect(Math.abs(v.devPct)).toBeLessThanOrEqual(10);
        }
      }
    });
  });

  describe('getEnergyReport', () => {
    it('returns energy data for all machines', () => {
      const report = getEnergyReport();
      expect(report.machines).toHaveLength(6);
      for (const m of report.machines) {
        expect(m.totalActualKwh).toBeGreaterThan(0);
        expect(m.totalExpectedKwh).toBeGreaterThan(0);
        expect(Number.isFinite(m.excessKwh)).toBe(true);
        expect(Number.isFinite(m.excessPct)).toBe(true);
      }
    });

    it('CNC-03 has positive excess energy due to drift', () => {
      const report = getEnergyReport();
      const cnc03 = report.machines.find((m: any) => m.machineId === 'CNC-03')!;
      expect(cnc03.excessKwh).toBeGreaterThan(0);
      expect(cnc03.excessPct).toBeGreaterThan(0);
    });

    it('totalExcessKwh is the sum of per-machine excess', () => {
      const report = getEnergyReport();
      const sum = report.machines.reduce((a: number, m: any) => a + m.excessKwh, 0);
      expect(report.totalExcessKwh).toBeCloseTo(sum, 1);
    });
  });

  describe('getMachineComparison', () => {
    it('returns comparison stats for all machines', () => {
      const comparison = getMachineComparison();
      expect(comparison).toHaveLength(6);
      for (const m of comparison) {
        expect(m.avgActual).toBeGreaterThan(0);
        expect(m.avgExpected).toBeGreaterThan(0);
        expect(m.stdDev).toBeGreaterThan(0);
      }
    });

    it('CNC-03 has a higher std dev than a healthy machine', () => {
      const comparison = getMachineComparison();
      const cnc03 = comparison.find((m: any) => m.machineId === 'CNC-03')!;
      const cnc01 = comparison.find((m: any) => m.machineId === 'CNC-01')!;
      expect(cnc03.stdDev).toBeGreaterThan(cnc01.stdDev);
    });
  });
});
