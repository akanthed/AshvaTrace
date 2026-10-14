import type { Thresholds } from '../types';

// Mirrors the server's asymmetric threshold check (machineService.ts
// statusForDeviation) so the UI colors match what actually triggers alerts.
export function statusForDeviation(devPct: number, thresholds: Thresholds): 'normal' | 'warning' | 'critical' {
  if (devPct >= thresholds.upperAlarm || devPct <= thresholds.lowerAlarm) return 'critical';
  if (devPct >= thresholds.upperWarning || devPct <= thresholds.lowerWarning) return 'warning';
  return 'normal';
}
