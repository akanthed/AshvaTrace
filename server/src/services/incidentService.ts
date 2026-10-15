import { investigate, critiqueHypotheses, simulate, verify, investigateAgentic, inspectToolImage, InvestigationTraceStep } from '../utils/ai';
import { getMachineById, getMachineStatus, getMachineSeries } from './machineService';
import { upsertIncident, queryIncidents, IncidentRow } from './bigqueryService';
import { retrieveSops, getSopById } from './sopService';

interface Incident {
  id: string;
  machineId: string;
  machineName: string;
  status: 'open' | 'investigating' | 'action_taken' | 'verified' | 'closed';
  detectedAt: string;
  severity: 'warning' | 'critical';
  devPct: number;
  hypotheses: Hypothesis[];
  investigationTrace?: InvestigationTraceStep[];
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
  sopRef?: string | null;
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

// ---------------------------------------------------------------------------
// Past-incident retrieval: find previously resolved incidents on the same
// machine so the AI can reference what was tried before and what worked.
// ---------------------------------------------------------------------------

export interface PastIncidentSummary {
  id: string;
  detectedAt: string;
  devPct: number;
  severity: string;
  status: string;
  topHypothesis: string | null;
  actionTaken: string | null;
  verificationPassed: boolean | null;
  resolutionComment: string | null;
}

/**
 * Find past resolved incidents on the same machine, ranked by how similar
 * their deviation was to the current incident. Returns at most `limit`
 * incidents (default 3), most similar first.
 */
export function findSimilarIncidents(
  machineId: string,
  currentDevPct: number,
  excludeId?: string,
  limit = 3
): PastIncidentSummary[] {
  const resolved: Incident[] = [];
  for (const inc of incidents.values()) {
    if (inc.machineId !== machineId) continue;
    if (inc.id === excludeId) continue;
    // Only include incidents that reached a terminal state with a resolution
    if (inc.status !== 'verified' && inc.status !== 'closed') continue;
    resolved.push(inc);
  }

  if (resolved.length === 0) return [];

  // Rank by deviation similarity (closer devPct = more similar), then by
  // recency as a tiebreaker.
  resolved.sort((a, b) => {
    const devDiff = Math.abs(a.devPct - currentDevPct) - Math.abs(b.devPct - currentDevPct);
    if (devDiff !== 0) return devDiff;
    return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
  });

  return resolved.slice(0, limit).map((inc) => {
    // Extract the top hypothesis (highest confidence)
    const topHyp = inc.hypotheses.length > 0
      ? inc.hypotheses.reduce((best, h) => (h.confidence > best.confidence ? h : best), inc.hypotheses[0])
      : null;

    // Extract the action from the simulation
    const actionTaken = inc.simulation?.action || null;

    // Verification result
    const verificationPassed = inc.verification ? inc.verification.passed : null;

    // Resolution comment from the last audit entry that mentions resolution
    let resolutionComment: string | null = null;
    for (let i = inc.auditLog.length - 1; i >= 0; i--) {
      const entry = inc.auditLog[i];
      if (entry.action === 'incident_resolved' || entry.action === 'status_changed') {
        if (entry.details && !entry.details.startsWith('Status changed to')) {
          resolutionComment = entry.details.replace(/^Status → \w+: /, '');
        }
        break;
      }
    }

    return {
      id: inc.id,
      detectedAt: inc.detectedAt,
      devPct: inc.devPct,
      severity: inc.severity,
      status: inc.status,
      topHypothesis: topHyp?.title || null,
      actionTaken,
      verificationPassed,
      resolutionComment,
    };
  });
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

  // Deterministic retrieval (not AI): pick the SOP excerpts relevant to this
  // incident's signals so the model reasons over real reference text instead
  // of its own memory of what an SOP might say.
  const sops = await retrieveSops(enrichedContext.signals);

  // Retrieve past resolved incidents on this machine so the AI can reference
  // what was tried before and what worked — "last time this pattern appeared,
  // the fix was X and verification confirmed it."
  const pastIncidents = findSimilarIncidents(incident.machineId, incident.devPct, incident.id);

  // Agentic investigation: the model calls tools to pull REAL readings from
  // the machine's series before forming hypotheses (see investigateAgentic
  // in utils/ai.ts). The trace of tool calls + results is stored on the
  // incident so the UI can show the investigation step by step. On failure,
  // revert to 'open' and record the real failure in the audit log — never
  // substitute canned content for a failed call.
  const machineId = incident.machineId;
  const toolExecutor = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const series = getMachineSeries(machineId, 0);
    if (!series) throw new Error(`No series data for machine ${machineId}`);
    const n = Math.min(Math.max(parseInt(String(args.samples || 60), 10) || 60, 10), 480);
    const window = series.series.slice(-n);

    switch (name) {
      case 'get_power_window': {
        const samples = window.map((s) => ({
          timestamp: s.timestamp,
          actualKw: s.actual,
          expectedKw: s.expected,
          devPct: Math.round(((s.actual - s.expected) / s.expected) * 1000) / 10,
        }));
        // Return a summary + the last 20 samples to keep the context small.
        const devs = samples.map((s) => s.devPct);
        return {
          windowSamples: samples.length,
          firstDevPct: devs[0],
          lastDevPct: devs[devs.length - 1],
          maxDevPct: Math.max(...devs),
          minDevPct: Math.min(...devs),
          trend: devs[devs.length - 1] > devs[0] + 1 ? 'rising' : devs[0] - 1 > devs[devs.length - 1] ? 'falling' : 'flat',
          recentSamples: samples.slice(-20),
        };
      }
      case 'get_vibration_stats': {
        const vibs = window.map((s) => s.vibration);
        const half = Math.floor(vibs.length / 2);
        const firstAvg = vibs.slice(0, half).reduce((a, b) => a + b, 0) / half;
        const secondAvg = vibs.slice(half).reduce((a, b) => a + b, 0) / (vibs.length - half);
        return {
          currentMmS: vibs[vibs.length - 1],
          minMmS: Math.min(...vibs),
          maxMmS: Math.max(...vibs),
          avgMmS: Math.round((vibs.reduce((a, b) => a + b, 0) / vibs.length) * 100) / 100,
          trendingUp: secondAvg > firstAvg * 1.1,
          healthyBelowMmS: 3,
        };
      }
      case 'get_cycle_time_trend': {
        const times = window.map((s) => s.cycleTime);
        const baseline = times.slice(0, Math.floor(times.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(times.length / 2);
        const recent = times.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ratePerSample = (recent - baseline) / 10;
        return {
          currentSec: times[times.length - 1],
          baselineSec: Math.round(baseline * 10) / 10,
          recentAvgSec: Math.round(recent * 10) / 10,
          ratePerSampleSec: Math.round(ratePerSample * 100) / 100,
          slowingDown: recent > baseline * 1.05,
        };
      }
      case 'inspect_tool': {
        const wearLevel = Math.min(Math.max(parseInt(String(args.wearLevel || 50), 10) || 50, 0), 100);
        return inspectToolImage(machineId, wearLevel);
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  let hypotheses;
  let trace: InvestigationTraceStep[] = [];
  try {
    const agentic = await investigateAgentic(enrichedContext, sops, toolExecutor, pastIncidents);
    hypotheses = await critiqueHypotheses(enrichedContext, agentic.hypotheses, sops);
    trace = agentic.trace;
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
  incident.investigationTrace = trace;

  incident.auditLog.push({
    timestamp: new Date().toISOString(),
    actor: 'ai',
    action: 'hypotheses_generated',
    details: `${hypotheses.length} hypotheses generated via ${trace.filter((t) => t.type === 'tool_call').length} tool calls, grounded in ${sops.map((s) => s.id).join(', ') || 'no SOP match'}, cross-checked by a second review pass`,
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
    const postActionSop = await getSopById('SOP-103');
    simulation = await simulate(
      {
        machineId: incident.machineId,
        hypothesis: hypothesis.title,
        action: body.action,
      },
      postActionSop
    );
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

const VALID_TRANSITIONS: Record<Incident['status'], Incident['status'][]> = {
  open: ['investigating', 'closed'],
  investigating: ['action_taken', 'open', 'closed'],
  action_taken: ['verified', 'open', 'closed'],
  verified: ['closed'],
  closed: [],
};

export function updateIncidentStatus(
  incidentId: string,
  newStatus: Incident['status'],
  resolutionComment?: string
): Incident | null {
  const incident = incidents.get(incidentId);
  if (!incident) return null;

  const allowed = VALID_TRANSITIONS[incident.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Cannot transition from '${incident.status}' to '${newStatus}'. Allowed: ${allowed.join(', ')}`);
  }

  incident.status = newStatus;
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    actor: 'engineer',
    action: newStatus === 'closed' ? 'incident_resolved' : 'status_changed',
    details: resolutionComment
      ? `Status → ${newStatus}: ${resolutionComment}`
      : `Status changed to ${newStatus}`,
  };
  incident.auditLog.push(entry);
  persistIncident(incident);
  return incident;
}
