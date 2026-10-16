import { GoogleAuth } from 'google-auth-library';
import https from 'https';

// Vertex AI (GCP project billing) — no separate Gemini API key needed.
// Read lazily (not at module load) so dotenv.config() in index.ts — which runs
// after this module is transitively imported — has already populated process.env.
export function geminiModel() {
  return process.env.GEMINI_MODEL || 'gemini-3.8-flash';
}
function gcpProject() {
  return process.env.GCP_PROJECT_ID || '';
}
function gcpLocation() {
  return process.env.GCP_LOCATION || 'us-central1';
}

// gemini-3.8-flash is a thinking model: without this it can spend its entire
// maxOutputTokens budget on hidden reasoning and return a MAX_TOKENS response
// with no visible text at all.
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } };

// Gemini Flash published per-token pricing (USD), overridable via env since
// rates change and vary by model. Defaults match Gemini 2.0/2.5 Flash list
// pricing at time of writing: $0.10 / 1M input tokens, $0.40 / 1M output
// tokens (see ai.google.dev/pricing).
function inputRatePerToken() {
  return Number(process.env.GEMINI_INPUT_USD_PER_1M || 0.10) / 1_000_000;
}
function outputRatePerToken() {
  return Number(process.env.GEMINI_OUTPUT_USD_PER_1M || 0.40) / 1_000_000;
}

export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  costUsd: number;
}

function usageFromMetadata(meta: any): TokenUsage {
  const promptTokens = meta?.promptTokenCount || 0;
  const outputTokens = meta?.candidatesTokenCount || 0;
  const costUsd = promptTokens * inputRatePerToken() + outputTokens * outputRatePerToken();
  return { promptTokens, outputTokens, costUsd };
}

// Accumulates the real token usage/cost of every Gemini call that goes into
// one investigation or simulation, so the engineer sees what the AI step
// actually cost — not an estimate. Passed by reference into the AI
// functions below; they record into it as a side effect so call sites
// (incidentService) don't need their return types to change.
export class CostTracker {
  private calls: TokenUsage[] = [];

  record(usage: TokenUsage): void {
    this.calls.push(usage);
  }

  totalCostUsd(): number {
    return this.calls.reduce((sum, c) => sum + c.costUsd, 0);
  }

  totalTokens(): number {
    return this.calls.reduce((sum, c) => sum + c.promptTokens + c.outputTokens, 0);
  }

  callCount(): number {
    return this.calls.length;
  }
}

let authClient: GoogleAuth | null = null;

async function getAuthToken(): Promise<string> {
  if (!authClient) {
    authClient = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  const token = await authClient.getAccessToken();
  if (!token) throw new Error('Failed to obtain Vertex AI access token');
  return token;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface VertexResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
}

// Full generateContent call that also returns any functionCall parts the
// model emitted. vertexAIRequest() below is a thin wrapper that drops the
// tool calls — existing callers are unaffected. When `tracker` is passed,
// this call's real token usage/cost is recorded into it.
export function vertexAIRequestFull(
  model: string,
  prompt: string,
  config: Record<string, unknown> = {},
  tools?: Array<Record<string, unknown>>,
  tracker?: CostTracker
): Promise<VertexResponse> {
  const project = gcpProject();
  if (!project) {
    return Promise.reject(new Error('GCP_PROJECT_ID not set for Vertex AI'));
  }

  return getAuthToken().then(
    (accessToken) =>
      new Promise<VertexResponse>((resolve, reject) => {
        const path = `/v1/projects/${project}/locations/${gcpLocation()}/publishers/google/models/${model}:generateContent`;
        const body: Record<string, unknown> = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: config,
        };
        if (tools && tools.length > 0) {
          body.tools = [{ functionDeclarations: tools }];
        }
        const data = JSON.stringify(body);

        const req = https.request(
          {
            hostname: 'aiplatform.googleapis.com',
            path,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
              'Content-Length': Buffer.byteLength(data),
            },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              try {
                const json = JSON.parse(body);
                if (json.error) {
                  reject(new Error(json.error.message || JSON.stringify(json.error)));
                } else {
                  const parts = json.candidates?.[0]?.content?.parts || [];
                  const text = parts.map((p: any) => p.text || '').join('');
                  const toolCalls: ToolCall[] = parts
                    .filter((p: any) => p.functionCall)
                    .map((p: any) => ({
                      id: p.functionCall.id || `call-${Math.random().toString(36).slice(2, 8)}`,
                      name: p.functionCall.name,
                      args: p.functionCall.args || {},
                    }));
                  const usage = usageFromMetadata(json.usageMetadata);
                  if (tracker) tracker.record(usage);
                  resolve({ text, toolCalls, usage });
                }
              } catch (e) {
                reject(new Error(`Failed to parse Vertex AI response: ${body.slice(0, 200)}`));
              }
            });
          }
        );

        req.on('error', reject);
        req.write(data);
        req.end();
      })
  );
}

