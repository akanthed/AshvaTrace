import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the incident service so checkThresholds doesn't create real incidents.
// getIncidentById defaults to an open incident so existing dedup tests see
// the alert as still describing a live problem; tests for the auto-clear
// behavior override this per-test.
vi.mock('../services/incidentService', () => ({
  createIncident: vi.fn((machineId: string, devPct: number, severity: string) => ({
    id: `INC-TEST-${machineId}`,
    machineId,
    devPct,
    severity,
  })),
  getIncidentById: vi.fn((id: string) => ({ id, status: 'open' })),
}));

import {
  checkThresholds,
  getAlerts,
  getAlertsByMachine,
  acknowledgeAlert,
} from '../services/alertService';
import { initShiftData } from '../services/machineService';
import { createIncident, getIncidentById } from '../services/incidentService';

// The alert store is module-level and persists across tests, so reset it
// between tests by re-importing a fresh module instance.
async function resetAlertStore() {
  vi.resetModules();
  const fresh = await import('../services/alertService');
  return fresh;
}

describe('alertService', () => {
  let svc: typeof import('../services/alertService');

  beforeEach(async () => {
    initShiftData();
    vi.clearAllMocks();
    // clearAllMocks resets call history but not a mockReturnValue set by an
    // earlier test, so restore the "incident still open" default explicitly.
    vi.mocked(getIncidentById).mockImplementation((id: string) => ({ id, status: 'open' }) as any);
    svc = await resetAlertStore();
  });

  it('checkThresholds creates an alert for CNC-03 (critical)', () => {
    const newAlerts = svc.checkThresholds();
    expect(newAlerts.length).toBeGreaterThanOrEqual(1);

    const cnc03 = newAlerts.find((a) => a.machineId === 'CNC-03');
    expect(cnc03).toBeDefined();
    expect(cnc03!.severity).toBe('critical');
    expect(cnc03!.devPct).toBeGreaterThan(10);
    expect(cnc03!.acknowledged).toBe(false);
    expect(cnc03!.message).toContain('CRITICAL');
    // Critical alerts get an incident
    expect(cnc03!.incidentId).toBe('INC-TEST-CNC-03');
    expect(createIncident).toHaveBeenCalledWith('CNC-03', cnc03!.devPct, 'critical');
  });

  it('alert severity matches threshold crossing (warning vs critical)', () => {
    const newAlerts = svc.checkThresholds();
    for (const a of newAlerts) {
      if (a.severity === 'critical') {
        expect(Math.abs(a.devPct)).toBeGreaterThan(10);
      } else if (a.severity === 'warning') {
        expect(Math.abs(a.devPct)).toBeGreaterThan(5);
        expect(Math.abs(a.devPct)).toBeLessThanOrEqual(10);
      }
    }
  });

  it('does not create duplicate unacknowledged alerts for the same machine+severity', () => {
    const first = svc.checkThresholds();
    const second = svc.checkThresholds();
    expect(second).toHaveLength(0);
    expect(svc.getAlerts().length).toBe(first.length);
  });

  it('getAlerts returns alerts sorted by timestamp descending', () => {
    svc.checkThresholds();
    const alerts = svc.getAlerts();
    for (let i = 1; i < alerts.length; i++) {
      expect(new Date(alerts[i - 1].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(alerts[i].timestamp).getTime()
      );
    }
  });

  it('getAlertsByMachine filters by machine', () => {
    svc.checkThresholds();
    const cnc03Alerts = svc.getAlertsByMachine('CNC-03');
    for (const a of cnc03Alerts) {
      expect(a.machineId).toBe('CNC-03');
    }
  });

  it('acknowledgeAlert marks the alert as acknowledged', () => {
    const newAlerts = svc.checkThresholds();
    const target = newAlerts[0];
    const acked = svc.acknowledgeAlert(target.id, { acknowledgedBy: 'engineer' });
    expect(acked).not.toBeNull();
    expect(acked!.acknowledged).toBe(true);
  });

  it('acknowledgeAlert returns null for unknown alert id', () => {
    expect(svc.acknowledgeAlert('ALR-DOES-NOT-EXIST', { acknowledgedBy: 'x' })).toBeNull();
  });

  it('auto-acknowledges an alert once its incident resolves, so a new one can fire for the next problem', () => {
    const first = svc.checkThresholds();
    const cnc03 = first.find((a) => a.machineId === 'CNC-03' && a.severity === 'critical')!;
    expect(cnc03.acknowledged).toBe(false);

    // Incident reaches a terminal state — the next tick should clear the alert.
    vi.mocked(getIncidentById).mockReturnValue({ id: cnc03.incidentId!, status: 'verified' } as any);
    svc.checkThresholds();

    const updated = svc.getAlerts().find((a) => a.id === cnc03.id)!;
    expect(updated.acknowledged).toBe(true);
  });

  it('auto-acknowledges an alert whose incident no longer exists', () => {
    const first = svc.checkThresholds();
    const cnc03 = first.find((a) => a.machineId === 'CNC-03' && a.severity === 'critical')!;

    vi.mocked(getIncidentById).mockReturnValue(null as any);
    svc.checkThresholds();

    const updated = svc.getAlerts().find((a) => a.id === cnc03.id)!;
    expect(updated.acknowledged).toBe(true);
  });

  it('does not touch an alert whose incident is still open', () => {
    const first = svc.checkThresholds();
    const cnc03 = first.find((a) => a.machineId === 'CNC-03' && a.severity === 'critical')!;

    svc.checkThresholds(); // getIncidentById still returns status: 'open' by default

    const updated = svc.getAlerts().find((a) => a.id === cnc03.id)!;
    expect(updated.acknowledged).toBe(false);
  });
});
