import { describe, it, expect } from 'vitest';

// The service imports incidentService (BigQuery, AI). Only the pure function is
// under test here, so stub that module out.
import { vi } from 'vitest';
vi.mock('../services/incidentService', () => ({ getIncidents: () => [] }));

import { computeTrackRecord } from '../services/trackRecordService';

const hyps = [
  { id: 'HYP-1', confidence: 80 },
  { id: 'HYP-2', confidence: 30 },
];

const inc = (over: Record<string, unknown>) => ({
  id: 'INC-X',
  machineId: 'CNC-01',
  hypotheses: hyps,
  selectedHypothesis: 'HYP-1',
  verification: { passed: true, metrics: { powerDevPct: 1 }, predictionHeld: true, expectedPowerDevPct: 2 },
  ...over,
});

describe('computeTrackRecord (the AI report card, graded by code)', () => {
  it('counts only incidents that were verified', () => {
    const r = computeTrackRecord([inc({}), inc({ verification: undefined }), inc({ hypotheses: [] })] as any);
    expect(r.graded).toBe(1);
    expect(r.fixesPassed).toBe(1);
  });

  it('buckets confidence against the real pass rate', () => {
    const r = computeTrackRecord([
      inc({}),
      inc({ verification: { passed: false, metrics: {} } }),
      inc({ selectedHypothesis: 'HYP-2', verification: { passed: false, metrics: {} } }),
    ] as any);
    const high = r.calibration.find((b) => b.label.startsWith('AI was 70%'))!;
    const low = r.calibration.find((b) => b.label.includes('under 40'))!;
    expect(high).toMatchObject({ incidents: 2, passed: 1 });
    expect(low).toMatchObject({ incidents: 1, passed: 0 });
  });

  it('scores predictions and their average error', () => {
    const r = computeTrackRecord([
      inc({}), // expected 2, measured 1 -> error 1, held
      inc({ verification: { passed: false, metrics: { powerDevPct: 9 }, predictionHeld: false, expectedPowerDevPct: 3 } }), // error 6
    ] as any);
    expect(r.predictionsScored).toBe(2);
    expect(r.predictionsHeld).toBe(1);
    expect(r.avgPredictionErrorPts).toBe(3.5);
  });

  it('tracks how often the engineer chose the top-ranked cause and it passed', () => {
    const r = computeTrackRecord([inc({}), inc({ selectedHypothesis: 'HYP-2' })] as any);
    expect(r.topCauseChosen).toBe(1);
    expect(r.topCausePassed).toBe(1);
  });

  it('can be scoped to one machine', () => {
    const r = computeTrackRecord([inc({}), inc({ machineId: 'PRS-01' })] as any, 'PRS-01');
    expect(r.scope).toBe('machine');
    expect(r.graded).toBe(1);
  });
});
