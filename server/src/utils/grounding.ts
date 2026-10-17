import type { Hypothesis, InvestigationTraceStep, PastIncidentRef, SopExcerpt } from './ai';

// Deterministic grounding check. The model proposes hypotheses; this code —
// not AI — checks every figure a hypothesis quotes against the data the
// investigation actually saw (live signals, tool results, SOP text, past
// incidents). A figure the model invented cannot be found in that data, so it
// is flagged, the hypothesis's confidence is cut, and a hypothesis that is
// mostly unsupported is dropped. Same split as verify(): AI proposes, code
// checks.

export interface GroundingReport {
  figuresChecked: number;
  figuresVerified: number;
  // The figures (as written in the evidence text) that match nothing the
  // investigation actually saw.
  unsupportedFigures: string[];
  // SOP or past-incident references that do not exist in the retrieved set.
  badReferences: string[];
  status: 'verified' | 'partial' | 'unverified';
}

export interface FactBank {
  numbers: number[];
  sopIds: Set<string>;
  incidentIds: Set<string>;
}

export interface GroundingInput {
  signals: Record<string, number>;
  trace: InvestigationTraceStep[];
  sops: SopExcerpt[];
  pastIncidents: PastIncidentRef[];
}

// Identifiers like HYP-1, SOP-101, INC-PAST-001, CNC-01 contain digits that
// are labels, not measurements.
const ID_TOKEN = /\b[A-Za-z]+(?:-[A-Za-z0-9]+)+\b/g;
// A number, plus the unit that directly follows it (if any).
const FIGURE = /(-?\d+(?:\.\d+)?)(\s*(?:%|mm\/s|kw|sec|s\b))?/gi;
const REL_TOL = 0.02;

function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (typeof value === 'string') out.push(...numbersInText(value));
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, out));
}

function numbersInText(text: string): number[] {
  const nums: number[] = [];
  for (const m of text.replace(ID_TOKEN, ' ').matchAll(FIGURE)) nums.push(parseFloat(m[1]));
  return nums;
}

export function buildFactBank(input: GroundingInput): FactBank {
  const numbers: number[] = [];
  collectNumbers(input.signals, numbers);
  for (const step of input.trace) {
    if (step.type === 'tool_result') collectNumbers(step.result, numbers);
  }
  for (const s of input.sops) numbers.push(...numbersInText(s.body));
  for (const p of input.pastIncidents) {
    numbers.push(p.devPct);
    if (p.resolutionComment) numbers.push(...numbersInText(p.resolutionComment));
    const d = new Date(p.detectedAt);
    if (!Number.isNaN(d.getTime())) numbers.push(d.getDate(), d.getFullYear());
  }
  return {
    numbers,
    sopIds: new Set(input.sops.map((s) => s.id)),
    incidentIds: new Set(input.pastIncidents.map((p) => p.id)),
  };
}

function decimals(raw: string): number {
  const dot = raw.indexOf('.');
  return dot === -1 ? 0 : raw.length - dot - 1;
}

function isSupported(raw: string, claimed: number, bank: FactBank): boolean {
  // Allow for the model rounding a real figure ("8%" for 8.3) and for a
  // small relative drift.
  const tol = Math.max(0.5 * Math.pow(10, -decimals(raw)), REL_TOL * Math.abs(claimed));
  return bank.numbers.some((f) => Math.abs(Math.abs(f) - Math.abs(claimed)) <= tol);
}

interface Figure {
  text: string;
  value: number;
}

// Figures worth checking: skip bare small integers ("2 readings", "3 of 5"),
// which are counting words, not measurements.
function extractFigures(text: string): Figure[] {
  const figs: Figure[] = [];
  for (const m of text.replace(ID_TOKEN, ' ').matchAll(FIGURE)) {
    const value = parseFloat(m[1]);
    const hasUnit = Boolean(m[2]);
    if (!hasUnit && Number.isInteger(value) && Math.abs(value) <= 5) continue;
    figs.push({ text: `${m[1]}${m[2] ?? ''}`.trim(), value });
  }
  return figs;
}

export function checkHypothesis(h: Hypothesis, bank: FactBank): GroundingReport {
  const figures = [...h.evidenceFor, ...h.evidenceAgainst].flatMap(extractFigures);
  const unsupported = figures.filter((f) => !isSupported(f.text.replace(/[^\d.-]/g, ''), f.value, bank));

  const badReferences: string[] = [];
  if (h.sopRef && !bank.sopIds.has(h.sopRef)) badReferences.push(h.sopRef);
  const text = [h.title, ...h.evidenceFor, ...h.evidenceAgainst].join(' ');
  for (const id of text.match(/\bINC-[A-Za-z0-9-]+/g) ?? []) {
    if (!bank.incidentIds.has(id)) badReferences.push(id);
  }

  const checked = figures.length;
  const verified = checked - unsupported.length;
  let status: GroundingReport['status'];
  if (checked === 0 || verified / checked < 0.5) status = 'unverified';
  else if (unsupported.length > 0 || badReferences.length > 0) status = 'partial';
  else status = 'verified';

  return {
    figuresChecked: checked,
    figuresVerified: verified,
    unsupportedFigures: unsupported.map((f) => f.text),
    badReferences,
    status,
  };
}

export interface GroundingResult {
  hypotheses: Hypothesis[];
  dropped: string[];
}

// Attaches a grounding report to every hypothesis and applies the policy:
// confidence can only go down, an invented SOP reference is removed, and a
// hypothesis whose figures are mostly unsupported is dropped — unless that
// would leave nothing to show, in which case all are kept, flagged.
export function applyGrounding(hypotheses: Hypothesis[], bank: FactBank): GroundingResult {
  const checked = hypotheses.map((h) => {
    const grounding = checkHypothesis(h, bank);
    let confidence = h.confidence;
    if (grounding.figuresChecked === 0) confidence = Math.min(confidence, 40);
    else if (grounding.figuresVerified < grounding.figuresChecked) {
      confidence = Math.min(confidence, Math.round((confidence * grounding.figuresVerified) / grounding.figuresChecked));
    }
    if (grounding.badReferences.length > 0) confidence = Math.min(confidence, Math.round(confidence * 0.8));
    const sopRef = h.sopRef && !bank.sopIds.has(h.sopRef) ? null : h.sopRef;
    return { ...h, confidence, sopRef, grounding };
  });

  const keep = checked.filter((h) => h.grounding.status !== 'unverified');
  const kept = keep.length > 0 ? keep : checked;
  const dropped = keep.length > 0 ? checked.filter((h) => h.grounding.status === 'unverified').map((h) => h.title) : [];
  kept.sort((a, b) => b.confidence - a.confidence);
  return { hypotheses: kept, dropped };
}
