import { generateShiftData, generateMachineSeries, ShiftData, MachineInfo, Sample, Thresholds } from '../utils/synthetic';
import { upsertMachine, deleteMachineRow, queryMachines, MachineRow } from './bigqueryService';

// In-memory store for the current shift
let shiftData: ShiftData | null = null;
let machineInfos: MachineInfo[] = [];

export function initShiftData() {
  const result = generateShiftData();
  shiftData = result.data;
  machineInfos = result.machines;
  return result;
}

// Load persisted machine definitions from BigQuery and merge them into the
// in-memory store. Machines that exist in BigQuery but not in the seeded set
// (i.e. ones the user added) are regenerated with a fresh series. Machines
// that were deleted in BigQuery are removed from the seeded set. This makes
// add/remove/update survive a server restart.
export async function loadPersistedMachines(): Promise<void> {
  if (!shiftData) initShiftData();
  if (!shiftData) return;

  let rows: MachineRow[] = [];
  try {
    rows = await queryMachines();
  } catch {
    return; // BigQuery unavailable — keep the seeded in-memory set
  }
  if (rows.length === 0) return; // Nothing persisted yet

  const persistedIds = new Set(rows.map((r) => r.id));

  // Remove seeded machines that were deleted in BigQuery
  shiftData.machines = shiftData.machines.filter((m) => persistedIds.has(m.id));
  machineInfos = machineInfos.filter((m) => persistedIds.has(m.id));

  // Add or update machines from BigQuery
  for (const row of rows) {
    const existing = shiftData.machines.find((m) => m.id === row.id);
    const def = {
      id: row.id,
      name: row.name,
      type: row.type,
      base: row.base_power ?? 40,
      warning: row.warning,
      critical: row.critical,
    };
    // lower_warning/lower_alarm are nullable (rows from before asymmetric
    // thresholds existed) — fall back to the negative mirror of the uppers.
    const thresholds: Thresholds = {
      upperAlarm: row.critical,
      upperWarning: row.warning,
      lowerWarning: row.lower_warning ?? -row.warning,
      lowerAlarm: row.lower_alarm ?? -row.critical,
    };
    if (existing) {
      existing.name = row.name;
      existing.type = row.type;
      existing.thresholds = thresholds;
      const summary = machineInfos.find((m) => m.id === row.id);
      if (summary) {
        summary.name = row.name;
        summary.type = row.type;
        summary.thresholds = thresholds;
      }
    } else {
      const series = generateMachineSeries(def);
      const machine: MachineInfo = {
        id: row.id,
        name: row.name,
        type: row.type,
        thresholds,
        series,
      };
      shiftData.machines.push(machine);
      machineInfos.push({ ...machine, series: [] });
    }
  }

  console.log(`[Init] Loaded ${rows.length} persisted machines from BigQuery`);
}

export function getMachines(): MachineInfo[] {
  if (!shiftData) initShiftData();
  return machineInfos;
}

export function getMachineById(id: string): MachineInfo | null {
  if (!shiftData) initShiftData();
  return machineInfos.find((m: MachineInfo) => m.id === id) || null;
}

export function getMachineSeries(id: string, from: number = 0, to?: number) {
  if (!shiftData) initShiftData();
  if (!shiftData) return null;
  const machine = shiftData.machines.find((m) => m.id === id);
  if (!machine) return null;

  const end = to ?? machine.series.length;
  const slice = machine.series.slice(from, end);

  return {
    machineId: id,
    from,
    to: end,
    samples: slice.length,
    series: slice,
  };
}

// Asymmetric check: alarm (critical) wins over warning when both are
// crossed. Upper bounds compare against +devPct, lower bounds against it
// directly (devPct is already signed), so a large negative deviation trips
// the lower bounds rather than being folded into the upper ones via abs().
export function statusForDeviation(devPct: number, thresholds: Thresholds): 'normal' | 'warning' | 'critical' {
  if (devPct >= thresholds.upperAlarm || devPct <= thresholds.lowerAlarm) return 'critical';
  if (devPct >= thresholds.upperWarning || devPct <= thresholds.lowerWarning) return 'warning';
  return 'normal';
}

export function getMachineStatus(id: string) {
  if (!shiftData) initShiftData();
  if (!shiftData) return null;
  const machine = shiftData.machines.find((m: MachineInfo) => m.id === id);
  if (!machine) return null;

  const latest = machine.series[machine.series.length - 1];
  const devPct = ((latest.actual - latest.expected) / latest.expected) * 100;
  const status = statusForDeviation(devPct, machine.thresholds);

  return {
    machineId: id,
    name: machine.name,
    status,
    devPct: Math.round(devPct * 10) / 10,
    actual: latest.actual,
    expected: latest.expected,
    vibration: latest.vibration,
    cycleTime: latest.cycleTime,
    timestamp: latest.timestamp,
  };
}

// Live-demo state: tracks whether each machine is currently in a "spike"
// episode (a temporary excursion into warning/critical territory) so the
// alert + incident pipeline fires naturally as the live data moves. Keyed
// per-machine so multiple machines ticking live don't share one spike timer.
const liveSpikeRemaining = new Map<string, number>();

