import { investigate, critiqueHypotheses, simulate, verify, investigateAgentic, inspectToolImage, InvestigationTraceStep, CostTracker } from '../utils/ai';
import { getMachineById, getMachineStatus, getMachineSeries, getMachines, applySimulatedFix, resetMachineConditions } from './machineService';
import { upsertIncident, queryIncidents, IncidentRow } from './bigqueryService';
import { retrieveSops, getSopById } from './sopService';
import { createToolExecutor } from './investigationTools';
import { broadcastEvent } from '../routes/sseRoutes';
import { applyGrounding, buildFactBank, GroundingReport } from '../utils/grounding';

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
  aiCostUsd: number;
}

interface Hypothesis {
  id: string;
  title: string;
  confidence: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  sopRef?: string | null;
  nextCheck?: string;
  suggestedFix?: string;
  grounding?: GroundingReport;
}

interface SimulationResult {
  action: string;
  predictedOutcome: string;
  confidence: number;
  expectedPowerDevPct?: number;
  baseline?: Record<string, number>;
}

interface VerificationResult {
  passed: boolean;
  actualOutcome: string;
  metrics: Record<string, number>;
  checks?: Array<{ label: string; limit: string; actual: number; unit: string; passed: boolean }>;
  baseline?: Record<string, number>;
  predictionHeld?: boolean;
  expectedPowerDevPct?: number;
  simulatedEffect?: 'recovered' | 'unchanged';
  savings?: { kw: number; usdPerDay: number; kgCo2PerMonth: number; assumptions: string };
}

interface AuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  details: string;
}

// Assumptions behind the "what the fix saves" figure, shown to the user.
const SAVINGS_HOURS_PER_DAY = 16; // two-shift operation
const ELECTRICITY_USD_PER_KWH = 0.12;
const GRID_KG_CO2_PER_KWH = 0.71;

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
    aiCostUsd: incident.aiCostUsd,
  });
}

// Load persisted incidents from BigQuery into the in-memory store on boot so
// the investigation history survives a server restart. Incidents for a
// machine that no longer exists (deleted since the incident was recorded)
// are skipped — otherwise deleted demo/test machines (e.g. "machine 1",
// GRD-01, PRS-01) keep reappearing in incident lists forever.
export async function loadPersistedIncidents(): Promise<void> {
  let rows: IncidentRow[] = [];
  try {
    rows = await queryIncidents();
  } catch {
    return;
  }
  const liveMachineIds = new Set(getMachines().map((m) => m.id));
  for (const row of rows) {
    if (incidents.has(row.id)) continue;
    if (!liveMachineIds.has(row.machine_id)) continue;
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
      aiCostUsd: row.ai_cost_usd ?? 0,
    };
    incidents.set(incident.id, incident);
  }
  if (rows.length > 0) {
    console.log(`[Init] Loaded ${rows.length} persisted incidents from BigQuery`);
  }
}


