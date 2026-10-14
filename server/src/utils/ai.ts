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
}

// Full generateContent call that also returns any functionCall parts the
// model emitted. vertexAIRequest() below is a thin wrapper that drops the
// tool calls — existing callers are unaffected.
export function vertexAIRequestFull(
  model: string,
  prompt: string,
  config: Record<string, unknown> = {},
  tools?: Array<Record<string, unknown>>
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
                  resolve({ text, toolCalls });
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
  config: Record<string, unknown> = {}
): Promise<string> {
  return vertexAIRequestFull(model, prompt, config).then((r) => r.text);
}

function extractJson(text: string): unknown {
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
  sops: SopExcerpt[] = []
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

  const text = await vertexAIRequest(geminiModel(), prompt, { temperature: 0.3, maxOutputTokens: 1024, ...NO_THINKING });
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
];

export async function investigateAgentic(
  context: { machineId: string; devPct: number; signals: Record<string, number> },
  sops: SopExcerpt[] = [],
  toolExecutor: (name: string, args: Record<string, unknown>) => unknown
): Promise<AgenticInvestigationResult> {
  const trace: InvestigationTraceStep[] = [];
  const maxRounds = 3; // observe -> tools -> reason, capped so a chatty model can't loop forever

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
        result = toolExecutor(call.name, call.args);
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
  sops: SopExcerpt[] = []
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
    const text = await vertexAIRequest(geminiModel(), prompt, { temperature: 0.1, maxOutputTokens: 512, ...NO_THINKING });
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
  sop?: SopExcerpt
): Promise<SimulationResult> {
  const sopText = sop ? `\n\nRelevant SOP for what "recovered" should look like:\n${sop.id} — ${sop.title}:\n${sop.body}` : '';
  const prompt = `You are an industrial maintenance AI. Machine "${params.machineId}" has hypothesis "${params.hypothesis}".
Proposed action: "${params.action}"${sopText}

Predict the outcome if this action is taken:
- predictedOutcome: 1-2 sentences, specific to this machine and action, written in plain words a shift supervisor would understand (no jargon)
- confidence: 0-100

Respond with ONLY a JSON object, no markdown, no explanation.`;

  const text = await vertexAIRequest(geminiModel(), prompt, { temperature: 0.3, maxOutputTokens: 256, ...NO_THINKING });
  const parsed = extractJson(text) as any;
  return {
    action: params.action,
    predictedOutcome: parsed.predictedOutcome || 'Deviation should reduce to normal range',
    confidence: parsed.confidence || 70,
  };
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
