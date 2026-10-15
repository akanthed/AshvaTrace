import { useState, useEffect, useCallback, useRef } from 'react';
import type { Machine, MachineStatus } from '../types';
import { api, connectSSE } from '../services/api';
import { statusForDeviation } from '../utils/thresholds';

// Minimum time (ms) a status must persist before it can change, to prevent
// rapid flicker when a machine hovers near a threshold boundary.
const STATUS_MIN_DURATION = 8000;

export function useMachines() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [statuses, setStatuses] = useState<Map<string, MachineStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  // Track when each machine's current status was last set, to enforce
  // a minimum duration before allowing a status change.
  const statusSinceRef = useRef<Map<string, number>>(new Map());

  const fetchMachines = useCallback(async () => {
    try {
      const data = await api.getMachines();
      setMachines(data);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  const severityRank: Record<string, number> = { normal: 0, warning: 1, critical: 2 };

  const applyStatuses = useCallback((incoming: Map<string, MachineStatus>) => {
    setStatuses((prev) => {
      const next = new Map(prev);
      const now = Date.now();
      for (const [id, newStatus] of incoming) {
        const existing = prev.get(id);
        if (!existing) {
          next.set(id, newStatus);
          statusSinceRef.current.set(id, now);
          continue;
        }
        if (existing.status === newStatus.status) continue;

        // Escalation (normal→warning→critical) is always immediate.
        const escalating = severityRank[newStatus.status] > severityRank[existing.status];
        if (escalating) {
          next.set(id, newStatus);
          statusSinceRef.current.set(id, now);
          continue;
        }

        // De-escalation: only allow if the current status has persisted
        // for at least STATUS_MIN_DURATION.
        const since = statusSinceRef.current.get(id) ?? 0;
        if (now - since >= STATUS_MIN_DURATION) {
          next.set(id, newStatus);
          statusSinceRef.current.set(id, now);
        }
      }
      return next;
    });
  }, []);

  const fetchStatuses = useCallback(async () => {
    try {
      const ms = await api.getMachines();
      const statusMap = new Map<string, MachineStatus>();
      for (const m of ms) {
        try {
          const status = await api.getMachineStatus(m.id);
          statusMap.set(m.id, status);
        } catch {
          // Skip
        }
      }
      applyStatuses(statusMap);
    } catch {
      // Ignore
    }
  }, [applyStatuses]);

  useEffect(() => {
    fetchMachines();
    fetchStatuses();

    // Poll statuses every 5 seconds
    const interval = setInterval(fetchStatuses, 5000);

    // Live demo feed: when the server pushes a new sample for a machine,
    // update that machine's status immediately (no waiting for the 5s poll).
    // The server now sends the computed status directly, so we use it as-is.
    const disconnect = connectSSE((event: any) => {
      if (event.type === 'liveSample' && event.machineId && event.sample) {
        const s = event.sample;
        const serverStatus = event.status as MachineStatus | undefined;
        if (serverStatus) {
          applyStatuses(new Map([[event.machineId, serverStatus]]));
        } else {
          // Fallback: derive status from the sample if the server didn't send one.
          const devPct = ((s.actual - s.expected) / s.expected) * 100;
          const machine = machines.find((m) => m.id === event.machineId);
          const existing = statuses.get(event.machineId);
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

    return () => {
      clearInterval(interval);
      disconnect();
    };
  }, [fetchMachines, fetchStatuses, machines]);

  return { machines, statuses, loading, refresh: fetchMachines };
}
