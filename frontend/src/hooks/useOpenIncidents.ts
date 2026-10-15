import { useEffect, useSyncExternalStore } from 'react';
import type { Incident } from '../types';
import { api, connectSSE } from '../services/api';

// Open incidents, derived from actual incident status (not from the alert
// log, which only ever grows and never reflects an incident being resolved
// — see TopBar/LaunchView, which used to pick "the first critical alert"
// and could point at an incident that was closed hours ago).
interface OpenIncidentsState {
  incidents: Incident[];
  loading: boolean;
}

let state: OpenIncidentsState = { incidents: [], loading: true };
const listeners = new Set<() => void>();

function setState(next: Partial<OpenIncidentsState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

async function fetchIncidents() {
  try {
    const all = await api.getIncidents();
    setState({ incidents: all.filter((i) => i.status !== 'closed'), loading: false });
  } catch {
    setState({ loading: false });
  }
}

let started = false;
function ensureStarted() {
  if (started) return;
  started = true;

  fetchIncidents();
  setInterval(fetchIncidents, 10000);

  connectSSE((event: any) => {
    if (event.type === 'incidentUpdated' && event.incident) {
      const incident: Incident = event.incident;
      setState({
        incidents:
          incident.status === 'closed'
            ? state.incidents.filter((i) => i.id !== incident.id)
            : [incident, ...state.incidents.filter((i) => i.id !== incident.id)],
      });
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

export function useOpenIncidents() {
  useEffect(ensureStarted, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return { incidents: snapshot.incidents, loading: snapshot.loading };
}
