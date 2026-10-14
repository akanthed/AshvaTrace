import { BigQuery } from '@google-cloud/bigquery';

// Lazy-initialized: this module is transitively imported (via routes) before
// dotenv.config() runs in index.ts, so reading process.env.GCP_PROJECT_ID at
// module load time would freeze it as undefined.
let bigquery: BigQuery | null = null;
function client(): BigQuery {
  if (!bigquery) bigquery = new BigQuery({ projectId: process.env.GCP_PROJECT_ID });
  return bigquery;
}

function datasetName() {
  return process.env.BIGQUERY_DATASET || 'ashvatrace';
}
const TABLE = 'machine_readings';
const MACHINES_TABLE = 'machines';
const INCIDENTS_TABLE = 'incidents';
const ALERTS_TABLE = 'alerts';
const DASHBOARD_LAYOUTS_TABLE = 'dashboard_layouts';

// Initialize BigQuery dataset and all tables
export async function initBigQuery(): Promise<void> {
  try {
    const dataset = client().dataset(datasetName());
    await dataset.create().catch(() => {}); // Ignore if exists

    const table = dataset.table(TABLE);
    await table.create({
      schema: [
        { name: 'machine_id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
        { name: 'actual_power', type: 'FLOAT64', mode: 'REQUIRED' },
        { name: 'expected_power', type: 'FLOAT64', mode: 'REQUIRED' },
        { name: 'vibration', type: 'FLOAT64', mode: 'REQUIRED' },
        { name: 'cycle_time', type: 'FLOAT64', mode: 'REQUIRED' },
        { name: 'deviation_pct', type: 'FLOAT64', mode: 'REQUIRED' },
      ],
    }).catch(() => {}); // Ignore if exists

    // Machines: append-only event log of machine definitions. Current state
    // is resolved by taking the latest row per id (see queryMachines).
    // warning/critical are kept as the upper bounds for backward compatibility
    // with existing rows; lower_warning/lower_alarm are new and nullable so
    // old rows (pre-dating asymmetric thresholds) fall back to the negative
    // mirror of the upper bounds on read.
    await dataset.table(MACHINES_TABLE).create({
      schema: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'name', type: 'STRING', mode: 'REQUIRED' },
        { name: 'type', type: 'STRING', mode: 'REQUIRED' },
        { name: 'warning', type: 'FLOAT64', mode: 'REQUIRED' },
        { name: 'critical', type: 'FLOAT64', mode: 'REQUIRED' },
        { name: 'lower_warning', type: 'FLOAT64', mode: 'NULLABLE' },
        { name: 'lower_alarm', type: 'FLOAT64', mode: 'NULLABLE' },
        { name: 'base_power', type: 'FLOAT64', mode: 'NULLABLE' },
        { name: 'deleted', type: 'BOOLEAN', mode: 'NULLABLE' },
        { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
      ],
    }).catch(() => {});

    // Incidents: durable store for the investigation lifecycle
    await dataset.table(INCIDENTS_TABLE).create({
      schema: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'machine_id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'machine_name', type: 'STRING', mode: 'REQUIRED' },
        { name: 'status', type: 'STRING', mode: 'REQUIRED' },
        { name: 'severity', type: 'STRING', mode: 'REQUIRED' },
        { name: 'dev_pct', type: 'FLOAT64', mode: 'REQUIRED' },
        { name: 'detected_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
        { name: 'hypotheses', type: 'STRING', mode: 'NULLABLE' },
        { name: 'selected_hypothesis', type: 'STRING', mode: 'NULLABLE' },
        { name: 'simulation', type: 'STRING', mode: 'NULLABLE' },
        { name: 'verification', type: 'STRING', mode: 'NULLABLE' },
        { name: 'audit_log', type: 'STRING', mode: 'NULLABLE' },
        { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
      ],
    }).catch(() => {});

    // Alerts: durable store for threshold alerts
    await dataset.table(ALERTS_TABLE).create({
      schema: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'machine_id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'machine_name', type: 'STRING', mode: 'REQUIRED' },
        { name: 'severity', type: 'STRING', mode: 'REQUIRED' },
        { name: 'dev_pct', type: 'FLOAT64', mode: 'REQUIRED' },
        { name: 'message', type: 'STRING', mode: 'REQUIRED' },
        { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
        { name: 'acknowledged', type: 'BOOLEAN', mode: 'REQUIRED' },
        { name: 'incident_id', type: 'STRING', mode: 'NULLABLE' },
        { name: 'updated_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
      ],
    }).catch(() => {});

    // Dashboard layouts: the uploaded blueprint/photo image (as a base64 data
    // URL) plus the saved pixel position of the Active power tile on it.
    await dataset.table(DASHBOARD_LAYOUTS_TABLE).create({
      schema: [
        { name: 'machine_id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'image_data_url', type: 'STRING', mode: 'NULLABLE' },
        { name: 'tile_x_pct', type: 'FLOAT64', mode: 'NULLABLE' },
        { name: 'tile_y_pct', type: 'FLOAT64', mode: 'NULLABLE' },
        { name: 'locked', type: 'BOOLEAN', mode: 'NULLABLE' },
        { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
      ],
    }).catch(() => {});

    // Tables may already exist from a previous run without the new columns
    // (deleted / updated_at). Add them idempotently so the append-only
    // "latest row wins" read path works.
    await client()
      .query(`ALTER TABLE \`${datasetName()}.${ALERTS_TABLE}\` ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`)
      .catch(() => {});
    await client()
      .query(`ALTER TABLE \`${datasetName()}.${MACHINES_TABLE}\` ADD COLUMN IF NOT EXISTS deleted BOOLEAN`)
      .catch(() => {});
    await client()
      .query(`ALTER TABLE \`${datasetName()}.${MACHINES_TABLE}\` ADD COLUMN IF NOT EXISTS lower_warning FLOAT64`)
      .catch(() => {});
    await client()
      .query(`ALTER TABLE \`${datasetName()}.${MACHINES_TABLE}\` ADD COLUMN IF NOT EXISTS lower_alarm FLOAT64`)
      .catch(() => {});

    console.log('[BigQuery] Dataset and tables ready');
  } catch (err) {
    console.error('[BigQuery] Init failed (will use in-memory only):', err);
  }
}

// Seed BigQuery with synthetic data
export async function seedBigQuery(machines: any[]): Promise<void> {
  try {
    const dataset = client().dataset(datasetName());
    const table = dataset.table(TABLE);

    // Sample timestamps are "HH:MM" wall-clock labels (no date), and several
    // samples can share the same minute — anchor each to today's date and
    // space them by 12s (the shift's sample interval) so BigQuery gets valid,
    // strictly increasing TIMESTAMP values instead of throwing on `new Date("06:00")`.
    const shiftStart = new Date();
    shiftStart.setHours(6, 0, 0, 0);
    const SAMPLE_INTERVAL_SEC = 12;

    const rows: any[] = [];
    for (const m of machines) {
      m.series.forEach((s: any, i: number) => {
        const devPct = ((s.actual - s.expected) / s.expected) * 100;
        const timestamp = new Date(shiftStart.getTime() + i * SAMPLE_INTERVAL_SEC * 1000);
        rows.push({
          machine_id: m.id,
          timestamp: timestamp.toISOString(),
          actual_power: s.actual,
          expected_power: s.expected,
          vibration: s.vibration,
          cycle_time: s.cycleTime,
          deviation_pct: Math.round(devPct * 100) / 100,
        });
      });
    }

    // Batch insert (max 10000 rows per batch)
    for (let i = 0; i < rows.length; i += 10000) {
      const batch = rows.slice(i, i + 10000);
      await table.insert(batch);
    }

    console.log(`[BigQuery] Seeded ${rows.length} rows`);
  } catch (err) {
    console.error('[BigQuery] Seed failed:', err);
  }
}

// Query: threshold violations
export async function queryThresholdViolations(machineId?: string): Promise<any[]> {
  try {
    const where = machineId ? `WHERE machine_id = '${machineId}'` : '';
    const query = `
      SELECT machine_id, timestamp, actual_power, expected_power, deviation_pct,
             CASE WHEN ABS(deviation_pct) > 10 THEN 'critical' ELSE 'warning' END as severity
      FROM \`${datasetName()}.${TABLE}\`
      ${where}
      AND ABS(deviation_pct) > 5
      ORDER BY timestamp DESC
      LIMIT 100
    `;
    const [rows] = await client().query(query);
    return rows;
  } catch (err) {
    console.error('[BigQuery] Query failed:', err);
    return [];
  }
}

// Query: shift summary per machine
export async function queryShiftSummary(): Promise<any[]> {
  try {
    const query = `
      SELECT machine_id,
             AVG(deviation_pct) as avg_dev_pct,
             COUNTIF(ABS(deviation_pct) > 10) as criticals,
             COUNTIF(ABS(deviation_pct) > 5 AND ABS(deviation_pct) <= 10) as warnings,
             SUM(actual_power - expected_power) as excess_kwh
      FROM \`${datasetName()}.${TABLE}\`
      GROUP BY machine_id
      ORDER BY machine_id
    `;
    const [rows] = await client().query(query);
    return rows;
  } catch (err) {
    console.error('[BigQuery] Query failed:', err);
    return [];
  }
}

// Query: energy report
export async function queryEnergyReport(): Promise<any[]> {
  try {
    const query = `
      SELECT machine_id,
             SUM(actual_power) as total_actual,
             SUM(expected_power) as total_expected,
             SUM(actual_power - expected_power) as excess
      FROM \`${datasetName()}.${TABLE}\`
      GROUP BY machine_id
      ORDER BY machine_id
    `;
    const [rows] = await client().query(query);
    return rows;
  } catch (err) {
    console.error('[BigQuery] Query failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Durable CRUD for machines, incidents, alerts.
// These are write-through helpers: the in-memory store is the fast read path,
// BigQuery is the durable store so data survives restarts. All calls are
// best-effort — a BigQuery failure logs and returns null/[] rather than
// breaking the request, so the app keeps working in-memory if GCP is down.
// ---------------------------------------------------------------------------

// warning/critical are the upper bounds (kept under these names for backward
// compatibility with existing rows); lower_warning/lower_alarm are nullable
// since older rows pre-date asymmetric thresholds.
export interface MachineRow {
  id: string;
  name: string;
  type: string;
  warning: number;
  critical: number;
  lower_warning: number | null;
  lower_alarm: number | null;
  base_power: number | null;
  deleted: boolean;
  updated_at: string;
}

// BigQuery is an append-only data warehouse: streaming-inserted rows sit in a
// buffer for ~90s during which UPDATE/DELETE/MERGE are rejected. So instead of
// trying to mutate rows, we treat these tables as an append-only event log and
// resolve the "current state" by taking the most recent row per id on read.
// This is robust against the streaming buffer and matches how BigQuery is
// actually meant to be used.

export async function upsertMachine(m: {
  id: string;
  name: string;
  type: string;
  warning: number;
  critical: number;
  lowerWarning: number;
  lowerAlarm: number;
  basePower?: number;
}): Promise<void> {
  try {
    const table = client().dataset(datasetName()).table(MACHINES_TABLE);
    await table.insert({
      id: m.id,
      name: m.name,
      type: m.type,
      warning: m.warning,
      critical: m.critical,
      lower_warning: m.lowerWarning,
      lower_alarm: m.lowerAlarm,
      base_power: m.basePower ?? null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[BigQuery] upsertMachine failed:', err);
  }
}

// Deletions are recorded as a tombstone row (deleted = TRUE). On read, a
// machine whose latest row is a tombstone is treated as removed.
export async function deleteMachineRow(id: string): Promise<void> {
  try {
    const table = client().dataset(datasetName()).table(MACHINES_TABLE);
    await table.insert({
      id,
      name: '',
      type: '',
      warning: 0,
      critical: 0,
      lower_warning: 0,
      lower_alarm: 0,
      base_power: null,
      deleted: true,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[BigQuery] deleteMachineRow failed:', err);
  }
}

// Return the latest state per machine id (most recent row wins), excluding
// machines whose latest row is a deletion tombstone.
export async function queryMachines(): Promise<MachineRow[]> {
  try {
    const [rows] = await client().query(
      `SELECT id, name, type, warning, critical, lower_warning, lower_alarm, base_power, deleted, updated_at
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) AS rn
         FROM \`${datasetName()}.${MACHINES_TABLE}\`
       )
       WHERE rn = 1 AND deleted = FALSE
       ORDER BY id`
    );
    return rows as MachineRow[];
  } catch (err) {
    console.error('[BigQuery] queryMachines failed:', err);
    return [];
  }
}

export interface IncidentRow {
  id: string;
  machine_id: string;
  machine_name: string;
  status: string;
  severity: string;
  dev_pct: number;
  detected_at: string;
  hypotheses: string | null;
  selected_hypothesis: string | null;
  simulation: string | null;
  verification: string | null;
  audit_log: string | null;
  updated_at: string;
}

export async function upsertIncident(incident: {
  id: string;
  machineId: string;
  machineName: string;
  status: string;
  severity: string;
  devPct: number;
  detectedAt: string;
  hypotheses?: unknown;
  selectedHypothesis?: string;
  simulation?: unknown;
  verification?: unknown;
  auditLog?: unknown;
}): Promise<void> {
  try {
    const table = client().dataset(datasetName()).table(INCIDENTS_TABLE);
    // Append-only: each state change adds a row; the latest row per id is the
    // current state (resolved in queryIncidents).
    await table.insert({
      id: incident.id,
      machine_id: incident.machineId,
      machine_name: incident.machineName,
      status: incident.status,
      severity: incident.severity,
      dev_pct: incident.devPct,
      detected_at: incident.detectedAt,
      hypotheses: incident.hypotheses ? JSON.stringify(incident.hypotheses) : null,
      selected_hypothesis: incident.selectedHypothesis ?? null,
      simulation: incident.simulation ? JSON.stringify(incident.simulation) : null,
      verification: incident.verification ? JSON.stringify(incident.verification) : null,
      audit_log: incident.auditLog ? JSON.stringify(incident.auditLog) : null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[BigQuery] upsertIncident failed:', err);
  }
}

export async function queryIncidents(): Promise<IncidentRow[]> {
  try {
    // Latest row per incident id is the current state.
    const [rows] = await client().query(
      `SELECT id, machine_id, machine_name, status, severity, dev_pct, detected_at,
              hypotheses, selected_hypothesis, simulation, verification, audit_log, updated_at
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) AS rn
         FROM \`${datasetName()}.${INCIDENTS_TABLE}\`
       )
       WHERE rn = 1
       ORDER BY detected_at DESC`
    );
    return rows as IncidentRow[];
  } catch (err) {
    console.error('[BigQuery] queryIncidents failed:', err);
    return [];
  }
}

export interface AlertRow {
  id: string;
  machine_id: string;
  machine_name: string;
  severity: string;
  dev_pct: number;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  incident_id: string | null;
}

export async function upsertAlert(alert: {
  id: string;
  machineId: string;
  machineName: string;
  severity: string;
  devPct: number;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  incidentId?: string;
}): Promise<void> {
  try {
    const table = client().dataset(datasetName()).table(ALERTS_TABLE);
    // Append-only: each state change adds a row; the latest row per id is the
    // current state (resolved in queryAlerts).
    await table.insert({
      id: alert.id,
      machine_id: alert.machineId,
      machine_name: alert.machineName,
      severity: alert.severity,
      dev_pct: alert.devPct,
      message: alert.message,
      timestamp: alert.timestamp,
      acknowledged: alert.acknowledged,
      incident_id: alert.incidentId ?? null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[BigQuery] upsertAlert failed:', err);
  }
}

export async function queryAlerts(): Promise<AlertRow[]> {
  try {
    // Latest row per alert id is the current state.
    const [rows] = await client().query(
      `SELECT id, machine_id, machine_name, severity, dev_pct, message, timestamp,
              acknowledged, incident_id, updated_at
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) AS rn
         FROM \`${datasetName()}.${ALERTS_TABLE}\`
       )
       WHERE rn = 1
       ORDER BY timestamp DESC`
    );
    return rows as AlertRow[];
  } catch (err) {
    console.error('[BigQuery] queryAlerts failed:', err);
    return [];
  }
}

export interface DashboardLayoutRow {
  machine_id: string;
  image_data_url: string | null;
  tile_x_pct: number | null;
  tile_y_pct: number | null;
  locked: boolean | null;
  updated_at: string;
}

export async function upsertDashboardLayout(layout: {
  machineId: string;
  imageDataUrl?: string | null;
  tileXPct?: number | null;
  tileYPct?: number | null;
  locked?: boolean;
}): Promise<void> {
  try {
    const table = client().dataset(datasetName()).table(DASHBOARD_LAYOUTS_TABLE);
    // Append-only: each save adds a row; the latest row per machine is the
    // current layout (resolved in queryDashboardLayout).
    await table.insert({
      machine_id: layout.machineId,
      image_data_url: layout.imageDataUrl ?? null,
      tile_x_pct: layout.tileXPct ?? null,
      tile_y_pct: layout.tileYPct ?? null,
      locked: layout.locked ?? null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[BigQuery] upsertDashboardLayout failed:', err);
  }
}

export async function queryDashboardLayout(machineId: string): Promise<DashboardLayoutRow | null> {
  try {
    const [rows] = await client().query({
      query: `SELECT machine_id, image_data_url, tile_x_pct, tile_y_pct, locked, updated_at
       FROM \`${datasetName()}.${DASHBOARD_LAYOUTS_TABLE}\`
       WHERE machine_id = @machineId
       ORDER BY updated_at DESC
       LIMIT 1`,
      params: { machineId },
    });
    return (rows[0] as DashboardLayoutRow) ?? null;
  } catch (err) {
    console.error('[BigQuery] queryDashboardLayout failed:', err);
    return null;
  }
}
