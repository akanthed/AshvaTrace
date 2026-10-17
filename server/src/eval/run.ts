import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { critiqueHypotheses, investigateAgentic, CostTracker } from '../utils/ai';
import { applyGrounding, buildFactBank } from '../utils/grounding';
import { createToolExecutor } from '../services/investigationTools';
import { FALLBACK_SOPS, selectSops } from '../services/sopService';
import { SCENARIOS, buildSeries, currentSignals } from './scenarios';
import { scoreScenario, summarize, ScenarioScore } from './score';

// Live eval: runs the real Gemini investigation pipeline against scripted
// faults with known root causes. Usage: npm run eval
// Needs GCP_PROJECT_ID + Application Default Credentials, like the app.
async function main() {
  const tracker = new CostTracker();
  const scores: ScenarioScore[] = [];
  const detail: unknown[] = [];

  for (const s of SCENARIOS) {
    const series = buildSeries(s);
    const { devPct, signals } = currentSignals(series);
    const context = { machineId: s.machineId, devPct, signals };
    const sops = selectSops(FALLBACK_SOPS, signals);
    const executor = createToolExecutor(
      () => series,
      (wear) => ({ condition: wear > 60 ? 'worn' : 'good', wearPct: wear, observations: [], recommendation: 'n/a' })
    );

    process.stdout.write(`${s.id} ... `);
    const agentic = await investigateAgentic(context, sops, executor, [], tracker);
    const critiqued = await critiqueHypotheses(context, agentic.hypotheses, sops, tracker);
    const grounded = applyGrounding(
      critiqued,
      buildFactBank({ signals, trace: agentic.trace, sops, pastIncidents: [] })
    );
    const score = scoreScenario(s, grounded.hypotheses, grounded.dropped.length);
    scores.push(score);
    detail.push({
      ...score,
      top: grounded.hypotheses.map((h) => ({ title: h.title, confidence: h.confidence, grounding: h.grounding })),
    });
    console.log(score.top1 ? 'top-1 correct' : score.top3 ? 'in top-3' : 'MISS');
  }

  const summary = summarize(scores);
  const report = {
    ranAt: new Date().toISOString(),
    model: process.env.GEMINI_MODEL || 'default',
    costUsd: tracker.totalCostUsd(),
    summary,
    scenarios: detail,
  };
  const out = path.join(__dirname, '..', '..', 'eval-results.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  console.log(`\nTop-1 accuracy: ${pct(summary.top1Accuracy)}  Top-3: ${pct(summary.top3Accuracy)}`);
  console.log(`Figures verified against sensor data: ${pct(summary.figureGroundingRate)}`);
  console.log(`Unsupported hypotheses dropped by code: ${summary.hypothesesDroppedAsUnsupported}`);
  console.log(`Report: ${out}  (AI cost $${tracker.totalCostUsd().toFixed(4)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