export function vertexAIRequest(
  model: string,
  prompt: string,
  config: Record<string, unknown> = {},
  tracker?: CostTracker
): Promise<string> {
  return vertexAIRequestFull(model, prompt, config, undefined, tracker).then((r) => r.text);
}

export function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fall through to markdown/code-fence extraction below
  }
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return JSON.parse(arrayMatch[0]);
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return JSON.parse(objectMatch[0]);
  throw new Error(`No valid JSON in response: ${text.slice(0, 300)}`);
}

export interface Hypothesis {
  id: string;
  title: string;
  confidence: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  sopRef?: string | null;
}

export interface SimulationResult {
  action: string;
  predictedOutcome: string;
  confidence: number;
}

export interface VerificationResult {
  passed: boolean;
  actualOutcome: string;
  metrics: Record<string, number>;
}

export interface SopExcerpt {
  id: string;
  title: string;
  body: string;
}

function formatSops(sops: SopExcerpt[]): string {
  if (sops.length === 0) return '(no matching SOP found — reason from the signals alone)';
  return sops.map((s) => `${s.id} — ${s.title}:\n${s.body}`).join('\n\n');
}

// AI proposes hypotheses. Throws on failure (bad auth, network error, model
// returned unparseable text) instead of silently substituting canned
// content — a judge/user seeing the same 3 hypotheses every time an API
// call hiccups is indistinguishable from fake AI, which is worse than
// surfacing the failure. Callers (incidentService) are responsible for
// recording the failure and letting the user retry.
//
// This is a two-step reasoning chain, not a single-shot call: step 1 (this
// function) proposes hypotheses grounded in retrieved SOP text; step 2
// (critiqueHypotheses, called separately by incidentService) re-checks each
// one against the same SOP text and the numbers, and corrects confidence
// where the proposal oversold or undersold the evidence.
export async function investigate(
  context: {
    machineId: string;
    devPct: number;
    signals: Record<string, number>;
  },
  sops: SopExcerpt[] = [],
  tracker?: CostTracker
): Promise<Hypothesis[]> {
  const prompt = `You are an industrial maintenance AI investigating a CNC/manufacturing machine fault.

Machine: "${context.machineId}"
Power deviation from expected baseline: ${context.devPct}%
Live sensor readings: ${JSON.stringify(context.signals)}
(powerDevPct = % actual power is above/below the expected baseline for this machine; vibration is in mm/s RMS; cycleTime is seconds per part; typical healthy values are vibration < 3 mm/s and cycleTime within 10% of baseline)

Relevant standard operating procedure (SOP) excerpts for this plant — use these as your primary reference, not general knowledge:
${formatSops(sops)}

Generate 3-5 ranked hypotheses for the root cause of this deviation, grounded specifically in the numbers above and in the SOP excerpts. For each hypothesis:
- title: short, specific name for the failure mode
- confidence: 0-100, calibrated so multiple plausible causes don't all score above 80
- evidenceFor: 2-3 bullet points that cite the actual numbers above, written in plain words a shift supervisor with no engineering background would understand (e.g. "power is running 8% above normal and has been climbing for the last hour" instead of "devPct exhibits monotonic drift")
- evidenceAgainst: 1-2 bullet points, same plain-language style, explaining what would argue against this cause
- sopRef: the SOP id this hypothesis follows (e.g. "SOP-101"), or null if none of the excerpts apply

Respond with ONLY a JSON array, no markdown, no explanation.`;

  const text = await vertexAIRequest(geminiModel(), prompt, { temperature: 0.3, maxOutputTokens: 1024, ...NO_THINKING }, tracker);
  const parsed = extractJson(text);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((h: any, i: number) => ({
    id: `HYP-${i + 1}`,
    title: h.title || `Hypothesis ${i + 1}`,
    confidence: h.confidence || 50,
    evidenceFor: h.evidenceFor || [],
    evidenceAgainst: h.evidenceAgainst || [],
    sopRef: h.sopRef || null,
  }));
}

