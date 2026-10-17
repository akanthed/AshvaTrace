import { generateShiftData, generateMachineSeries, ShiftData, MachineInfo, Sample, Thresholds } from '../utils/synthetic';
import { isIP } from 'net';
import { upsertMachine, deleteMachineRow, queryMachines, queryDeletedMachineIds, MachineRow } from './bigqueryService';

// In-memory store for the current shift
let shiftData: ShiftData | null = null;
let machineInfos: MachineInfo[] = [];

// Demo machines get a plausible gateway address (OPC UA's standard port 4840) so the Plant
// page shows what a real setup looks like. The app never connects to any address.
const DEFAULT_ADDRESSES: Record<string, { ip: string; port: number }> = {
  'CNC-01': { ip: '192.168.10.11', port: 4840 },
  'CNC-02': { ip: '192.168.10.12', port: 4840 },
  'CNC-03': { ip: '192.168.10.13', port: 4840 },
  'LATHE-01': { ip: '192.168.10.21', port: 4840 },
  'GRD-01': { ip: '192.168.10.31', port: 4840 },
  'PRS-01': { ip: '192.168.20.11', port: 4840 },
};

// Check an address typed by a person. Returns an error message in plain words, or null if OK.
// Only a syntax check: the server never opens a connection to the address.
export function validateAddress(ip: unknown, port: unknown): string | null {
  if (typeof ip !== 'string' || ip.trim() === '') return 'Enter the IP address of the machine';
  if (isIP(ip.trim()) === 0) return 'That is not a valid IP address (example: 192.168.10.15)';
  const p = typeof port === 'string' ? Number(port) : port;
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > 65535) {
    return 'Port must be a whole number from 1 to 65535 (example: 4840)';
  }
  return null;
}

// Another machine already using this ip:port, if any.
export function findAddressOwner(ip: string, port: number, exceptId?: string): MachineInfo | null {
  return machineInfos.find((m) => m.id !== exceptId && m.ip === ip.trim() && m.port === port) || null;
}

// Each machine's original demo condition, so a demo reset can put it back.
const originalTargets = new Map<string, number>();

export function initShiftData() {
  const result = generateShiftData();
  shiftData = result.data;
  machineInfos = result.machines;
  originalTargets.clear();
  for (const m of shiftData.machines) {
    originalTargets.set(m.id, m.targetDevPct ?? 0);
    const addr = DEFAULT_ADDRESSES[m.id];
    if (addr) {
      m.ip = addr.ip;
      m.port = addr.port;
      const summary = machineInfos.find((x) => x.id === m.id);
      if (summary) {
        summary.ip = addr.ip;
        summary.port = addr.port;
      }
    }
  }
  return result;
}

