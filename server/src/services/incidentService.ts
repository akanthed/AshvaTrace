import { investigate, simulate, verify } from '../utils/ai';
import { getMachineById, getMachineStatus } from './machineService';
import { upsertIncident, queryIncidents, IncidentRow } from './bigqueryService';

interface Incident {
  id: string;
  machineId: string;
  machineName: string;
  status: 'open' | 'investigating' | 'action_taken' | 'verified' | 'closed';
  detectedAt: string;
  severity: 'warning' | 'critical';
  devPct: number;
  hypotheses: Hypothesis[];
  selectedHypothesis?: string;
  simulation?: SimulationResult;
  verification?: VerificationResult;
  auditLog: AuditEntry[];
}

interface Hypothesis {
  id: string;
  title: string;
  confidence: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
}

interface SimulationResult {
  action: string;
  predictedOutcome: string;
  confidence: number;
}

interface VerificationResult {
  passed: boolean;
  actualOutcome: string;
  metrics: Record<string, number>;
}

interface AuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  details: string;
}

// In-memory incident store
const incidents: Map<string, Incident> = new Map();

// Persist an incident to BigQuery (best-effort, non-blocking).
function persistIncident(incident: Incident): void {
  upsertIncident({
    id: incident.id,
    machineId: incident.machineId,
    machineName: incident.machineName,
    status: incident.status,
    severity: incident.severity,
    devPct: incident.devPct,
    detectedAt: incident.detectedAt,
    hypotheses: incident.hypotheses,
    selectedHypothesis: incident.selectedHypothesis,
    simulation: incident.simulation,
    verification: incident.verification,
    auditLog: incident.auditLog,
  });
}

// Load persisted incidents from BigQuery into the in-memory store on boot so
// the investigation history survives a server restart.
export async function loadPersistedIncidents(): Promise<void> {
  let rows: IncidentRow[] = [];
  try {
    rows = await queryIncidents();
  } catch {
    return;
  }
  for (const row of rows) {
    if (incidents.has(row.id)) continue;
    const incident: Incident = {
      id: row.id,
      machineId: row.machine_id,
      machineName: row.machine_name,
      status: row.status as Incident['status'],
      detectedAt: row.detected_at,
      severity: row.severity as Incident['severity'],
      devPct: row.dev_pct,
      hypotheses: row.hypotheses ? JSON.parse(row.hypotheses) : [],
      selectedHypothesis: row.selected_hypothesis ?? undefined,
      simulation: row.simulation ? JSON.parse(row.simulation) : undefined,
      verification: row.verification ? JSON.parse(row.verification) : undefined,
      auditLog: row.audit_log ? JSON.parse(row.audit_log) : [],
    };
    incidents.set(incident.id, incident);
  }
  if (rows.length > 0) {
    console.log(`[Init] Loaded ${rows.length} persisted incidents from BigQuery`);
  }
}

export function getIncidents(): Incident[] {
  return Array.from(incidents.values());
}

export function getIncidentById(id: string): Incident | null {
  return incidents.get(id) || null;
}

// An incident is still "live" (not yet resolved) in any of these statuses.
const OPEN_STATUSES: Incident['status'][] = ['open', 'investigating', 'action_taken'];

export function getOpenIncidentForMachine(machineId: string): Incident | null {
  for (const incident of incidents.values()) {
    if (incident.machineId === machineId && OPEN_STATUSES.includes(incident.status)) {
      return incident;
    }
  }
  return null;
}

export async function investigateIncident(
  incidentId: string,
  context: { machineId: string; devPct: number; signals: Record<string, number> }
): Promise<Incident> {
  const incident = incidents.get(incidentId);
  if (!incident) throw new Error('Incident not found');

  incident.status = 'investigating';
  incident.auditLog.push({
    timestamp: new Date().toISOString(),
    actor: 'system',
    action: 'investigation_started',
    details: `AI investigation initiated for ${incident.machineName}`,
  });

  // Enrich the context with the machine's REAL current readings so the AI
  // reasons over live signal data, not hardcoded constants.
  const status = getMachineStatus(incident.machineId);
  const enrichedContext = {
    ...context,
    signals: {
      ...context.signals,
      ...(status
        ? {
            powerDevPct: status.devPct,
            actualPower: status.actual,
            expectedPower: status.expected,
          }
        : {}),
    },
  };

  // Call AI for hypothesis generation. On failure, revert to 'open' (not
  // stuck labeled "investigating" with no hypotheses) and record the real
  // failure in the audit log — never substitute canned content for a failed
  // call, since that would be indistinguishable from genuine AI output.
  let hypotheses;
  try {
    hypotheses = await investigate(enrichedContext);
  } catch (err: any) {
    incident.status = 'open';
    incident.auditLog.push({
      timestamp: new Date().toISOString(),
      actor: 'system',
      action: 'investigation_failed',
      details: `AI investigation failed: ${err.message || err}`,
    });
    persistIncident(incident);
    throw err;
  }
  incident.hypotheses = hypotheses;

  incident.auditLog.push({
    timestamp: new Date().toISOString(),
    actor: 'ai',
    action: 'hypotheses_generated',
    details: `${hypotheses.length} hypotheses generated`,
  });

  persistIncident(incident);
  return incident;
}