// Extra resolved history so the AI has more to learn from and the report card has
// real variety, including fixes that did NOT work.
function extraPastSeeds(): any[] {
  const hyp = (id: string, title: string, confidence: number, sopRef: string | null, ev: string[], against: string[]) => ({
    id, title, confidence, evidenceFor: ev, evidenceAgainst: against, sopRef,
  });
  const base = (
    id: string, machineId: string, machineName: string, daysAgo: number, devPct: number,
    severity: 'warning' | 'critical', status: 'verified' | 'closed', hypotheses: any[],
    action: string, predicted: string, conf: number, passed: boolean, outcome: string, comment: string
  ) => ({
    id, machineId, machineName, daysAgo, devPct, severity, status, hypotheses,
    simulation: { action, predictedOutcome: predicted, confidence: conf },
    verification: { passed, actualOutcome: outcome, metrics: { powerDevPct: passed ? 1.6 : devPct * 0.8, vibration: passed ? 2.3 : 4.9, cycleTime: passed ? 90 : 112 } },
    resolutionComment: comment,
  });
  return [
    base('INC-PAST-008', 'CNC-01', 'CNC Mill 01', 20, 9.4, 'warning', 'verified',
      [hyp('HYP-1', 'Worn cutting tool increasing cutting force', 78, 'SOP-101',
        ['Power crept up 9% over two shifts', 'Time per part rose by about 7%'], ['Vibration stayed under the healthy limit']),
       hyp('HYP-2', 'Coolant concentration drifting low', 40, 'SOP-101', ['Surface finish complaints on the last batch'], ['Coolant was topped up yesterday'])],
      'Replace the cutting insert and re-run the warm-up cycle', 'Power should fall back within 3% once the sharp insert is fitted.', 84, true,
      'Power settled at 1.2% above normal. Vibration and part time back to baseline.', 'Insert was chipped. Replaced and logged tool life.'),
    base('INC-PAST-009', 'CNC-02', 'CNC Mill 02', 16, 8.9, 'warning', 'closed',
      [hyp('HYP-1', 'Spindle drive belt slipping', 71, 'SOP-102', ['Power high while spindle speed dips under load', 'Squeal reported at start-up'], ['No recent belt change recorded']),
       hyp('HYP-2', 'Cutting tool wear', 45, 'SOP-101', ['Time per part slightly longer'], ['Tool was changed 2 days ago'])],
      'Re-tension the spindle belt', 'Power should drop within 3% after re-tensioning.', 74, false,
      'Power stayed 7.1% above normal. The fix did not hold.', 'Belt tension was fine. Real cause was a dry ball screw, fixed with lubrication. The first guess was wrong.'),
    base('INC-PAST-010', 'LATHE-01', 'CNC Lathe 01', 14, 13.2, 'critical', 'verified',
      [hyp('HYP-1', 'Hydraulic chuck pressure set too high', 66, 'SOP-102', ['Power high even when idle between cuts', 'Hydraulic unit running hot'], ['Part quality looked normal']),
       hyp('HYP-2', 'Spindle bearing wear', 52, 'SOP-102', ['Vibration slightly raised'], ['Vibration well under the alarm level'])],
      'Reset chuck pressure to the SOP value and check the relief valve', 'Idle power should fall and total power return within 3%.', 80, true,
      'Power dropped to 2.1% above normal and stayed there for the full hour.', 'Pressure had been raised for a heavy job and never reset.'),
    base('INC-PAST-011', 'PRS-01', 'Press 01', 9, 12.7, 'critical', 'verified',
      [hyp('HYP-1', 'Hydraulic pump wear', 69, 'SOP-102', ['Power rising with each stroke count', 'Cycle time creeping up'], ['No oil leak seen']),
       hyp('HYP-2', 'Die misalignment', 48, 'SOP-101', ['Uneven wear marks on the die'], ['Alignment checked last month'])],
      'Replace the hydraulic pump seal kit and bleed the line', 'Power should return within 3% and the stroke time should shorten.', 77, true,
      'Power settled at 2.4% above normal. Stroke time back to baseline.', 'Pump seals worn. Replaced the kit and bled air from the line.'),
    base('INC-PAST-012', 'CNC-03', 'CNC Mill 03', 6, 16.3, 'critical', 'closed',
      [hyp('HYP-1', 'Coolant pump partly blocked', 62, 'SOP-101', ['Power high with no vibration change', 'Coolant flow gauge reading low'], ['Filter changed last week']),
       hyp('HYP-2', 'Spindle bearing wear', 58, 'SOP-102', ['Vibration above 4 mm/s'], ['Bearing replaced 12 days ago'])],
      'Clean the coolant pump inlet and replace the filter', 'Power should fall within 3% once flow is restored.', 70, false,
      'Power only dropped to 11.8% above normal. The fix did not hold.', 'Coolant was not the cause. A second spindle bearing was failing. Replaced and verified in INC-PAST-001 style.'),
    base('INC-PAST-013', 'PRS-01', 'Press 01', 3, 7.2, 'warning', 'verified',
      [hyp('HYP-1', 'Low lubrication on the press guides', 73, 'SOP-101', ['Power up 7% with no vibration change', 'Guide rails looked dry'], ['Lubricant reservoir was half full'])],
      'Lubricate the guide rails and reset the auto-lube timer', 'Friction should drop and power return within 3%.', 79, true,
      'Power settled at 1.4% above normal.', 'Auto-lube timer had been reset by a power cut. Corrected.'),
  ];
}

