import { useEffect, useSyncExternalStore } from 'react';
import type { Machine, MachineStatus } from '../types';
import { api, connectSSE } from '../services/api';
import { statusForDeviation } from '../utils/thresholds';

// Minimum time (ms) a status must persist before it can change, to prevent
// rapid flicker when a machine hovers near a threshold boundary.
const STATUS_MIN_DURATION = 8000;

// Module-level store shared by every useMachines() call, so a refresh
// triggered from one component (e.g. Plant · Machines on the Monitoring
// page) is immediately visible everywhere else (the Sidebar, other open
// machine pages) instead of only updating that component's own state.
interface MachinesState {
  machines: Machine[];
  statuses: Map<string, MachineStatus>;
  loading: boolean;
}

let state: MachinesState = { machines: [], statuses: new Map(), loading: true };
const listeners = new Set<() => void>();
const statusSince = new Map<string, number>();
const severityRank: Record<string, number> = { normal: 0, warning: 1, critical: 2 };

function setState(next: Partial<MachinesState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function applyStatuses(incoming: Map<string, MachineStatus>) {
  const next = new Map(state.statuses);
  const now = Date.now();
  for (const [id, newStatus] of incoming) {
    const existing = next.get(id);
    if (!existing) {
      next.set(id, newStatus);
      statusSince.set(id, now);
      continue;
    }
    if (existing.status === newStatus.status) continue;

    const escalating = severityRank[newStatus.status] > severityRank[existing.status];
    if (escalating) {
      next.set(id, newStatus);
      statusSince.set(id, now);
      continue;
    }

    const since = statusSince.get(id) ?? 0;
    if (now - since >= STATUS_MIN_DURATION) {
      next.set(id, newStatus);
      statusSince.set(id, now);
    }
  }
  setState({ statuses: next });
}

async function fetchMachines() {
  try {
    const data = await api.getMachines();
    setState({ machines: data, loading: false });
  } catch {
    setState({ loading: false });
  }
}

async function fetchStatuses() {
  try {
    const ms = await api.getMachines();
    const statusMap = new Map<string, MachineStatus>();
    for (const m of ms) {
      try {
        statusMap.set(m.id, await api.getMachineStatus(m.id));
      } catch {
        // Skip
      }
    }
    applyStatuses(statusMap);
  } catch {
    // Ignore
  }
}

let started = false;
function ensureStarted() {
  if (started) return;
  started = true;

  fetchMachines();
  fetchStatuses();
  setInterval(fetchStatuses, 5000);

  connectSSE((event: any) => {
    if (event.type === 'liveSample' && event.machineId && event.sample) {
      const s = event.sample;
      const serverStatus = event.status as MachineStatus | undefined;
      if (serverStatus) {
        applyStatuses(new Map([[event.machineId, serverStatus]]));
      } else {
        const devPct = ((s.actual - s.expected) / s.expected) * 100;
        const machine = state.machines.find((m) => m.id === event.machineId);
        const existing = state.statuses.get(event.machineId);
        let status: MachineStatus['status'] = 'normal';
        if (machine) {
          status = statusForDeviation(devPct, machine.thresholds);
        } else if (existing) {
          status = existing.status;
        }
        const derived: MachineStatus = {
          machineId: event.machineId,
          name: existing?.name || machine?.name || event.machineId,
          status,
          devPct: Math.round(devPct * 10) / 10,
          actual: s.actual,
          expected: s.expected,
          vibration: s.vibration,
          cycleTime: s.cycleTime,
          timestamp: s.timestamp,
        };
        applyStatuses(new Map([[event.machineId, derived]]));
      }
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

export function useMachines() {
  useEffect(ensureStarted, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return { machines: snapshot.machines, statuses: snapshot.statuses, loading: snapshot.loading, refresh: fetchMachines };
}
