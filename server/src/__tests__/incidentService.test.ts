import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the AI layer so no real Gemini calls happen
vi.mock('../utils/ai', () => ({
  investigate: vi.fn(async () => [
    {
      id: 'HYP-1',
      title: 'Tool wear / spindle bearing degradation',
      confidence: 72,
      evidenceFor: ['Gradual power increase matches bearing wear curve'],
      evidenceAgainst: ['No sudden spike'],
    },
    {
      id: 'HYP-2',
      title: 'Workpiece material variation',
      confidence: 55,
      evidenceFor: ['Cycle time slightly elevated'],
      evidenceAgainst: ['No material change logged'],
    },
  ]),
  simulate: vi.fn(async (params: { action: string }) => ({
    action: params.action,
    predictedOutcome: 'Deviation should reduce to within 2% of expected',
    confidence: 70,
  })),
  verify: vi.fn(
    (
      _simulation: { action: string },
      actualMetrics: Record<string, number>
    ) => {
      const powerDev = actualMetrics.powerDevPct || 0;
      const vibration = actualMetrics.vibrationMmS || 0;
      const cycleTime = actualMetrics.cycleTimeSec || 0;
      const passed =
        Math.abs(powerDev) < 3 && vibration < 4.5 && cycleTime < 120;
      return {
        passed,
        actualOutcome: passed ? 'PASS' : 'FAIL',
        metrics: { powerDevPct: powerDev, vibrationMmS: vibration, cycleTimeSec: cycleTime },
      };
    }
  ),
}));

import {
  createIncident,
  getIncidents,
  getIncidentById,
  investigateIncident,
  simulateAction,
  verifyOutcome,
  getAuditLog,
} from '../services/incidentService';
import { initShiftData } from '../services/machineService';

describe('incidentService', () => {
  beforeEach(() => {
    initShiftData();
    vi.clearAllMocks();
  });

  it('createIncident creates an incident with an audit entry', () => {
    const incident = createIncident('CNC-03', 15.2, 'critical');
    expect(incident.id).toMatch(/^INC-/);
    expect(incident.machineId).toBe('CNC-03');
    expect(incident.machineName).toBe('CNC Mill 03');
    expect(incident.status).toBe('open');
    expect(incident.severity).toBe('critical');
    expect(incident.devPct).toBe(15.2);
    expect(incident.hypotheses).toEqual([]);
    expect(incident.auditLog).toHaveLength(1);
    expect(incident.auditLog[0].action).toBe('incident_detected');
    expect(getIncidentById(incident.id)).toBe(incident);
    expect(getIncidents().some((i) => i.id === incident.id)).toBe(true);
  });

  it('investigateIncident returns hypotheses and updates status', async () => {
    const incident = createIncident('CNC-03', 15.2, 'critical');
    const result = await investigateIncident(incident.id, {
      machineId: 'CNC-03',
      devPct: 15.2,
      signals: { vibration: 3.2, cycleTime: 95 },
    });
    expect(result.status).toBe('investigating');
    expect(result.hypotheses).toHaveLength(2);
    expect(result.hypotheses[0].id).toBe('HYP-1');
    // Audit log: detection + investigation started + hypotheses generated
    expect(result.auditLog.map((e) => e.action)).toEqual([
      'incident_detected',
      'investigation_started',
      'hypotheses_generated',
    ]);
  });

  it('investigateIncident throws for unknown incident', async () => {
    await expect(investigateIncident('INC-NOPE', { machineId: 'x', devPct: 1, signals: {} })).rejects.toThrow(
      'Incident not found'
    );
  });

  it('simulateAction stores the simulation result', async () => {
    const incident = createIncident('CNC-03', 15.2, 'critical');
    await investigateIncident(incident.id, {
      machineId: 'CNC-03',
      devPct: 15.2,
      signals: {},
    });
    const result = await simulateAction(incident.id, {
      hypothesisId: 'HYP-1',
      action: 'Replace spindle bearing',
    });
    expect(result.status).toBe('action_taken');
    expect(result.selectedHypothesis).toBe('HYP-1');
    expect(result.simulation).toEqual({
      action: 'Replace spindle bearing',
      predictedOutcome: 'Deviation should reduce to within 2% of expected',
      confidence: 70,
    });
    expect(result.auditLog.some((e) => e.action === 'action_simulated')).toBe(true);
  });

  it('simulateAction throws for unknown hypothesis', async () => {
    const incident = createIncident('CNC-03', 15.2, 'critical');
    await investigateIncident(incident.id, { machineId: 'CNC-03', devPct: 15.2, signals: {} });
    await expect(
      simulateAction(incident.id, { hypothesisId: 'HYP-99', action: 'x' })
    ).rejects.toThrow('Hypothesis not found');
  });

  it('verifyOutcome passes when metrics are within range', async () => {
    const incident = createIncident('CNC-03', 15.2, 'critical');
    await investigateIncident(incident.id, { machineId: 'CNC-03', devPct: 15.2, signals: {} });
    await simulateAction(incident.id, { hypothesisId: 'HYP-1', action: 'Replace spindle bearing' });

    const result = await verifyOutcome(incident.id, {
      actualMetrics: { powerDevPct: 1.5, vibrationMmS: 2.5, cycleTimeSec: 92 },
    });
    expect(result.verification!.passed).toBe(true);
    expect(result.status).toBe('verified');
    expect(result.auditLog.some((e) => e.action === 'outcome_verified')).toBe(true);
  });

  it('verifyOutcome fails when metrics are out of range', async () => {
    const incident = createIncident('CNC-03', 15.2, 'critical');
    await investigateIncident(incident.id, { machineId: 'CNC-03', devPct: 15.2, signals: {} });
    await simulateAction(incident.id, { hypothesisId: 'HYP-1', action: 'Replace spindle bearing' });

    const result = await verifyOutcome(incident.id, {
      actualMetrics: { powerDevPct: 8.0, vibrationMmS: 5.0, cycleTimeSec: 130 },
    });
    expect(result.verification!.passed).toBe(false);
    expect(result.status).toBe('open');
  });

  it('verifyOutcome throws if no simulation exists', async () => {
    const incident = createIncident('CNC-03', 15.2, 'critical');
    await expect(
      verifyOutcome(incident.id, { actualMetrics: { powerDevPct: 1 } })
    ).rejects.toThrow('No simulation to verify');
  });

  it('getAuditLog returns the full audit trail', async () => {
    const incident = createIncident('CNC-03', 15.2, 'critical');
    await investigateIncident(incident.id, { machineId: 'CNC-03', devPct: 15.2, signals: {} });
    await simulateAction(incident.id, { hypothesisId: 'HYP-1', action: 'Replace spindle bearing' });
    await verifyOutcome(incident.id, {
      actualMetrics: { powerDevPct: 1.5, vibrationMmS: 2.5, cycleTimeSec: 92 },
    });
    const log = getAuditLog(incident.id);
    expect(log).toHaveLength(5);
    expect(log.map((e) => e.action)).toEqual([
      'incident_detected',
      'investigation_started',
      'hypotheses_generated',
      'action_simulated',
      'outcome_verified',
    ]);
    expect(getAuditLog('INC-NOPE')).toEqual([]);
  });
});