/**
 * Seed synthetic past (resolved) incidents so the AI has history to reference
 * during investigation. This gives the demo a realistic "last time this
 * happened, we did X and it worked" story. Only seeds if no incidents exist
 * yet for the machine, so it won't overwrite real data.
 */
export function seedPastIncidents(): void {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const seeds: Array<{
    id: string;
    machineId: string;
    machineName: string;
    daysAgo: number;
    devPct: number;
    severity: 'warning' | 'critical';
    status: 'verified' | 'closed';
    hypotheses: Hypothesis[];
    simulation?: SimulationResult;
    verification?: VerificationResult;
    resolutionComment?: string;
  }> = [
    {
      id: 'INC-PAST-001',
      machineId: 'CNC-03',
      machineName: 'CNC Mill 03',
      daysAgo: 12,
      devPct: 14.2,
      severity: 'critical',
      status: 'verified',
      hypotheses: [
        {
          id: 'HYP-1',
          title: 'Spindle bearing wear causing increased friction',
          confidence: 82,
          evidenceFor: [
            'Power was running 14% above baseline for 3 hours before the alert',
            'Vibration was elevated at 5.8 mm/s, well above the 3 mm/s healthy limit',
            'Cycle time was 8% slower than normal, consistent with mechanical drag',
          ],
          evidenceAgainst: [
            'No tool change event in the last 48 hours, so it was not a fresh tool issue',
          ],
          sopRef: 'SOP-102',
        },
        {
          id: 'HYP-2',
          title: 'Coolant flow restriction reducing cutting efficiency',
          confidence: 55,
          evidenceFor: [
            'Power deviation started gradually over 2 hours, matching a slow coolant clog',
            'Vibration was moderately elevated but not as high as a bearing fault',
          ],
          evidenceAgainst: [
            'Cycle time was only slightly affected, which is less typical for coolant issues',
          ],
          sopRef: 'SOP-101',
        },
      ],
      simulation: {
        action: 'Replace spindle bearing and flush coolant lines',
        predictedOutcome: 'Power deviation should return to under 3% within 30 minutes of the bearing replacement. Vibration should drop below 3 mm/s.',
        confidence: 88,
      },
      verification: {
        passed: true,
        actualOutcome: 'Power deviation dropped to 1.8% within 20 minutes. Vibration settled at 2.4 mm/s. Cycle time returned to baseline.',
        metrics: { powerDevPct: 1.8, vibration: 2.4, cycleTime: 92 },
      },
      resolutionComment: 'Bearing was visibly worn on inspection. Replaced and flushed coolant. Machine back to normal within 20 minutes.',
    },
    {
      id: 'INC-PAST-002',
      machineId: 'CNC-03',
      machineName: 'CNC Mill 03',
      daysAgo: 5,
      devPct: 15.8,
      severity: 'critical',
      status: 'verified',
      hypotheses: [
        {
          id: 'HYP-1',
          title: 'Tool edge chipping increasing cutting resistance',
          confidence: 78,
          evidenceFor: [
            'Power spiked 16% above baseline right after a long continuous run',
            'Vibration was elevated at 5.2 mm/s, consistent with an uneven cutting edge',
            'Cycle time was 6% slower, matching the extra force needed to cut with a chipped edge',
          ],
          evidenceAgainst: [
            'No sudden spike — the deviation built up gradually, which is more typical of wear than a single chip event',
          ],
          sopRef: 'SOP-102',
        },
        {
          id: 'HYP-2',
          title: 'Workpiece material variation (harder batch)',
          confidence: 45,
          evidenceFor: [
            'A new material batch was loaded the same morning',
            'Power deviation was sustained rather than intermittent',
          ],
          evidenceAgainst: [
            'Vibration was too high for a pure material hardness issue — usually that shows as power only',
          ],
          sopRef: null,
        },
      ],
      simulation: {
        action: 'Replace cutting tool and verify edge geometry',
        predictedOutcome: 'Power should return to baseline within 15 minutes of tool replacement. Vibration should drop below 3 mm/s.',
        confidence: 85,
      },
      verification: {
        passed: true,
        actualOutcome: 'New tool installed. Power deviation dropped to 2.1% within 10 minutes. Vibration at 2.6 mm/s.',
        metrics: { powerDevPct: 2.1, vibration: 2.6, cycleTime: 91 },
      },
      resolutionComment: 'Tool edge was chipped on inspection. Replaced with a fresh tool. Machine back to normal.',
    },
    {
      id: 'INC-PAST-003',
      machineId: 'CNC-02',
      machineName: 'CNC Mill 02',
      daysAgo: 8,
      devPct: 7.8,
      severity: 'warning',
      status: 'closed',
      hypotheses: [
        {
          id: 'HYP-1',
          title: 'Gradual process drift from tool wear',
          confidence: 72,
          evidenceFor: [
            'Power was 8% above baseline and slowly climbing over 4 hours',
            'Vibration was mildly elevated at 3.8 mm/s',
            'Pattern matched the slow drift seen in previous tool-wear incidents',
          ],
          evidenceAgainst: [
            'Cycle time was normal, which is unusual for significant tool wear',
          ],
          sopRef: 'SOP-101',
        },
      ],
      simulation: {
        action: 'Schedule tool inspection at end of shift',
        predictedOutcome: 'If tool wear is the cause, the deviation should stabilize or continue climbing. Inspection will confirm.',
        confidence: 70,
      },
      verification: {
        passed: true,
        actualOutcome: 'Tool inspection confirmed moderate wear. Tool replaced at end of shift. Power returned to 1.2% deviation.',
        metrics: { powerDevPct: 1.2, vibration: 2.8, cycleTime: 90 },
      },
      resolutionComment: 'Tool was at 70% wear. Replaced and machine returned to normal.',
    },
    {
      id: 'INC-PAST-004',
      machineId: 'LATHE-01',
      machineName: 'CNC Lathe 01',
      daysAgo: 9,
      devPct: 11.4,
      severity: 'critical',
      status: 'verified',
      hypotheses: [
        {
          id: 'HYP-1',
          title: 'Chuck jaw misalignment increasing spindle load',
          confidence: 80,
          evidenceFor: [
            'Power jumped 11% above baseline right after a job changeover',
            'Vibration elevated at 4.6 mm/s, consistent with an off-center workpiece',
          ],
          evidenceAgainst: [
            'Cycle time stayed close to normal, which would be unusual for a severe misalignment',
          ],
          sopRef: 'SOP-101',
        },
        {
          id: 'HYP-2',
          title: 'Worn insert causing higher cutting force',
          confidence: 48,
          evidenceFor: [
            'Insert had been in use for an extended run',
          ],
          evidenceAgainst: [
            'The deviation appeared abruptly rather than building gradually, more typical of a setup issue than wear',
          ],
          sopRef: 'SOP-102',
        },
      ],
      simulation: {
        action: 'Re-align chuck jaws and re-run calibration cut',
        predictedOutcome: 'Power deviation should drop to under 3% once the workpiece is running true again.',
        confidence: 83,
      },
      verification: {
        passed: true,
        actualOutcome: 'Chuck re-aligned. Power deviation dropped to 2.0% on the next part. Vibration settled at 2.3 mm/s.',
        metrics: { powerDevPct: 2.0, vibration: 2.3, cycleTime: 58 },
      },
      resolutionComment: 'Jaws had shifted slightly during the last changeover. Re-aligned and re-calibrated.',
    },
    {
      id: 'INC-PAST-005',
      machineId: 'GRD-01',
      machineName: 'Grinder 01',
      daysAgo: 6,
      devPct: 9.1,
      severity: 'warning',
      status: 'closed',
      hypotheses: [
        {
          id: 'HYP-1',
          title: 'Grinding wheel glazing reducing cutting efficiency',
          confidence: 74,
          evidenceFor: [
            'Power was 9% above baseline and climbing slowly across the shift',
            'Vibration mildly elevated, consistent with a glazed wheel rubbing instead of cutting',
          ],
          evidenceAgainst: [
            'No unusual spark pattern reported by the operator, which often accompanies a badly glazed wheel',
          ],
          sopRef: 'SOP-101',
        },
      ],
      simulation: {
        action: 'Dress the grinding wheel',
        predictedOutcome: 'Dressing the wheel should restore cutting efficiency and drop power deviation back under 3%.',
        confidence: 75,
      },
      verification: {
        passed: true,
        actualOutcome: 'Wheel dressed. Power deviation dropped to 1.9% within the next few parts.',
        metrics: { powerDevPct: 1.9, vibration: 2.4, cycleTime: 75 },
      },
      resolutionComment: 'Wheel was glazed from an extended run without dressing. Dressed and back to normal.',
    },
    {
      id: 'INC-PAST-006',
      machineId: 'PRS-01',
      machineName: 'Press 01',
      daysAgo: 15,
      devPct: 13.6,
      severity: 'critical',
      status: 'verified',
      hypotheses: [
        {
          id: 'HYP-1',
          title: 'Die lubrication starvation increasing stamping force',
          confidence: 77,
          evidenceFor: [
            'Power spiked 13.6% above baseline mid-shift',
            'Cycle time slowed slightly, consistent with higher friction at the die',
          ],
          evidenceAgainst: [
            'Vibration stayed close to normal, which is less typical of a severe lubrication issue',
          ],
          sopRef: 'SOP-102',
        },
        {
          id: 'HYP-2',
          title: 'Material gauge thicker than spec',
          confidence: 40,
          evidenceFor: [
            'Deviation appeared right after a new coil was loaded',
          ],
          evidenceAgainst: [
            'Incoming material was within the supplier tolerance per the batch sheet',
          ],
          sopRef: null,
        },
      ],
      simulation: {
        action: 'Replenish die lubrication and inspect die surface',
        predictedOutcome: 'Restoring lubrication should bring stamping force, and power deviation, back under 3%.',
        confidence: 80,
      },
      verification: {
        passed: true,
        actualOutcome: 'Lubrication replenished. Power deviation dropped to 2.3% on the next cycle.',
        metrics: { powerDevPct: 2.3, vibration: 2.1, cycleTime: 45 },
      },
      resolutionComment: 'Lube reservoir was low. Topped up and die inspected — no damage found.',
    },
    {
      id: 'INC-PAST-007',
      machineId: 'CNC-01',
      machineName: 'CNC Mill 01',
      daysAgo: 20,
      devPct: 6.3,
      severity: 'warning',
      status: 'closed',
      hypotheses: [
        {
          id: 'HYP-1',
          title: 'Coolant concentration too low, raising cutting resistance',
          confidence: 68,
          evidenceFor: [
            'Power was 6.3% above baseline for most of the shift',
            'No corresponding rise in vibration, which points away from a mechanical cause',
          ],
          evidenceAgainst: [
            'Cycle time was unaffected, which would be slightly unusual for a coolant issue',
          ],
          sopRef: 'SOP-101',
        },
      ],
      simulation: {
        action: 'Check and top up coolant concentration',
        predictedOutcome: 'Correcting coolant mix should bring power deviation back under 3% within a few parts.',
        confidence: 65,
      },
      verification: {
        passed: true,
        actualOutcome: 'Coolant concentration was below spec. Topped up. Power deviation dropped to 1.5%.',
        metrics: { powerDevPct: 1.5, vibration: 1.9, cycleTime: 89 },
      },
      resolutionComment: 'Coolant mixer had drifted out of spec. Corrected and logged for weekly check.',
    },
  ];

  seeds.push(...extraPastSeeds());

  for (const seed of seeds) {
    if (incidents.has(seed.id)) continue;
    const detectedAt = new Date(now - seed.daysAgo * day).toISOString();
    const incident: Incident = {
      id: seed.id,
      machineId: seed.machineId,
      machineName: seed.machineName,
      status: seed.status,
      detectedAt,
      severity: seed.severity,
      devPct: seed.devPct,
      hypotheses: seed.hypotheses,
      aiCostUsd: 0,
      simulation: seed.simulation,
      verification: seed.verification,
      auditLog: [
        {
          timestamp: detectedAt,
          actor: 'system',
          action: 'incident_created',
          details: `${seed.machineName} was ${Math.abs(seed.devPct)}% off normal power (${seed.severity === 'critical' ? 'Action required' : 'Watch'})`,
        },
        {
          timestamp: new Date(now - seed.daysAgo * day + 5 * 60000).toISOString(),
          actor: 'ai',
          action: 'investigation_completed',
          details: `AI suggested ${seed.hypotheses.length} likely causes. Top: ${seed.hypotheses[0]?.title}`,
        },
        {
          timestamp: new Date(now - seed.daysAgo * day + 15 * 60000).toISOString(),
          actor: 'engineer',
          action: 'action_taken',
          details: seed.simulation?.action || 'Action taken',
        },
        {
          timestamp: new Date(now - seed.daysAgo * day + 25 * 60000).toISOString(),
          actor: 'system',
          action: 'verification_completed',
          details: seed.verification
            ? `Verification ${seed.verification.passed ? 'PASSED' : 'FAILED'}: ${seed.verification.actualOutcome}`
            : 'Verification completed',
        },
        ...(seed.resolutionComment
          ? [
              {
                timestamp: new Date(now - seed.daysAgo * day + 25 * 60000).toISOString(),
                actor: 'engineer',
                action: 'incident_resolved',
                details: seed.resolutionComment,
              },
            ]
          : []),
      ],
    };
    incidents.set(seed.id, incident);
  }

  console.log(`[Init] Seeded ${seeds.length} past incidents for demo history`);
}

