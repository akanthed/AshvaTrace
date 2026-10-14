import { useState, useEffect, useCallback } from 'react';
import type { Machine, MachineStatus } from '../types';
import { api, connectSSE } from '../services/api';
import { statusForDeviation } from '../utils/thresholds';

export function useMachines() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [statuses, setStatuses] = useState<Map<string, MachineStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  const fetchMachines = useCallback(async () => {
    try {
      const data = await api.getMachines();
      setMachines(data);
      setLoading(false);
    } catch {
      setLoading(false);
    }
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
      setStatuses(statusMap);
    } catch {
      // Ignore
    }
  }, []);

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
          setStatuses((prev) => {
            const nextMap = new Map(prev);
            nextMap.set(event.machineId, serverStatus);
            return nextMap;
          });
        } else {
          // Fallback: derive status from the sample if the server didn't send one.
          const devPct = ((s.actual - s.expected) / s.expected) * 100;
          setStatuses((prev) => {
            const existing = prev.get(event.machineId);
            const machine = machines.find((m) => m.id === event.machineId);
            let status: MachineStatus['status'] = 'normal';
            if (machine) {
              status = statusForDeviation(devPct, machine.thresholds);
            } else if (existing) {
              status = existing.status;
            }
            const next: MachineStatus = {
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
            const nextMap = new Map(prev);
            nextMap.set(event.machineId, next);
            return nextMap;
          });
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