// Append a new "live" sample to a machine using a bounded random walk around
// its current values, with occasional spikes that push the deviation into
// warning/critical territory. Called per-machine so every machine's trend
// chart moves over time instead of only one looking live while the rest
// stay frozen at their seeded values.
//
// The walk is mean-reverting so it stays plausible between spikes. A spike
// lasts a few ticks, then the machine recovers back toward normal.
export function tickLiveSample(id: string): { machineId: string; sample: Sample; spiked: boolean } | null {
  if (!shiftData) initShiftData();
  if (!shiftData) return null;
  const machine = shiftData.machines.find((m: MachineInfo) => m.id === id);
  if (!machine || machine.series.length === 0) return null;

  const latest = machine.series[machine.series.length - 1];

  // Decide spike state. If not currently spiking, start one occasionally.
  // Odds are per-machine but all machines tick together now, so this is
  // divided down from the original 1-in-12 (tuned for a single machine) to
  // keep the same overall "a fault every ~30s or so" demo pacing now that
  // every machine rolls the dice each tick.
  let remaining = liveSpikeRemaining.get(id) ?? 0;
  let spiked = false;
  if (remaining > 0) {
    remaining -= 1;
    spiked = true;
  } else if (Math.random() < 1 / 72) {
    remaining = 4 + Math.floor(Math.random() * 4); // 4-7 ticks
    spiked = true;
  }
  liveSpikeRemaining.set(id, remaining);

  // Mean-reverting random walk: pull back toward expected, add a random kick.
  const pull = (latest.expected - latest.actual) * 0.15;
  const kick = (Math.random() - 0.5) * 2.4; // ±1.2 around base
  let actual = Math.max(0, latest.actual + pull + kick);

  // During a spike, push actual well above expected so the deviation crosses
  // the warning/critical thresholds and the alert pipeline fires.
  if (spiked) {
    const overshoot = latest.expected * (0.12 + Math.random() * 0.15); // +12%..+27%
    actual = latest.expected + overshoot;
  }

  const vibration = Math.max(0, latest.vibration + (Math.random() - 0.5) * 0.5 + (spiked ? 1.5 : 0));
  const cycleTime = Math.max(0, latest.cycleTime + (Math.random() - 0.5) * 4 + (spiked ? 8 : 0));

  const sample: Sample = {
    timestamp: new Date().toISOString(),
    actual: Math.round(actual * 100) / 100,
    expected: latest.expected,
    vibration: Math.round(vibration * 100) / 100,
    cycleTime: Math.round(cycleTime * 10) / 10,
  };

  machine.series.push(sample);
  // Keep the series bounded so memory doesn't grow unbounded during a long demo.
  if (machine.series.length > 5000) machine.series.shift();

  return { machineId: id, sample, spiked };
}

export interface CreateMachineInput {
  id: string;
  name: string;
  type: string;
  thresholds: Thresholds;
  basePower?: number;
}

export function createMachine(input: CreateMachineInput): MachineInfo | { error: string } {
  if (!shiftData) initShiftData();
  if (!shiftData) return { error: 'Shift data unavailable' };
  if (machineInfos.some((m) => m.id === input.id)) {
    return { error: `Machine ${input.id} already exists` };
  }

  const series = generateMachineSeries({
    id: input.id,
    name: input.name,
    type: input.type,
    base: input.basePower ?? 40,
    warning: input.thresholds.upperWarning,
    critical: input.thresholds.upperAlarm,
  });

  const machine: MachineInfo = {
    id: input.id,
    name: input.name,
    type: input.type,
    thresholds: input.thresholds,
    series,
  };

  shiftData.machines.push(machine);
  const summary: MachineInfo = { ...machine, series: [] };
  machineInfos.push(summary);

  // Persist to BigQuery (best-effort, non-blocking)
  upsertMachine({
    id: input.id,
    name: input.name,
    type: input.type,
    warning: input.thresholds.upperWarning,
    critical: input.thresholds.upperAlarm,
    lowerWarning: input.thresholds.lowerWarning,
    lowerAlarm: input.thresholds.lowerAlarm,
    basePower: input.basePower,
  });

  return summary;
}

export interface UpdateMachineInput {
  name?: string;
  type?: string;
  thresholds?: Thresholds;
}

export function updateMachine(id: string, input: UpdateMachineInput): MachineInfo | null {
  if (!shiftData) initShiftData();
  if (!shiftData) return null;

  const machine = shiftData.machines.find((m) => m.id === id);
  const summary = machineInfos.find((m) => m.id === id);
  if (!machine || !summary) return null;

  if (input.name !== undefined) {
    machine.name = input.name;
    summary.name = input.name;
  }
  if (input.type !== undefined) {
    machine.type = input.type;
    summary.type = input.type;
  }
  if (input.thresholds !== undefined) {
    machine.thresholds = input.thresholds;
    summary.thresholds = input.thresholds;
  }

  // Persist the updated definition to BigQuery (best-effort, non-blocking)
  upsertMachine({
    id,
    name: machine.name,
    type: machine.type,
    warning: machine.thresholds.upperWarning,
    critical: machine.thresholds.upperAlarm,
    lowerWarning: machine.thresholds.lowerWarning,
    lowerAlarm: machine.thresholds.lowerAlarm,
  });

  return summary;
}

export function deleteMachine(id: string): boolean {
  if (!shiftData) initShiftData();
  if (!shiftData) return false;

  const before = machineInfos.length;
  machineInfos = machineInfos.filter((m) => m.id !== id);
  shiftData.machines = shiftData.machines.filter((m) => m.id !== id);

  // Persist the deletion to BigQuery (best-effort, non-blocking)
  deleteMachineRow(id);

  return machineInfos.length < before;
}
