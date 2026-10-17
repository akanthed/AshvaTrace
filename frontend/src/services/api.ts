import type { Machine, MachineStatus, MachineSeries, Incident, Alert, ShiftSummary, ThresholdViolation, SystemStatus, DashboardLayout, CostImpact, VisionInspection, PastIncidentSummary, TrackRecord } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Machines
  getMachines: () => fetchJson<Machine[]>('/machines'),
  getMachine: (id: string) => fetchJson<Machine>(`/machines/${id}`),
  getMachineSeries: (id: string, from?: number, to?: number) =>
    fetchJson<MachineSeries>(`/machines/${id}/series?from=${from || 0}${to ? `&to=${to}` : ''}`),
  getMachineStatus: (id: string) => fetchJson<MachineStatus>(`/machines/${id}/status`),
  createMachine: (body: { id: string; name: string; type: string; ip: string; port: number; basePower?: number }) =>
    fetchJson<Machine>('/machines', { method: 'POST', body: JSON.stringify(body) }),
  updateMachine: (id: string, body: Partial<Pick<Machine, 'name' | 'type' | 'thresholds' | 'ip' | 'port'>>) =>
    fetchJson<Machine>(`/machines/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMachine: (id: string) => fetchJson<void>(`/machines/${id}`, { method: 'DELETE' }),

  // Incidents
  getIncidents: () => fetchJson<Incident[]>('/incidents'),
  getIncident: (id: string) => fetchJson<Incident>(`/incidents/${id}`),
  investigateIncident: (id: string, context: any) =>
    fetchJson<Incident>(`/incidents/${id}/investigate`, { method: 'POST', body: JSON.stringify(context) }),
  simulateAction: (id: string, body: any) =>
    fetchJson<Incident>(`/incidents/${id}/simulate`, { method: 'POST', body: JSON.stringify(body) }),
  verifyOutcome: (id: string, body: any) =>
    fetchJson<Incident>(`/incidents/${id}/verify`, { method: 'POST', body: JSON.stringify(body) }),
  getAuditLog: (id: string) => fetchJson<Incident['auditLog']>(`/incidents/${id}/audit`),
  getSimilarIncidents: (id: string) => fetchJson<PastIncidentSummary[]>(`/incidents/${id}/similar`),
  getIncidentsByMachine: (machineId: string) => fetchJson<Incident[]>(`/incidents/machine?machineId=${machineId}`),
  updateIncidentStatus: (id: string, body: { status: string; resolutionComment?: string }) =>
    fetchJson<Incident>(`/incidents/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Analytics
  getShiftSummary: () => fetchJson<ShiftSummary>('/analytics/shift-summary'),
  getThresholdViolations: (machineId?: string) =>
    fetchJson<ThresholdViolation[]>(`/analytics/threshold-violations${machineId ? `?machineId=${machineId}` : ''}`),
  getEnergyReport: () => fetchJson<any>('/analytics/energy-report'),
  getMachineComparison: () => fetchJson<any[]>('/analytics/machine-comparison'),
  getCostImpact: () => fetchJson<CostImpact>('/analytics/cost-impact'),
  getTrackRecord: (machineId?: string) =>
    fetchJson<TrackRecord>(`/analytics/track-record${machineId ? `?machineId=${encodeURIComponent(machineId)}` : ''}`),

  // Alerts
  getAlerts: () => fetchJson<Alert[]>('/alerts'),
  getAlertsByMachine: (id: string) => fetchJson<Alert[]>(`/alerts/machine/${id}`),
  acknowledgeAlert: (id: string, body: { acknowledgedBy: string }) =>
    fetchJson<Alert>(`/alerts/${id}/acknowledge`, { method: 'POST', body: JSON.stringify(body) }),

  // Chat assistant
  askAssistant: (question: string) =>
    fetchJson<{ answer: string; offTopic: boolean }>('/chat/ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  // System
  getSystemStatus: () => fetchJson<SystemStatus>('/system/status'),
  resetDemo: () => fetchJson<{ closed: number; created: number }>('/system/reset-demo', { method: 'POST' }),

  // Dashboard layout (blueprint/photo background + tile position)
  getDashboardLayout: (machineId: string) => fetchJson<DashboardLayout>(`/dashboard-layout/${machineId}`),
  saveDashboardLayout: (machineId: string, body: Partial<Omit<DashboardLayout, 'machineId'>>) =>
    fetchJson<DashboardLayout>(`/dashboard-layout/${machineId}`, { method: 'PUT', body: JSON.stringify(body) }),

  // Vision AI tool inspection
  inspectTool: (machineId: string) => fetchJson<VisionInspection>(`/machines/${machineId}/inspect-tool`, { method: 'POST' }),
};

// SSE connection for real-time alerts
// One shared EventSource for the whole page. Browsers allow only ~6 open
// connections per host on HTTP/1.1, so one stream per component starves
// ordinary fetches (pages hang on "Loading…"). Listeners are ref-counted;
// the stream closes when the last one unsubscribes.
const sseListeners = new Set<(event: any) => void>();
let sseSource: EventSource | null = null;

export function connectSSE(onEvent: (event: any) => void): () => void {
  sseListeners.add(onEvent);

  if (!sseSource) {
    const source = new EventSource(`${BASE_URL}/sse/events`);
    source.onmessage = (e) => {
      let data: any;
      try {
        data = JSON.parse(e.data);
      } catch {
        return; // Ignore parse errors
      }
      sseListeners.forEach((fn) => fn(data));
    };
    // EventSource will auto-reconnect on error
    sseSource = source;
  }

  return () => {
    sseListeners.delete(onEvent);
    if (sseListeners.size === 0 && sseSource) {
      sseSource.close();
      sseSource = null;
    }
  };
}