// Agentic investigation: the model is given a set of tools that pull REAL
// readings from the machine's series (power window, vibration stats, cycle
// time trend) and is asked to call them before forming hypotheses. This is
// the "LLM queries live OT data" pattern — the numbers in the final
// hypotheses come from tool results, not from the model's memory.
//
// Returns both the hypotheses and the trace (each tool call + its result +
// the model's reasoning) so the UI can show the investigation step by step.
export interface InvestigationTraceStep {
  type: 'tool_call' | 'tool_result' | 'reasoning';
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  text?: string;
}

export interface AgenticInvestigationResult {
  hypotheses: Hypothesis[];
  trace: InvestigationTraceStep[];
}

const INVESTIGATION_TOOLS = [
  {
    name: 'get_power_window',
    description:
      'Get the machine\'s actual vs expected power (kW) for a window of the shift. Returns the last N samples with timestamp, actual, expected, and deviation percent.',
    parameters: {
      type: 'OBJECT',
      properties: {
        samples: { type: 'INTEGER', description: 'How many recent samples to return (default 60, max 240)' },
      },
    },
  },
  {
    name: 'get_vibration_stats',
    description:
      'Get vibration (mm/s RMS) statistics for the machine: current value, min, max, and average over the last N samples, plus whether it is trending up.',
    parameters: {
      type: 'OBJECT',
      properties: {
        samples: { type: 'INTEGER', description: 'How many recent samples to include (default 120, max 480)' },
      },
    },
  },
  {
    name: 'get_cycle_time_trend',
    description:
      'Get the machine\'s cycle time (seconds per part) trend: current value, baseline average, and the rate of change over the last N samples.',
    parameters: {
      type: 'OBJECT',
      properties: {
        samples: { type: 'INTEGER', description: 'How many recent samples to include (default 120, max 480)' },
      },
    },
  },
  {
    name: 'inspect_tool',
    description:
      'Run a Vision AI inspection of the machine\'s cutting tool. Analyzes a synthetic tool inspection image and returns condition (good/worn/critical), wear percentage, visual observations, and a recommendation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        wearLevel: { type: 'INTEGER', description: 'Estimated wear level 0-100 to generate the inspection image (use the power deviation as a proxy: higher deviation = more wear)' },
      },
    },
  },
];

