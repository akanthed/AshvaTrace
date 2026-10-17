import { querySops, SopRow } from './bigqueryService';

// Local fallback copy of the same synthetic SOPs seeded into BigQuery, used
// when BigQuery is unavailable (no GCP_PROJECT_ID, e.g. local dev / tests) so
// retrieval always has something to ground hypotheses in.
export const FALLBACK_SOPS: SopRow[] = [
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

let cache: SopRow[] | null = null;

async function allSops(): Promise<SopRow[]> {
  if (cache) return cache;
  const rows = process.env.GCP_PROJECT_ID ? await querySops() : [];
  cache = rows.length > 0 ? rows : FALLBACK_SOPS;
  return cache;
}

// Deterministic retrieval: pick the SOPs relevant to an incident's signals.
// Not AI — this is plain rule matching so the SOP text handed to the model
// is guaranteed to be real reference material, not something the model
// invented or misremembered.
export async function retrieveSops(signals: Record<string, number>): Promise<SopRow[]> {
  return selectSops(await allSops(), signals);
}

export function selectSops(sops: SopRow[], signals: Record<string, number>): SopRow[] {
  const matched: SopRow[] = [];

  const powerDev = Math.abs(signals.powerDevPct ?? 0);
  const vibration = signals.vibration ?? signals.vibrationMmS ?? 0;

  if (powerDev >= 3) {
    const sop = sops.find((s) => s.trigger_signal === 'power');
    if (sop) matched.push(sop);
  }
  if (vibration >= 2.5) {
    const sop = sops.find((s) => s.trigger_signal === 'vibration');
    if (sop) matched.push(sop);
  }
  // Always have something to ground on, even if no signal crossed a trigger.
  if (matched.length === 0 && sops.length > 0) matched.push(sops[0]);

  return matched;
}

export async function getSopById(id: string): Promise<SopRow | undefined> {
  const sops = await allSops();
  return sops.find((s) => s.id === id);
}
