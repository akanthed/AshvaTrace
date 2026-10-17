import { getMachines, getMachineStatus } from './machineService';
import { createIncident, getIncidentById } from './incidentService';
import { upsertAlert, queryAlerts, AlertRow } from './bigqueryService';

interface Alert {
  id: string;
  machineId: string;
  machineName: string;
  severity: 'warning' | 'critical';
  devPct: number;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  incidentId?: string;
}

const alerts: Map<string, Alert> = new Map();

// Load persisted alerts from BigQuery into the in-memory store on boot so a
// server restart doesn't forget which machine+severity combos are already
// alerted (which would otherwise defeat checkThresholds's dedup check and
// let it recreate an incident for an already-ongoing problem). Alerts for a
// machine that no longer exists are skipped — same reasoning as
// loadPersistedIncidents().
export async function loadPersistedAlerts(): Promise<void> {
  let rows: AlertRow[] = [];
  try {
    rows = await queryAlerts();
  } catch {
    return;
  }
  const liveMachineIds = new Set(getMachines().map((m) => m.id));
  for (const row of rows) {
    if (alerts.has(row.id)) continue;
    if (!liveMachineIds.has(row.machine_id)) continue;
    alerts.set(row.id, {
      id: row.id,
      machineId: row.machine_id,
      machineName: row.machine_name,
      severity: row.severity as Alert['severity'],
      devPct: row.dev_pct,
      message: row.message,
      timestamp: row.timestamp,
      acknowledged: row.acknowledged,
      incidentId: row.incident_id ?? undefined,
    });
  }
  if (rows.length > 0) {
    console.log(`[Init] Loaded ${rows.length} persisted alerts from BigQuery`);
  }
}

export function getAlerts(): Alert[] {
  return Array.from(alerts.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function getAlertsByMachine(machineId: string): Alert[] {
  return getAlerts().filter((a) => a.machineId === machineId);
}

// Remove all in-memory alerts for a machine — called when the machine itself
// is deleted. See deleteIncidentsForMachine() in incidentService for the
// same reasoning.
export function deleteAlertsForMachine(machineId: string): void {
  for (const [id, alert] of alerts) {
    if (alert.machineId === machineId) alerts.delete(id);
  }
}

export function acknowledgeAlert(alertId: string, _body: { acknowledgedBy: string }): Alert | null {
  const alert = alerts.get(alertId);
  if (!alert) return null;
  alert.acknowledged = true;
  // Persist the acknowledgement to BigQuery (best-effort, non-blocking)
  upsertAlert({
    id: alert.id,
    machineId: alert.machineId,
    machineName: alert.machineName,
    severity: alert.severity,
    devPct: alert.devPct,
    message: alert.message,
    timestamp: alert.timestamp,
    acknowledged: alert.acknowledged,
    incidentId: alert.incidentId,
  });
  return alert;
}

// An incident is still "live" in any of these statuses (mirrors
// incidentService's OPEN_STATUSES) — once it leaves this set, the alert
// that opened it no longer describes an active problem.
const INCIDENT_OPEN_STATUSES = ['open', 'investigating', 'action_taken'];

function clearAlert(alert: Alert): void {
  alert.acknowledged = true;
  upsertAlert({
    id: alert.id,
    machineId: alert.machineId,
    machineName: alert.machineName,
    severity: alert.severity,
    devPct: alert.devPct,
    message: alert.message,
    timestamp: alert.timestamp,
    acknowledged: true,
    incidentId: alert.incidentId,
  });
}

// Alerts never get a user-driven "resolved" action — the engineer closes
// the incident, not the alert. Without this, a stale alert would stay
// unacknowledged forever, so checkThresholds's dedup check would never let
// a new alert fire for the next real problem on that machine, and the bell
// badge / critical-alert banner would accumulate stale entries
// indefinitely. Called before the dedup check on every tick so a
// just-resolved problem's alert clears before the next cycle looks for one
// to reuse. Two cases:
//  - Critical alerts carry an incidentId: clear once that incident leaves
//    the open states (verified/closed) or no longer exists.
//  - Warning alerts carry no incidentId (only criticals open an incident):
//    clear once the machine's live reading is no longer at or above
//    warning severity.
function clearAlertsForResolvedIncidents(): void {
  for (const alert of alerts.values()) {
    if (alert.acknowledged) continue;

    if (alert.incidentId) {
      const incident = getIncidentById(alert.incidentId);
      if (!incident || !INCIDENT_OPEN_STATUSES.includes(incident.status)) clearAlert(alert);
      continue;
    }

    const status = getMachineStatus(alert.machineId);
    if (!status || status.status !== alert.severity) clearAlert(alert);
  }
}

let alertSeq = 0;

// Check all machines for threshold violations and create alerts
export function checkThresholds(): Alert[] {
  clearAlertsForResolvedIncidents();
  const machines = getMachines();
  const newAlerts: Alert[] = [];

  for (const m of machines) {
    const status = getMachineStatus(m.id);
    if (!status) continue;

    if (status.status === 'critical' || status.status === 'warning') {
      // Avoid duplicate alerts for the same machine+severity
      const existing = Array.from(alerts.values()).find(
        (a) => a.machineId === m.id && a.severity === status.status && !a.acknowledged
      );
      if (existing) continue;

      // Counter suffix: two alerts for one machine in the same millisecond must not share an id.
      const id = `ALR-${Date.now().toString(36).toUpperCase()}${(alertSeq++).toString(36).toUpperCase()}-${m.id}`;
      const alert: Alert = {
        id,
        machineId: m.id,
        machineName: m.name,
        severity: status.status as 'warning' | 'critical',
        devPct: status.devPct,
        message:
          status.status === 'critical'
            ? `Action required: ${m.name} is using ${Math.abs(status.devPct)}% ${status.devPct >= 0 ? 'more' : 'less'} power than normal`
            : `Watch: ${m.name} is using ${Math.abs(status.devPct)}% ${status.devPct >= 0 ? 'more' : 'less'} power than normal`,
        timestamp: new Date().toISOString(),
        acknowledged: false,
      };

      alerts.set(id, alert);
      newAlerts.push(alert);

      // Create incident for critical alerts
      if (status.status === 'critical') {
        const incident = createIncident(m.id, status.devPct, 'critical');
        alert.incidentId = incident.id;
      }

      // Persist the alert to BigQuery (best-effort, non-blocking)
      upsertAlert({
        id: alert.id,
        machineId: alert.machineId,
        machineName: alert.machineName,
        severity: alert.severity,
        devPct: alert.devPct,
        message: alert.message,
        timestamp: alert.timestamp,
        acknowledged: alert.acknowledged,
        incidentId: alert.incidentId,
      });
    }
  }

  return newAlerts;
}

// Publish alert to Pub/Sub (if configured)
export async function publishAlert(alert: Alert): Promise<void> {
  const topic = process.env.PUBSUB_ALERT_TOPIC;
  if (!topic) return; // Skip if not configured

  try {
    const { PubSub } = await import('@google-cloud/pubsub');
    const pubsub = new PubSub();
    const topicRef = pubsub.topic(topic);
    await topicRef.publishMessage({
      json: {
        alertId: alert.id,
        machineId: alert.machineId,
        severity: alert.severity,
        devPct: alert.devPct,
        message: alert.message,
        timestamp: alert.timestamp,
      },
    });
    console.log(`[PubSub] Alert ${alert.id} published to ${topic}`);
  } catch (err) {
    console.error('[PubSub] Failed to publish alert:', err);
  }
}