export interface PastIncidentRef {
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

export async function investigateAgentic(
  context: { machineId: string; devPct: number; signals: Record<string, number> },
  sops: SopExcerpt[] = [],
  toolExecutor: (name: string, args: Record<string, unknown>) => unknown | Promise<unknown>,
  pastIncidents: PastIncidentRef[] = [],
  tracker?: CostTracker
): Promise<AgenticInvestigationResult> {
  const trace: InvestigationTraceStep[] = [];
  const maxRounds = 3; // observe -> tools -> reason, capped so a chatty model can't loop forever

  // Format past incidents for the prompt so the AI can reference prior
  // resolutions: "last time this pattern appeared, the fix was X and
  // verification confirmed it."
  const pastIncidentsSection = pastIncidents.length > 0
    ? `\n\nPAST INCIDENTS ON THIS MACHINE (resolved) — USE THESE TO INFORM YOUR HYPOTHESES:
${pastIncidents.map((p) => {
        const date = new Date(p.detectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const lines = [
          `  ${p.id} (${date}): deviation ${p.devPct}%, severity ${p.severity}`,
          p.topHypothesis ? `    Root cause: ${p.topHypothesis}` : null,
          p.actionTaken ? `    Fix applied: ${p.actionTaken}` : null,
          p.verificationPassed !== null ? `    Did the fix work: ${p.verificationPassed ? 'YES — verified' : 'NO — fix failed'}` : null,
          p.resolutionComment ? `    Engineer note: ${p.resolutionComment}` : null,
        ].filter(Boolean);
        return lines.join('\n');
      }).join('\n')}

CRITICAL INSTRUCTION — YOU MUST USE PAST INCIDENTS:
- If a past incident has a similar cause, you MUST reference it explicitly in your top hypothesis. Example: "This matches INC-PAST-001 from Oct 3, where the same spindle bearing failure was confirmed and fixed by replacing the bearing."
- If a past fix was verified (worked), suggest it as the top hypothesis and say "This fix was verified to work last time."
- If a past fix failed, warn against repeating it and say "This approach was tried before and did not work."
- The engineer reading this needs to see the connection to history clearly. Do not bury it in technical jargon. Write in plain language.`
    : '';

  const systemPrompt = `You are an industrial maintenance AI investigating a CNC/manufacturing machine fault.

Machine: "${context.machineId}"
Initial power deviation from expected baseline: ${context.devPct}%
Initial sensor readings: ${JSON.stringify(context.signals)}

You have tools to pull REAL readings from this machine's sensor history. Use them BEFORE forming hypotheses — do not guess numbers. A good investigation:
1. Call get_power_window to see how the deviation has evolved (is it a spike or a sustained drift?)
2. Call get_vibration_stats to check if vibration is rising alongside power
3. Call get_cycle_time_trend to see if the machine is working slower
Then form 3-5 ranked hypotheses grounded in the tool results.

Relevant standard operating procedure (SOP) excerpts for this plant — use these as your primary reference, not general knowledge:
${formatSops(sops)}
${pastIncidentsSection}

For each hypothesis:
- title: short, specific name for the failure mode
- confidence: 0-100, calibrated so multiple plausible causes don't all score above 80
- evidenceFor: 2-3 bullet points citing the ACTUAL numbers from the tool results, in plain words a shift supervisor would understand
- evidenceAgainst: 1-2 bullet points, same plain-language style
- sopRef: the SOP id this hypothesis follows (e.g. "SOP-101"), or null if none apply

When you are done gathering evidence, respond with ONLY a JSON array of hypotheses, no markdown, no explanation.`;

  // Conversation state: we replay the full history each round (Gemini
  // generateContent is stateless per request).
  const contents: Array<Record<string, unknown>> = [
    { role: 'user', parts: [{ text: systemPrompt }] },
  ];

  let hypotheses: Hypothesis[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const body: Record<string, unknown> = {
      contents,
      tools: [{ functionDeclarations: INVESTIGATION_TOOLS }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048, ...NO_THINKING },
    };

    const project = gcpProject();
    const token = await getAuthToken();
    const path = `/v1/projects/${project}/locations/${gcpLocation()}/publishers/google/models/${geminiModel()}:generateContent`;
    const data = JSON.stringify(body);

    const json = await new Promise<any>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'aiplatform.googleapis.com',
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(b);
              if (parsed.error) reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
              else resolve(parsed);
            } catch (e) {
              reject(new Error(`Failed to parse Vertex AI response: ${b.slice(0, 200)}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });

    const parts = json.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text || '').join('');
    const toolCalls: ToolCall[] = parts
      .filter((p: any) => p.functionCall)
      .map((p: any) => ({
        id: p.functionCall.id || `call-${Math.random().toString(36).slice(2, 8)}`,
        name: p.functionCall.name,
        args: p.functionCall.args || {},
      }));
    if (tracker) tracker.record(usageFromMetadata(json.usageMetadata));

    // Append the model's turn to the conversation.
    contents.push({ role: 'model', parts });

    if (toolCalls.length === 0) {
      // No more tool calls — the model is done gathering evidence.
      if (text.trim()) {
        trace.push({ type: 'reasoning', text: text.trim() });
        const parsed = extractJson(text);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        hypotheses = list.map((h: any, i: number) => ({
          id: `HYP-${i + 1}`,
          title: h.title || `Hypothesis ${i + 1}`,
          confidence: h.confidence || 50,
          evidenceFor: h.evidenceFor || [],
          evidenceAgainst: h.evidenceAgainst || [],
          sopRef: h.sopRef || null,
        }));
      }
      break;
    }

    // Execute each tool call and feed the results back.
    const functionResponses: Array<Record<string, unknown>> = [];
    for (const call of toolCalls) {
      trace.push({ type: 'tool_call', tool: call.name, args: call.args });
      let result: unknown;
      try {
        result = await toolExecutor(call.name, call.args);
      } catch (err: any) {
        result = { error: err.message || String(err) };
      }
      trace.push({ type: 'tool_result', tool: call.name, result });
      functionResponses.push({
        functionResponse: {
          id: call.id,
          name: call.name,
          response: { content: result },
        },
      });
    }
    contents.push({ role: 'user', parts: functionResponses });
  }

  if (hypotheses.length === 0) {
    throw new Error('Agentic investigation produced no hypotheses (model exhausted tool rounds without a final answer)');
  }

  return { hypotheses, trace };
}

// Second step of the reasoning chain: a fresh Gemini call whose only job is
// to check the first call's work — does each hypothesis's evidence actually
// match the cited SOP clause and the real numbers, or did the proposal step
// overstate it? This is what makes the pipeline "structured reasoning" and
// not just the same prompt asked twice: step 1 proposes, step 2 critiques,
// each with its own narrow instruction. Confidence-only adjustment (never
// rewrites evidence text) keeps the output auditable against step 1's output.
export async function critiqueHypotheses(
  context: { machineId: string; devPct: number; signals: Record<string, number> },
  hypotheses: Hypothesis[],
  sops: SopExcerpt[] = [],
  tracker?: CostTracker
): Promise<Hypothesis[]> {
  if (hypotheses.length === 0) return hypotheses;

  const prompt = `You are a quality-control reviewer checking another AI's fault-diagnosis work before it reaches an engineer.

Machine: "${context.machineId}", power deviation ${context.devPct}%, signals: ${JSON.stringify(context.signals)}

SOP excerpts available:
${formatSops(sops)}

Draft hypotheses to review:
${JSON.stringify(hypotheses.map((h) => ({ id: h.id, title: h.title, confidence: h.confidence, evidenceFor: h.evidenceFor, sopRef: h.sopRef })))}

For each hypothesis id, check ONLY two things:
1. Does its evidenceFor actually match the real numbers above (not exaggerated or invented)?
2. If it cites an sopRef, does the SOP excerpt actually support this cause?

If either check fails, lower that hypothesis's confidence (never raise it). If both checks pass, keep confidence unchanged. Do not change the title or evidence text.

Respond with ONLY a JSON array of {"id": string, "confidence": number}, no markdown, no explanation.`;

  try {
    const text = await vertexAIRequest(geminiModel(), prompt, { temperature: 0.1, maxOutputTokens: 512, ...NO_THINKING }, tracker);
    const parsed = extractJson(text);
    const corrections = new Map<string, number>(
      (Array.isArray(parsed) ? parsed : [parsed]).map((c: any) => [c.id, c.confidence])
    );
    return hypotheses.map((h) =>
      corrections.has(h.id) ? { ...h, confidence: corrections.get(h.id)! } : h
    );
  } catch {
    // The critique step is a refinement, not the core result — if it fails,
    // return the original proposal rather than throwing away a valid
    // investigation over the second call hiccuping.
    return hypotheses;
  }
}

// AI simulates intervention. Throws on failure — see investigate() above.
export async function simulate(
  params: {
    machineId: string;
    hypothesis: string;
    action: string;
  },
  sop?: SopExcerpt,
  tracker?: CostTracker
): Promise<SimulationResult> {
  const sopText = sop ? `\n\nRelevant SOP for what "recovered" should look like:\n${sop.id} — ${sop.title}:\n${sop.body}` : '';
  const prompt = `You are an industrial maintenance AI. Machine "${params.machineId}" has hypothesis "${params.hypothesis}".
Proposed action: "${params.action}"${sopText}

Predict the outcome if this action is taken:
- predictedOutcome: 1-2 sentences, specific to this machine and action, written in plain words a shift supervisor would understand (no jargon)
- confidence: 0-100

Respond with ONLY a JSON object, no markdown, no explanation.`;

  const text = await vertexAIRequest(geminiModel(), prompt, { temperature: 0.3, maxOutputTokens: 256, ...NO_THINKING }, tracker);
  const parsed = extractJson(text) as any;
  return {
    action: params.action,
    predictedOutcome: parsed.predictedOutcome || 'Deviation should reduce to normal range',
    confidence: parsed.confidence || 70,
  };
}

// Vision AI: analyze a synthetic tool-inspection image for wear/damage.
// Generates a deterministic "inspection photo" (SVG → base64) representing
// the tool condition, then asks Gemini to assess it. This demonstrates the
// Vision AI capability without requiring real camera hardware.
export interface VisionInspectionResult {
  condition: 'good' | 'worn' | 'critical';
  wearPct: number;
  observations: string[];
  recommendation: string;
}

export async function inspectToolImage(
  machineId: string,
  wearLevel: number, // 0-100, how worn the tool is (drives the synthetic image)
  tracker?: CostTracker
): Promise<VisionInspectionResult> {
  // Generate a deterministic SVG "inspection photo" of a cutting tool.
  // The visual appearance changes with wearLevel: clean edge → chipped → broken.
  const svg = generateToolInspectionSvg(machineId, wearLevel);
  const base64 = Buffer.from(svg).toString('base64');

  const prompt = `You are an industrial quality inspector analyzing a CNC cutting tool inspection image.

Machine: "${machineId}"

Analyze the tool condition in this image and report:
- condition: "good" (minimal wear), "worn" (noticeable wear, still usable), or "critical" (chipped/broken, must replace)
- wearPct: estimated wear percentage 0-100
- observations: 2-3 specific visual observations (edge geometry, surface finish, chip load)
- recommendation: one sentence on whether the tool should be replaced, re-sharpened, or is still serviceable

Respond with ONLY a JSON object, no markdown, no explanation.`;

  const project = gcpProject();
  const token = await getAuthToken();
  const path = `/v1/projects/${project}/locations/${gcpLocation()}/publishers/google/models/${geminiModel()}:generateContent`;

  const body = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/svg+xml', data: base64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 512, ...NO_THINKING },
  });

  const json = await new Promise<any>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'aiplatform.googleapis.com',
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(b);
            if (parsed.error) reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            else resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse Vertex AI response: ${b.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const text = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
  if (tracker) tracker.record(usageFromMetadata(json.usageMetadata));
  const parsed = extractJson(text) as any;

  return {
    condition: parsed.condition || 'worn',
    wearPct: parsed.wearPct || Math.round(wearLevel),
    observations: parsed.observations || ['Tool edge shows moderate wear'],
    recommendation: parsed.recommendation || 'Monitor and re-inspect next shift',
  };
}

// Deterministic SVG generation for synthetic tool inspection images.
// The tool's visual state changes with wearLevel (0=pristine, 100=broken).
function generateToolInspectionSvg(machineId: string, wearLevel: number): string {
  // Tool edge color: green (good) → yellow (worn) → red (critical)
  const edgeColor = wearLevel < 30 ? '#4caf50' : wearLevel < 70 ? '#ff9800' : '#f44336';
  // Edge shape: clean line → slightly chipped → visibly broken
  const edgePath =
    wearLevel < 30
      ? 'M 200 300 L 350 300 L 350 310 L 200 310 Z' // clean flat edge
      : wearLevel < 70
        ? 'M 200 300 L 340 300 L 345 305 L 335 310 L 350 310 L 200 310 Z' // slight chip
        : 'M 200 300 L 320 300 L 330 295 L 340 308 L 325 312 L 350 310 L 200 310 Z'; // broken

  // Surface texture: clean → scratched → pitted
  const scratches = wearLevel > 40
    ? `<line x1="220" y1="250" x2="300" y2="260" stroke="#999" stroke-width="1" opacity="0.5"/>
       <line x1="240" y1="270" x2="320" y2="275" stroke="#999" stroke-width="1" opacity="0.4"/>`
    : '';
  const pits = wearLevel > 70
    ? `<circle cx="250" cy="260" r="3" fill="#666" opacity="0.6"/>
       <circle cx="280" cy="280" r="2" fill="#666" opacity="0.5"/>
       <circle cx="310" cy="255" r="4" fill="#666" opacity="0.7"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#1a1a2e"/>
  <text x="200" y="30" text-anchor="middle" fill="#fff" font-family="monospace" font-size="14">Tool Inspection — ${machineId}</text>
  <text x="200" y="50" text-anchor="middle" fill="#888" font-family="monospace" font-size="11">Wear index: ${Math.round(wearLevel)}%</text>
  <!-- Tool body -->
  <rect x="180" y="100" width="40" height="200" fill="#555" rx="4"/>
  <rect x="170" y="290" width="60" height="30" fill="#444" rx="2"/>
  <!-- Cutting edge -->
  <path d="${edgePath}" fill="${edgeColor}" stroke="#333" stroke-width="1"/>
  <!-- Surface texture -->
  ${scratches}
  ${pits}
  <!-- Reference grid -->
  <line x1="100" y1="350" x2="350" y2="350" stroke="#333" stroke-width="1"/>
  <text x="100" y="370" fill="#666" font-family="monospace" font-size="10">0mm</text>
  <text x="350" y="370" fill="#666" font-family="monospace" font-size="10" text-anchor="end">10mm</text>
</svg>`;
}

// DETERMINISTIC verification (NOT AI) — this is the core differentiator
export function verify(
  simulation: SimulationResult,
  actualMetrics: Record<string, number>
): VerificationResult {
  // Deterministic check: compare actual metrics against predicted thresholds
  const powerDev = actualMetrics.powerDevPct || 0;
  const vibration = actualMetrics.vibrationMmS || 0;
  const cycleTime = actualMetrics.cycleTimeSec || 0;

  const passed =
    Math.abs(powerDev) < 3 && // Power within 3%
    vibration < 4.5 && // Vibration below critical
    cycleTime < 120; // Cycle time under 2 min

  return {
    passed,
    actualOutcome: passed
      ? 'All metrics within acceptable range. Intervention successful.'
      : 'One or more metrics still outside acceptable range. Further action needed.',
    metrics: {
      powerDevPct: Math.round(powerDev * 10) / 10,
      vibrationMmS: Math.round(vibration * 100) / 100,
      cycleTimeSec: Math.round(cycleTime * 10) / 10,
    },
  };
}