/**
 * Seed a small set of currently-open, UNANSWERED incidents (zero hypotheses)
 * on every boot, so there's always something for a judge/demo viewer to click
 * "Run AI Investigation" on and watch a real Gemini call happen live — rather
 * than relying on the live random-walk simulator to drift a machine into
 * critical at an unpredictable time. Only creates an incident if that exact
 * id doesn't already exist, and never overwrites a real open incident on the
 * same machine (skips machines that already have one), so re-running this on
 * every restart is safe and won't duplicate or clobber real investigation
 * progress.
 */
export function seedOpenIncidents(): void {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  // Staggered detection times so the list looks like a real shift, not one instant.
  const agesHours = [2.5, 1.5, 0.75, 0.25, 4];
  let seeded = 0;

  getMachines().forEach((m, i) => {
    const status = getMachineStatus(m.id);
    if (!status || status.status === 'normal') return;
    if (getOpenIncidentForMachine(m.id)) return; // never a second open incident on one machine

    const incident = createIncident(m.id, status.devPct, status.status);
    const detectedAt = new Date(now - agesHours[i % agesHours.length] * hour).toISOString();
    incident.detectedAt = detectedAt;
    if (incident.auditLog[0]) incident.auditLog[0].timestamp = detectedAt;
    persistIncident(incident);
    seeded++;
  });

  console.log(`[Init] Ensured open, unanswered demo incidents (${seeded} created)`);
}

