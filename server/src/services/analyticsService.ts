import { getMachines, getMachineSeries, statusForDeviation } from './machineService';

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
