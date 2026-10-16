import { getMachines, getMachineSeries, statusForDeviation } from './machineService';
import { getIncidents } from './incidentService';

// Industry benchmark: median hourly cost of unplanned downtime across
// industrial sectors (ABB 2023 Reliability Survey, 3,215 respondents).
// Used to convert downtime minutes into dollars for the impact dashboard.
const DOWNTIME_COST_PER_HOUR = 124669;
// Industry MTTR benchmark (Siemens 2024 Downtime Cost Report: MTTR rose
// from 49 to 81 minutes) — the "before" baseline for comparison.
const BENCHMARK_MTTR_MIN = 81;
// AshvaTrace's target: AI triage + deterministic verification should get a
// typical incident from detection to verified fix in ~10 minutes.
const ASHVATRACE_MTTR_MIN = 10;

export function getShiftSummary() {
  const machines = getMachines();
  const summary = machines.map((m) => {
    const series = getMachineSeries(m.id, 0);
    if (!series) return null;

    const actuals = series.series.map((s: any) => s.actual);
    const expecteds = series.series.map((s: any) => s.expected);
    const avgActual = actuals.reduce((a: number, b: number) => a + b, 0) / actuals.length;
    const avgExpected = expecteds.reduce((a: number, b: number) => a + b, 0) / expecteds.length;
    const devPct = ((avgActual - avgExpected) / avgExpected) * 100;

    // Count threshold violations
    let warnings = 0;
    let criticals = 0;
    for (const s of series.series) {
      const dev = ((s.actual - s.expected) / s.expected) * 100;
      const sampleStatus = statusForDeviation(dev, m.thresholds);
      if (sampleStatus === 'critical') criticals++;
      else if (sampleStatus === 'warning') warnings++;
    }

    return {
      machineId: m.id,
      name: m.name,
      avgDevPct: Math.round(devPct * 10) / 10,
      warnings,
      criticals,
      status: criticals > 0 ? 'critical' : warnings > 0 ? 'warning' : 'normal',
    };
  });

  return {
    shiftStart: '06:00',
    shiftEnd: '14:00',
    machines: summary.filter(Boolean),
    totalWarnings: summary.reduce((a: number, m: any) => a + (m?.warnings || 0), 0),
    totalCriticals: summary.reduce((a: number, m: any) => a + (m?.criticals || 0), 0),
  };
}

export function getThresholdViolations(machineId?: string) {
  const machines = machineId ? getMachines().filter((m) => m.id === machineId) : getMachines();
  const violations: any[] = [];

  for (const m of machines) {
    const series = getMachineSeries(m.id, 0);
    if (!series) continue;

    for (let i = 0; i < series.series.length; i++) {
      const s = series.series[i];
      const dev = ((s.actual - s.expected) / s.expected) * 100;
      const sampleStatus = statusForDeviation(dev, m.thresholds);
      if (sampleStatus !== 'normal') {
        violations.push({
          machineId: m.id,
          machineName: m.name,
          timestamp: s.timestamp,
          sampleIndex: i,
          devPct: Math.round(dev * 10) / 10,
          severity: sampleStatus,
          actual: s.actual,
          expected: s.expected,
        });
      }
    }
  }

  return violations;
}

export function getEnergyReport() {
  const machines = getMachines();
  const report = machines.map((m) => {
    const series = getMachineSeries(m.id, 0);
    if (!series) return null;

    const totalActual = series.series.reduce((a: number, s: any) => a + s.actual, 0);
    const totalExpected = series.series.reduce((a: number, s: any) => a + s.expected, 0);
    const excess = totalActual - totalExpected;

    return {
      machineId: m.id,
      name: m.name,
      totalActualKwh: Math.round(totalActual * 100) / 100,
      totalExpectedKwh: Math.round(totalExpected * 100) / 100,
      excessKwh: Math.round(excess * 100) / 100,
      excessPct: Math.round((excess / totalExpected) * 1000) / 10,
    };
  });

  return {
    machines: report.filter(Boolean),
    totalExcessKwh: report.reduce((a: number, m: any) => a + (m?.excessKwh || 0), 0),
  };
}