// Demo reset for presenters and judges: close whatever is currently open, put every
// machine back in its original condition, and create fresh open problems to work on.
// Closed incidents stay as history. Nothing is deleted.
export function resetDemo(): { closed: number; created: number } {
  let closed = 0;
  for (const inc of incidents.values()) {
    if (OPEN_STATUSES.includes(inc.status)) {
      inc.status = 'closed';
      inc.auditLog.push({
        timestamp: new Date().toISOString(),
        actor: 'system',
        action: 'demo_reset',
        details: 'Closed by a demo reset so a fresh set of problems could be created',
      });
      persistIncident(inc);
      closed++;
    }
  }
  resetMachineConditions();
  const before = incidents.size;
  seedOpenIncidents();
  return { closed, created: incidents.size - before };
}

export function getIncidents(): Incident[] {
  return Array.from(incidents.values());
}

// Remove all in-memory incidents for a machine — called when the machine
// itself is deleted, so its incidents don't keep showing up in incident
// lists for the rest of the process lifetime (BigQuery rows are left as
// history; loadPersistedIncidents() re-filters them against live machines
// on next boot).
export function deleteIncidentsForMachine(machineId: string): void {
  for (const [id, inc] of incidents) {
    if (inc.machineId === machineId) incidents.delete(id);
  }
}

