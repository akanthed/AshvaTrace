import { describe, it, expect } from 'vitest';
import { applyGrounding, buildFactBank, checkHypothesis } from '../utils/grounding';
import type { Hypothesis } from '../utils/ai';
import { SCENARIOS, buildSeries, currentSignals } from '../eval/scenarios';
import { scoreScenario, summarize } from '../eval/score';
import { createToolExecutor } from '../services/investigationTools';
import { FALLBACK_SOPS, selectSops } from '../services/sopService';

const bank = buildFactBank({
  signals: { powerDevPct: 8.3, vibration: 4.1, cycleTime: 109 },
  trace: [
    {
      type: 'tool_result',
      tool: 'get_vibration_stats',
      result: { currentMmS: 4.1, avgMmS: 3.2, healthyBelowMmS: 3, trendingUp: true },
    },
  ],
  sops: [{ id: 'SOP-101', title: 'Process Drift Response', body: 'Vibration under 4.5 mm/s after repair.' }],
  pastIncidents: [
    {
      id: 'INC-PAST-001',
      detectedAt: '2026-10-03T08:00:00Z',
      devPct: 7.9,
      severity: 'critical',
      status: 'closed',
      topHypothesis: 'Worn tool',
      actionTaken: 'Replaced insert',
      verificationPassed: true,
      resolutionComment: null,
    },
  ],
});

const hyp = (over: Partial<Hypothesis>): Hypothesis => ({
  id: 'HYP-1',
  title: 'Worn cutting tool',
  confidence: 80,
  evidenceFor: [],
  evidenceAgainst: [],
  sopRef: 'SOP-101',
  ...over,
});

describe('grounding', () => {
  it('verifies figures that appear in the data, allowing rounding', () => {
    const r = checkHypothesis(
      hyp({ evidenceFor: ['Power is 8% above normal', 'Vibration is 4.1 mm/s, above the 3 mm/s healthy limit'] }),
      bank
    );
    expect(r.status).toBe('verified');
    expect(r.figuresChecked).toBe(3);
    expect(r.unsupportedFigures).toEqual([]);
  });

  it('flags an invented figure', () => {
    const r = checkHypothesis(hyp({ evidenceFor: ['Vibration hit 9.7 mm/s', 'Power is 8.3% high'] }), bank);
    expect(r.unsupportedFigures).toEqual(['9.7 mm/s']);
    expect(r.status).toBe('partial');
  });

  it('ignores machine ids, hypothesis ids and small counting numbers', () => {
    const r = checkHypothesis(hyp({ evidenceFor: ['CNC-01 showed 2 readings above normal, per HYP-1 and SOP-101'] }), bank);
    expect(r.figuresChecked).toBe(0);
  });

  it('flags an unknown SOP or past-incident reference', () => {
    const r = checkHypothesis(
      hyp({ sopRef: 'SOP-999', evidenceFor: ['Matches INC-PAST-777 where power was 8.3% high'] }),
      bank
    );
    expect(r.badReferences).toEqual(['SOP-999', 'INC-PAST-777']);
  });

  it('accepts a real past-incident reference and its date', () => {
    const r = checkHypothesis(hyp({ evidenceFor: ['Matches INC-PAST-001 from Oct 3, when power was 7.9% high'] }), bank);
    expect(r.badReferences).toEqual([]);
    expect(r.status).toBe('verified');
  });

  it('only lowers confidence, removes a bad SOP ref, and drops mostly-unsupported hypotheses', () => {
    const good = hyp({ id: 'HYP-1', confidence: 70, evidenceFor: ['Power is 8.3% high', 'Vibration is 4.1 mm/s'] });
    const invented = hyp({
      id: 'HYP-2',
      title: 'Coolant failure',
      confidence: 90,
      sopRef: 'SOP-999',
      evidenceFor: ['Coolant at 55 degrees', 'Flow down 31%'],
    });
    const { hypotheses, dropped } = applyGrounding([invented, good], bank);
    expect(hypotheses.map((h) => h.id)).toEqual(['HYP-1']);
    expect(dropped).toEqual(['Coolant failure']);
    expect(hypotheses[0].confidence).toBeLessThanOrEqual(70);
  });

  it('keeps everything, flagged, when nothing is grounded', () => {
    const { hypotheses, dropped } = applyGrounding([hyp({ evidenceFor: ['Flow down 31%'], confidence: 90 })], bank);
    expect(hypotheses).toHaveLength(1);
    expect(dropped).toEqual([]);
    expect(hypotheses[0].grounding?.status).toBe('unverified');
    expect(hypotheses[0].confidence).toBeLessThan(90);
  });

  it('caps confidence for a hypothesis that cites no figures', () => {
    const { hypotheses } = applyGrounding([hyp({ evidenceFor: ['Looks worn'], confidence: 95 })], bank);
    expect(hypotheses[0].confidence).toBeLessThanOrEqual(40);
  });
});

describe('eval harness', () => {
  it('builds scenario data that the real tool executor and SOP retrieval can use', async () => {
    const s = SCENARIOS[0];
    const series = buildSeries(s);
    const { signals } = currentSignals(series);
    const exec = createToolExecutor(() => series, () => ({}));
    const vib = (await exec('get_vibration_stats', { samples: 240 })) as { trendingUp: boolean };
    expect(vib.trendingUp).toBe(true);
    expect(selectSops(FALLBACK_SOPS, signals).map((x) => x.id)).toContain('SOP-101');
  });

  it('scores top-1 / top-3 against the known cause and summarizes', () => {
    const s = SCENARIOS.find((x) => x.id === 'spindle-bearing')!;
    const right = hyp({ title: 'Spindle bearing wear', confidence: 60 });
    const wrong = hyp({ id: 'HYP-2', title: 'Coolant failure', confidence: 80 });
    const miss = scoreScenario(s, [right, wrong], 0);
    expect(miss.top1).toBe(false);
    expect(miss.top3).toBe(true);
    const hit = scoreScenario(s, [{ ...right, confidence: 90 }, wrong], 1);
    expect(hit.top1).toBe(true);
    expect(summarize([miss, hit])).toMatchObject({ scenarios: 2, top1Accuracy: 0.5, top3Accuracy: 1 });
  });
});
