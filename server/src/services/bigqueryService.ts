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

// The BigQuery client returns TIMESTAMP columns as `{ value: string }`
// wrapper objects (BigQueryTimestamp), not plain strings — passing one
// straight into a string-typed field crashes React when rendered. Every
// query that selects a TIMESTAMP column must unwrap it with this.
function tsToIso(ts: unknown): string {
  if (ts && typeof ts === 'object' && 'value' in (ts as any)) return (ts as any).value;
  return ts as string;
}
const TABLE = 'machine_readings';
const MACHINES_TABLE = 'machines';
const INCIDENTS_TABLE = 'incidents';
const ALERTS_TABLE = 'alerts';
const DASHBOARD_LAYOUTS_TABLE = 'dashboard_layouts';
const SOP_TABLE = 'sop_documents';

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
        { name: 'ai_cost_usd', type: 'FLOAT64', mode: 'NULLABLE' },
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

    // SOPs: static reference library the investigation pipeline grounds its
    // hypotheses in (read-only at runtime, seeded once below).
    await dataset.table(SOP_TABLE).create({
      schema: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'title', type: 'STRING', mode: 'REQUIRED' },
        { name: 'trigger_signal', type: 'STRING', mode: 'REQUIRED' },
        { name: 'body', type: 'STRING', mode: 'REQUIRED' },
      ],
    }).catch(() => {});

    // Tables may already exist from a previous run without the new columns
    // (deleted / updated_at). Add them idempotently so the append-only
    // "latest row wins" read path works.
    await client()
      .query(`ALTER TABLE \`${datasetName()}.${ALERTS_TABLE}\` ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`)
      .catch(() => {});
    await client()
      .query(`ALTER TABLE \`${datasetName()}.${INCIDENTS_TABLE}\` ADD COLUMN IF NOT EXISTS ai_cost_usd FLOAT64`)
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

export interface SopRow {
  id: string;
  title: string;
  trigger_signal: string;
  body: string;
}

const SYNTHETIC_SOPS: SopRow[] = [
  {
    id: 'SOP-101',
    title: 'Process Drift Response',
    trigger_signal: 'power',
    body:
      'If actual power draw climbs steadily above the expected baseline over many samples (not a single spike), suspect mechanical wear building up gradually — a bearing, belt, or spindle losing efficiency. Compare against SOP-102 before assuming a sensor fault: drift plus rising vibration together point to wear, drift alone with flat vibration points to a calibration or load change instead.',
  },
  {
    id: 'SOP-102',
    title: 'Tool Inspection',
    trigger_signal: 'vibration',
    body:
      'If vibration rises alongside power deviation, inspect the cutting tool or spindle bearing before any other action. Rising vibration with rising cycle time usually means the tool is cutting less efficiently (dull edge, chipped insert) and the machine is compensating by working harder and slower. A brief vibration spike with no lasting rise after it usually just marks a tool-change event, not a fault.',
  },
  {
    id: 'SOP-103',
    title: 'Post-Adjustment Verification',
    trigger_signal: 'post_action',
    body:
      'After any corrective action (tool replacement, recalibration, bearing service), expect power deviation to return within 3% of baseline, vibration to drop back under 4.5 mm/s, and cycle time under 120s within a short window. If metrics stay elevated after the action, treat the original hypothesis as unconfirmed rather than extending the same fix — escalate to a different root cause.',
  },
];

// Seed the SOP reference table. Idempotent: skips if rows already exist.
export async function seedSops(): Promise<void> {
  try {
    const table = client().dataset(datasetName()).table(SOP_TABLE);
    const [rows] = await client().query(`SELECT COUNT(*) as n FROM \`${datasetName()}.${SOP_TABLE}\``);
    if (rows[0]?.n > 0) return;
    await table.insert(SYNTHETIC_SOPS);
    console.log(`[BigQuery] Seeded ${SYNTHETIC_SOPS.length} SOP documents`);
  } catch (err) {
    console.error('[BigQuery] seedSops failed:', err);
  }
}

export async function querySops(): Promise<SopRow[]> {
  try {
    const [rows] = await client().query(`SELECT id, title, trigger_signal, body FROM \`${datasetName()}.${SOP_TABLE}\``);
    return rows as SopRow[];
  } catch (err) {
    console.error('[BigQuery] querySops failed:', err);
    return [];
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
    return rows.map((r: any) => ({ ...r, timestamp: tsToIso(r.timestamp) }));
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

// Ids whose latest row is an explicit deletion tombstone — used to remove a
// seeded (hardcoded) machine that the user deleted via the UI, WITHOUT
// treating "never persisted at all" the same as "deleted" (a seeded machine
// has no BigQuery row until its first edit).
export async function queryDeletedMachineIds(): Promise<string[]> {
  try {
    const [rows] = await client().query(
      `SELECT id
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) AS rn
         FROM \`${datasetName()}.${MACHINES_TABLE}\`
       )
       WHERE rn = 1 AND deleted = TRUE`
    );
    return rows.map((r: any) => r.id);
  } catch (err) {
    console.error('[BigQuery] queryDeletedMachineIds failed:', err);
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
  ai_cost_usd: number | null;
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
  aiCostUsd?: number;
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
      ai_cost_usd: incident.aiCostUsd ?? 0,
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
    return rows.map((r: any) => ({ ...r, detected_at: tsToIso(r.detected_at), updated_at: tsToIso(r.updated_at) })) as IncidentRow[];
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
    return rows.map((r: any) => ({ ...r, timestamp: tsToIso(r.timestamp), updated_at: tsToIso(r.updated_at) })) as AlertRow[];
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