// Load persisted machine definitions from BigQuery and merge them into the
// in-memory store. Machines that exist in BigQuery but not in the seeded set
// (i.e. ones the user added) are regenerated with a fresh series.
//
// Seeded machines are NEVER removed merely for being absent from
// queryMachines()'s result — a seeded machine (e.g. CNC-02, CNC-03) has no
// BigQuery row at all until its first edit, so "not in BigQuery" does not
// mean "deleted". queryMachines() already excludes tombstoned (deleted=true)
// rows, so the only way a machine is actually gone is an explicit delete,
// which deleteMachine() already applies in-memory immediately — this loader
// does not need to (and must not) re-derive deletion from absence.
export async function loadPersistedMachines(): Promise<void> {
  if (!shiftData) initShiftData();
  if (!shiftData) return;

  let rows: MachineRow[] = [];
  try {
    rows = await queryMachines();
  } catch {
    return; // BigQuery unavailable — keep the seeded in-memory set
  }

  // Remove seeded machines the user explicitly deleted via the UI (an actual
  // tombstone row), not merely machines absent from BigQuery entirely.
  let deletedIds: string[] = [];
  try {
    deletedIds = await queryDeletedMachineIds();
  } catch {
    // Non-fatal — worst case a previously-deleted seeded machine reappears
  }
  if (deletedIds.length > 0) {
    const deletedSet = new Set(deletedIds);
    shiftData.machines = shiftData.machines.filter((m) => !deletedSet.has(m.id));
    machineInfos = machineInfos.filter((m) => !deletedSet.has(m.id));
  }

  if (rows.length === 0) return; // Nothing persisted yet

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
      if (row.ip_address) existing.ip = row.ip_address;
      if (row.port) existing.port = row.port;
      const summary = machineInfos.find((m) => m.id === row.id);
      if (summary) {
        summary.name = row.name;
        summary.type = row.type;
        summary.thresholds = thresholds;
        if (row.ip_address) summary.ip = row.ip_address;
        if (row.port) summary.port = row.port;
      }
    } else {
      const series = generateMachineSeries(def);
      const machine: MachineInfo = {
        id: row.id,
        name: row.name,
        type: row.type,
        thresholds,
        series,
        ip: row.ip_address ?? undefined,
        port: row.port ?? undefined,
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

// Append a new "live" sample to a machine. Each machine is pinned to a target
// deviation band (see MachineInfo.targetDevPct) so it holds its condition for
// the whole demo: the walk mean-reverts toward the target offset and adds a
// small random kick, so the values keep changing but the machine never drifts
// out of its Normal / Warning / Action state.
export function tickLiveSample(id: string): { machineId: string; sample: Sample; spiked: boolean } | null {
  if (!shiftData) initShiftData();
  if (!shiftData) return null;
  const machine = shiftData.machines.find((m: MachineInfo) => m.id === id);
  if (!machine || machine.series.length === 0) return null;

  const latest = machine.series[machine.series.length - 1];
  const targetDevPct = machine.targetDevPct ?? 0;

  // The actual power we want to sit at: expected plus the target offset.
  const targetActual = latest.expected * (1 + targetDevPct / 100);

  // Mean-revert toward the target, add a small random kick so the line moves.
  const pull = (targetActual - latest.actual) * 0.3;
  const kick = (Math.random() - 0.5) * 1.6; // ±0.8 kW wobble
  const actual = Math.max(0, latest.actual + pull + kick);

  // Vibration and cycle time also mean-revert toward a level that matches the
  // machine's condition (hotter when it's in warning/action).
  const vibTarget = targetDevPct >= 10 ? 4.0 : targetDevPct >= 5 ? 3.2 : 2.0;
  const ctTarget = 90 + (targetDevPct >= 10 ? 25 : targetDevPct >= 5 ? 12 : 0);
  const vibration = Math.max(0, latest.vibration + (vibTarget - latest.vibration) * 0.3 + (Math.random() - 0.5) * 0.4);
  const cycleTime = Math.max(0, latest.cycleTime + (ctTarget - latest.cycleTime) * 0.3 + (Math.random() - 0.5) * 3);

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

  // `spiked` is kept for API compatibility; it's now just "is this machine in
  // a non-normal condition" so the auto-investigate trigger still works.
  const devPct = ((actual - latest.expected) / latest.expected) * 100;
  const spiked = devPct >= machine.thresholds.upperWarning || devPct <= machine.thresholds.lowerWarning;

  return { machineId: id, sample, spiked };
}

// Demo-only: model what happens on the simulated machine once an engineer
// applies a fix. The machine's target condition drops to healthy and a burst of
// samples lets the readings settle, so the next status read reflects the
// recovery. Only called when the fix addressed the right cause; a wrong fix
// leaves the machine untouched.
export function applySimulatedFix(id: string): boolean {
  if (!shiftData) initShiftData();
  const machine = shiftData?.machines.find((m: MachineInfo) => m.id === id);
  if (!machine || machine.series.length === 0) return false;
  machine.targetDevPct = 0;
  for (let i = 0; i < 30; i++) tickLiveSample(id);
  return true;
}

// Demo reset: put every machine back into its original condition (including ones a
// simulated fix had healed) and let the readings settle there.
export function resetMachineConditions(): void {
  if (!shiftData) initShiftData();
  if (!shiftData) return;
  for (const m of shiftData.machines) {
    if (originalTargets.has(m.id)) m.targetDevPct = originalTargets.get(m.id);
    if (m.series.length > 0) for (let i = 0; i < 30; i++) tickLiveSample(m.id);
  }
}

export interface CreateMachineInput {
  id: string;
  name: string;
  type: string;
  thresholds: Thresholds;
  basePower?: number;
  ip?: string;
  port?: number;
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
    ip: input.ip?.trim(),
    port: input.port,
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
    ip: input.ip?.trim(),
    port: input.port,
  });

  return summary;
}

export interface UpdateMachineInput {
  name?: string;
  type?: string;
  thresholds?: Thresholds;
  ip?: string;
  port?: number;
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
  if (input.ip !== undefined && input.port !== undefined) {
    machine.ip = summary.ip = input.ip.trim();
    machine.port = summary.port = input.port;
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
    ip: machine.ip,
    port: machine.port,
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