export function getIncidentById(id: string): Incident | null {
  return incidents.get(id) || null;
}

/**
 * Get all incidents for a machine (open + past), most recent first.
 */
export function getIncidentsForMachine(machineId: string): Incident[] {
  const list: Incident[] = [];
  for (const inc of incidents.values()) {
    if (inc.machineId === machineId) list.push(inc);
  }
  list.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
  return list;
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
    details: `AI started looking into ${incident.machineName}`,
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
  const toolExecutor = createToolExecutor(
    () => getMachineSeries(machineId, 0)?.series,
    (wearLevel) => inspectToolImage(machineId, wearLevel)
  );

  let hypotheses;
  let droppedByGrounding: string[] = [];
  let trace: InvestigationTraceStep[] = [];
  const tracker = new CostTracker();
  try {
    const tA = Date.now();
    const progress = (message: string) => broadcastEvent({ type: 'investigationProgress', incidentId: incident.id, message });
    const agentic = await investigateAgentic(enrichedContext, sops, toolExecutor, pastIncidents, tracker, progress);
    progress('A second AI pass is double-checking the answer');
    const tB = Date.now();
    const critiqued = await critiqueHypotheses(enrichedContext, agentic.hypotheses, sops, tracker);
    console.log(`[AI] investigate ${tB - tA}ms, critique ${Date.now() - tB}ms`);
    trace = agentic.trace;
    progress('Code is checking every number against the sensor data');
    // Deterministic check (not AI): every figure quoted must exist in the
    // data this investigation actually saw.
    const grounded = applyGrounding(
      critiqued,
      buildFactBank({ signals: enrichedContext.signals, trace, sops, pastIncidents })
    );
    hypotheses = grounded.hypotheses;
    droppedByGrounding = grounded.dropped;
  } catch (err: any) {
    incident.status = 'open';
    incident.aiCostUsd += tracker.totalCostUsd();
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
  incident.aiCostUsd += tracker.totalCostUsd();

  incident.auditLog.push({
    timestamp: new Date().toISOString(),
    actor: 'ai',
    action: 'hypotheses_generated',
    details: `AI suggested ${hypotheses.length} likely causes. It read ${trace.filter((t) => t.type === 'tool_call').length} sets of live readings and used ${sops.map((s) => s.id).join(', ') || 'no matching procedure'}. A second AI pass reviewed them, then code confirmed ${hypotheses.reduce((n, h) => n + (h.grounding?.figuresVerified ?? 0), 0)} of ${hypotheses.reduce((n, h) => n + (h.grounding?.figuresChecked ?? 0), 0)} quoted numbers against the sensor data.${droppedByGrounding.length ? ` Removed as unsupported: ${droppedByGrounding.join('; ')}.` : ''} AI cost: $${tracker.totalCostUsd().toFixed(4)}.`,
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
  const tracker = new CostTracker();
  try {
    const postActionSop = await getSopById('SOP-103');
    simulation = await simulate(
      {
        machineId: incident.machineId,
        hypothesis: hypothesis.title,
        action: body.action,
      },
      postActionSop,
      tracker
    );
  } catch (err: any) {
    incident.aiCostUsd += tracker.totalCostUsd();
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
  // A new fix attempt supersedes any earlier verdict.
  incident.verification = undefined;
  // Snapshot the live readings now so Verify can show a real before/after.
  const before = getMachineStatus(incident.machineId);
  incident.simulation = {
    ...simulation,
    baseline: before
      ? {
          powerDevPct: Math.round(before.devPct * 10) / 10,
          vibrationMmS: Math.round((before.vibration ?? 0) * 100) / 100,
          cycleTimeSec: Math.round((before.cycleTime ?? 0) * 10) / 10,
          actualKw: before.actual,
          expectedKw: before.expected,
        }
      : undefined,
  };
  incident.aiCostUsd += tracker.totalCostUsd();

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
  // Demo machine: the simulated plant only recovers if the engineer's chosen
  // cause is the one the AI ranked most likely. A different cause leaves the
  // machine as it was, so verification fails honestly.
  const topId = [...incident.hypotheses].sort((a, b) => b.confidence - a.confidence)[0]?.id;
  let simulatedEffect: 'recovered' | 'unchanged' | undefined;
  if (!(body.actualMetrics && Object.keys(body.actualMetrics).length > 0) && incident.selectedHypothesis) {
    if (incident.selectedHypothesis === topId && applySimulatedFix(incident.machineId)) {
      simulatedEffect = 'recovered';
    } else {
      simulatedEffect = 'unchanged';
    }
  }
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
  verification.simulatedEffect = simulatedEffect;
  // Energy the fix actually saved: extra kW before vs extra kW now, from the same
  // two readings verify() used. Plain arithmetic with the assumptions stated.
  const b = incident.simulation.baseline;
  if (verification.passed && b?.actualKw !== undefined && b.expectedKw !== undefined && status) {
    const savedKw = Math.round(((b.actualKw - b.expectedKw) - (status.actual - status.expected)) * 100) / 100;
    if (savedKw > 0) {
      verification.savings = {
        kw: savedKw,
        usdPerDay: Math.round(savedKw * SAVINGS_HOURS_PER_DAY * ELECTRICITY_USD_PER_KWH * 100) / 100,
        kgCo2PerMonth: Math.round(savedKw * SAVINGS_HOURS_PER_DAY * 30 * GRID_KG_CO2_PER_KWH),
        assumptions: `${SAVINGS_HOURS_PER_DAY} running hours/day, $${ELECTRICITY_USD_PER_KWH}/kWh, ${GRID_KG_CO2_PER_KWH} kg CO₂/kWh`,
      };
    }
  }
  incident.verification = verification;
  incident.status = verification.passed ? 'verified' : 'open';

  incident.auditLog.push({
    timestamp: new Date().toISOString(),
    actor: 'system',
    action: 'outcome_verified',
    details: `${verification.passed ? 'PASS' : 'FAIL'}: ${verification.actualOutcome}${
      verification.predictionHeld === undefined
        ? ''
        : verification.predictionHeld
          ? ' AI prediction held.'
          : ' AI prediction missed.'
    }`,
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
    aiCostUsd: 0,
    auditLog: [
      {
        timestamp: new Date().toISOString(),
        actor: 'system',
        action: 'incident_detected',
        details: `${machine?.name || machineId} is ${Math.abs(devPct)}% ${devPct >= 0 ? 'above' : 'below'} normal power`,
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