export async function simulateAction(
  incidentId: string,
  body: { hypothesisId: string; action: string }
): Promise<Incident> {
  const incident = incidents.get(incidentId);
  if (!incident) throw new Error('Incident not found');

  const hypothesis = incident.hypotheses.find((h) => h.id === body.hypothesisId);
  if (!hypothesis) throw new Error('Hypothesis not found');

  incident.selectedHypothesis = body.hypothesisId;

  // Call AI for simulation. On failure, don't advance status or store a
  // simulation result — same honesty principle as investigateIncident.
  let simulation;
  try {
    simulation = await simulate({
      machineId: incident.machineId,
      hypothesis: hypothesis.title,
      action: body.action,
    });
  } catch (err: any) {
    incident.auditLog.push({
      timestamp: new Date().toISOString(),
      actor: 'system',
      action: 'simulation_failed',
      details: `AI simulation failed: ${err.message || err}`,
    });
    persistIncident(incident);
    throw err;
  }
  incident.status = 'action_taken';
  incident.simulation = simulation;

  incident.auditLog.push({
    timestamp: new Date().toISOString(),
    actor: 'engineer',
    action: 'action_simulated',
    details: `Action: ${body.action} (hypothesis: ${hypothesis.title})`,
  });

  persistIncident(incident);
  return incident;
}

export async function verifyOutcome(
  incidentId: string,
  body: { actualMetrics: Record<string, number> }
): Promise<Incident> {
  const incident = incidents.get(incidentId);
  if (!incident) throw new Error('Incident not found');
  if (!incident.simulation) throw new Error('No simulation to verify');

  // Use the machine's REAL current readings when the client doesn't supply
  // explicit metrics, so verification reflects live state rather than fixed
  // numbers. The client can still override with explicit actualMetrics.
  const status = getMachineStatus(incident.machineId);
  const actualMetrics: Record<string, number> =
    body.actualMetrics && Object.keys(body.actualMetrics).length > 0
      ? body.actualMetrics
      : status
        ? {
            powerDevPct: status.devPct,
            vibrationMmS: status.vibration ?? 0,
            cycleTimeSec: status.cycleTime ?? 0,
          }
        : {};

  // Deterministic verification (NOT AI)
  const verification = verify(incident.simulation, actualMetrics);
  incident.verification = verification;
  incident.status = verification.passed ? 'verified' : 'open';

  incident.auditLog.push({
    timestamp: new Date().toISOString(),
    actor: 'system',
    action: 'outcome_verified',
    details: verification.passed ? 'PASS: Metrics within expected range' : 'FAIL: Metrics outside expected range',
  });

  persistIncident(incident);
  return incident;
}

export function getAuditLog(incidentId: string): AuditEntry[] {
  const incident = incidents.get(incidentId);
  if (!incident) return [];
  return incident.auditLog;
}

// Create a new incident (called by alert system). Reuses the machine's
// existing open incident instead of creating a duplicate — a restart that
// forgets the in-memory alert dedup set (see alertService) would otherwise
// spawn a fresh incident every time the threshold check re-fires for the
// same ongoing problem.
export function createIncident(machineId: string, devPct: number, severity: 'warning' | 'critical'): Incident {
  const existing = getOpenIncidentForMachine(machineId);
  if (existing) return existing;

  const machine = getMachineById(machineId);
  const id = `INC-${Date.now().toString(36).toUpperCase()}`;

  const incident: Incident = {
    id,
    machineId,
    machineName: machine?.name || machineId,
    status: 'open',
    detectedAt: new Date().toISOString(),
    severity,
    devPct,
    hypotheses: [],
    auditLog: [
      {
        timestamp: new Date().toISOString(),
        actor: 'system',
        action: 'incident_detected',
        details: `Deviation ${devPct}% detected on ${machine?.name || machineId}`,
      },
    ],
  };

  incidents.set(id, incident);
  persistIncident(incident);
  return incident;
}
