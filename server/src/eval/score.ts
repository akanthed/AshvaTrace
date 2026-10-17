import type { Hypothesis } from '../utils/ai';
import type { Scenario } from './scenarios';

export interface ScenarioScore {
  scenarioId: string;
  top1: boolean;
  top3: boolean;
  hypothesisCount: number;
  figuresChecked: number;
  figuresVerified: number;
  droppedByGrounding: number;
}

// Deterministic scoring against ground truth: rank by confidence, then test
// the true-cause pattern against titles. No AI judge.
export function scoreScenario(s: Scenario, hypotheses: Hypothesis[], droppedByGrounding: number): ScenarioScore {
  const ranked = [...hypotheses].sort((a, b) => b.confidence - a.confidence);
  const hit = (h: Hypothesis | undefined) => Boolean(h && s.expectedCause.test(h.title));
  return {
    scenarioId: s.id,
    top1: hit(ranked[0]),
    top3: ranked.slice(0, 3).some(hit),
    hypothesisCount: ranked.length,
    figuresChecked: ranked.reduce((n, h) => n + (h.grounding?.figuresChecked ?? 0), 0),
    figuresVerified: ranked.reduce((n, h) => n + (h.grounding?.figuresVerified ?? 0), 0),
    droppedByGrounding,
  };
}

export interface EvalSummary {
  scenarios: number;
  top1Accuracy: number;
  top3Accuracy: number;
  figureGroundingRate: number;
  hypothesesDroppedAsUnsupported: number;
}

export function summarize(scores: ScenarioScore[]): EvalSummary {
  const n = scores.length || 1;
  const checked = scores.reduce((a, s) => a + s.figuresChecked, 0);
  const verified = scores.reduce((a, s) => a + s.figuresVerified, 0);
  return {
    scenarios: scores.length,
    top1Accuracy: scores.filter((s) => s.top1).length / n,
    top3Accuracy: scores.filter((s) => s.top3).length / n,
    figureGroundingRate: checked === 0 ? 0 : verified / checked,
    hypothesesDroppedAsUnsupported: scores.reduce((a, s) => a + s.droppedByGrounding, 0),
  };
}
