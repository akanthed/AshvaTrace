import { getIncidents } from './incidentService';

// The AI's report card, graded entirely by code. Every number here comes from
// verify() results that already exist on closed-loop incidents: did the fix the
// engineer chose actually pass, and did the AI's committed prediction land?
// No model is involved in producing or scoring this.

interface GradedHypothesis {
  id: string;
  confidence: number;
}

interface GradableIncident {
  id: string;
  machineId: string;
  hypotheses: GradedHypothesis[];
  selectedHypothesis?: string;
  simulation?: { confidence: number };
  verification?: {
    passed: boolean;
    predictionHeld?: boolean;
    expectedPowerDevPct?: number;
    metrics: Record<string, number>;
  };
}

export interface ConfidenceBucket {
  label: string;
  incidents: number;
  passed: number;
}

export interface TrackRecord {
  scope: 'plant' | 'machine';
  machineId?: string;
  graded: number; // incidents where a fix was verified by code
  fixesPassed: number;
  topCauseChosen: number; // engineer picked the AI's top-ranked cause
  topCausePassed: number;
  predictionsScored: number;
  predictionsHeld: number;
  avgPredictionErrorPts: number | null;
  calibration: ConfidenceBucket[]; // AI's stated confidence vs real pass rate
}

const BUCKETS: Array<[string, (c: number) => boolean]> = [
  ['AI was 70%+ sure', (c) => c >= 70],
  ['AI was 40–69% sure', (c) => c >= 40 && c < 70],
  ['AI was under 40% sure', (c) => c < 40],
];

export function computeTrackRecord(incidents: GradableIncident[], machineId?: string): TrackRecord {
  const graded = incidents.filter(
    (i) => i.verification && i.hypotheses.length > 0 && (!machineId || i.machineId === machineId)
  );

  let fixesPassed = 0;
  let topCauseChosen = 0;
  let topCausePassed = 0;
  let predictionsScored = 0;
  let predictionsHeld = 0;
  let errSum = 0;
  const calibration: ConfidenceBucket[] = BUCKETS.map(([label]) => ({ label, incidents: 0, passed: 0 }));

  for (const inc of graded) {
    const v = inc.verification!;
    if (v.passed) fixesPassed++;

    const top = [...inc.hypotheses].sort((a, b) => b.confidence - a.confidence)[0];
    // Seeded history has no explicit pick; the top-ranked cause was the one acted on.
    const chosen = inc.hypotheses.find((h) => h.id === inc.selectedHypothesis) ?? top;
    if (chosen.id === top.id) {
      topCauseChosen++;
      if (v.passed) topCausePassed++;
    }

    const conf = chosen.confidence;
    const idx = BUCKETS.findIndex(([, test]) => test(conf));
    if (idx >= 0) {
      calibration[idx].incidents++;
      if (v.passed) calibration[idx].passed++;
    }

    if (v.predictionHeld !== undefined && v.expectedPowerDevPct !== undefined) {
      predictionsScored++;
      if (v.predictionHeld) predictionsHeld++;
      errSum += Math.abs((v.metrics.powerDevPct ?? 0) - v.expectedPowerDevPct);
    }
  }

  return {
    scope: machineId ? 'machine' : 'plant',
    machineId,
    graded: graded.length,
    fixesPassed,
    topCauseChosen,
    topCausePassed,
    predictionsScored,
    predictionsHeld,
    avgPredictionErrorPts: predictionsScored ? Math.round((errSum / predictionsScored) * 10) / 10 : null,
    calibration,
  };
}

export function getTrackRecord(machineId?: string): TrackRecord {
  return computeTrackRecord(getIncidents() as unknown as GradableIncident[], machineId);
}