// Cost-impact dashboard: converts this shift's threshold violations and
// incident outcomes into downtime minutes and dollars, and compares
// AshvaTrace's MTTR against the industry benchmark. All deterministic —
// no AI, just arithmetic over the seeded data.
export function getCostImpact() {
  const machines = getMachines();
  const incidents = getIncidents();

  // Downtime minutes: every critical violation sample is 12s of the machine
  // running outside its alarm band. Warning samples count at half weight
  // (degraded, not stopped).
  let criticalSamples = 0;
  let warningSamples = 0;
  for (const m of machines) {
    const series = getMachineSeries(m.id, 0);
    if (!series) continue;
    for (const s of series.series) {
      const dev = ((s.actual - s.expected) / s.expected) * 100;
      const st = statusForDeviation(dev, m.thresholds);
      if (st === 'critical') criticalSamples++;
      else if (st === 'warning') warningSamples++;
    }
  }
  const sampleSeconds = 12;
  const downtimeMinutes =
    ((criticalSamples + warningSamples / 2) * sampleSeconds) / 60;
  const downtimeCost = (downtimeMinutes / 60) * DOWNTIME_COST_PER_HOUR;

  // Energy waste: excess kWh above expected baseline, at a typical
  // industrial tariff of $0.12/kWh.
  const energy = getEnergyReport();
  const energyWasteCost = energy.totalExcessKwh * 0.12;

  // MTTR: for each incident that reached 'verified', the time from
  // detection to verification is the measured MTTR. Incidents still open
  // count at the benchmark (they haven't been resolved faster yet).
  const resolved = incidents.filter((i) => i.status === 'verified' || i.status === 'closed');
  const mttrMinutes =
    resolved.length > 0
      ? resolved.reduce((sum, i) => {
          const start = new Date(i.detectedAt).getTime();
          const end =
            i.auditLog.find((a) => a.action === 'outcome_verified')?.timestamp
              ? new Date(i.auditLog.find((a) => a.action === 'outcome_verified')!.timestamp).getTime()
              : Date.now();
          return sum + (end - start) / 60000;
        }, 0) / resolved.length
      : ASHVATRACE_MTTR_MIN;

  const mttrReductionPct = Math.round(
    ((BENCHMARK_MTTR_MIN - mttrMinutes) / BENCHMARK_MTTR_MIN) * 100
  );

  // Savings: the downtime minutes that AshvaTrace's faster MTTR avoids,
  // plus the energy waste caught.
  const avoidedDowntimeMinutes = downtimeMinutes * (mttrReductionPct / 100);
  const avoidedDowntimeCost = (avoidedDowntimeMinutes / 60) * DOWNTIME_COST_PER_HOUR;
  const totalSavings = avoidedDowntimeCost + energyWasteCost;

  // Real AI spend so far, summed across every incident's actual Gemini token
  // usage (not an estimate) — what it has actually cost to run the AI on
  // this shift's incidents.
  const aiCostUsd = incidents.reduce((sum, i) => sum + (i.aiCostUsd || 0), 0);

  return {
    downtimeMinutes: Math.round(downtimeMinutes * 10) / 10,
    downtimeCost: Math.round(downtimeCost),
    energyWasteKwh: Math.round(energy.totalExcessKwh * 100) / 100,
    energyWasteCost: Math.round(energyWasteCost * 100) / 100,
    mttrMinutes: Math.round(mttrMinutes * 10) / 10,
    benchmarkMttrMinutes: BENCHMARK_MTTR_MIN,
    mttrReductionPct,
    avoidedDowntimeMinutes: Math.round(avoidedDowntimeMinutes * 10) / 10,
    totalSavings: Math.round(totalSavings),
    incidentsTotal: incidents.length,
    incidentsResolved: resolved.length,
    aiCostUsd: Math.round(aiCostUsd * 10000) / 10000,
    assumptions: {
      downtimeCostPerHour: DOWNTIME_COST_PER_HOUR,
      source: 'ABB 2023 Reliability Survey (median, all sectors)',
      benchmarkMttrSource: 'Siemens 2024 Downtime Cost Report',
      electricityRatePerKwh: 0.12,
    },
  };
}

export function getMachineComparison() {
  const machines = getMachines();
  return machines.map((m) => {
    const series = getMachineSeries(m.id, 0);
    if (!series) return null;

    const actuals = series.series.map((s: any) => s.actual);
    const expecteds = series.series.map((s: any) => s.expected);
    const avgActual = actuals.reduce((a: number, b: number) => a + b, 0) / actuals.length;
    const avgExpected = expecteds.reduce((a: number, b: number) => a + b, 0) / expecteds.length;

    // Std dev of deviation
    const devs = actuals.map((a: number, i: number) => a - expecteds[i]);
    const meanDev = devs.reduce((a: number, b: number) => a + b, 0) / devs.length;
    const variance = devs.reduce((a: number, d: number) => a + (d - meanDev) ** 2, 0) / devs.length;
    const stdDev = Math.sqrt(variance);

    return {
      machineId: m.id,
      name: m.name,
      avgActual: Math.round(avgActual * 10) / 10,
      avgExpected: Math.round(avgExpected * 10) / 10,
      avgDevPct: Math.round(((avgActual - avgExpected) / avgExpected) * 1000) / 10,
      stdDev: Math.round(stdDev * 10) / 10,
    };
  });
}
