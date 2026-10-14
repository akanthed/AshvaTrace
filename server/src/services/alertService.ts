import { getMachines, getMachineStatus } from './machineService';
import { createIncident } from './incidentService';
import { upsertAlert } from './bigqueryService';

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

export function getAlerts(): Alert[] {
  return Array.from(alerts.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function getAlertsByMachine(machineId: string): Alert[] {
  return getAlerts().filter((a) => a.machineId === machineId);
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

// Check all machines for threshold violations and create alerts
export function checkThresholds(): Alert[] {
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

      const id = `ALR-${Date.now().toString(36).toUpperCase()}-${m.id}`;
      const alert: Alert = {
        id,
        machineId: m.id,
        machineName: m.name,
        severity: status.status as 'warning' | 'critical',
        devPct: status.devPct,
        message:
          status.status === 'critical'
            ? `CRITICAL: ${m.name} power deviation ${status.devPct}% exceeds critical threshold`
            : `WARNING: ${m.name} power deviation ${status.devPct}% exceeds warning threshold`,
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
