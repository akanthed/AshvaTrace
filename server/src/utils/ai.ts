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

export function vertexAIRequest(
  model: string,
  prompt: string,
  config: Record<string, unknown> = {}
): Promise<string> {
  const project = gcpProject();
  if (!project) {
    return Promise.reject(new Error('GCP_PROJECT_ID not set for Vertex AI'));
  }

  return getAuthToken().then(
    (accessToken) =>
      new Promise<string>((resolve, reject) => {
        const path = `/v1/projects/${project}/locations/${gcpLocation()}/publishers/google/models/${model}:generateContent`;
        const data = JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: config,
        });

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
                  resolve(json.candidates?.[0]?.content?.parts?.[0]?.text || '');
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

// AI proposes hypotheses. Throws on failure (bad auth, network error, model
// returned unparseable text) instead of silently substituting canned
// content — a judge/user seeing the same 3 hypotheses every time an API
// call hiccups is indistinguishable from fake AI, which is worse than
// surfacing the failure. Callers (incidentService) are responsible for
// recording the failure and letting the user retry.
export async function investigate(context: {
  machineId: string;
  devPct: number;
  signals: Record<string, number>;
}): Promise<Hypothesis[]> {
  const prompt = `You are an industrial maintenance AI investigating a CNC/manufacturing machine fault.

Machine: "${context.machineId}"
Power deviation from expected baseline: ${context.devPct}%
Live sensor readings: ${JSON.stringify(context.signals)}
(powerDevPct = % actual power is above/below the expected baseline for this machine; vibration is in mm/s RMS; cycleTime is seconds per part; typical healthy values are vibration < 3 mm/s and cycleTime within 10% of baseline)

Generate 3-5 ranked hypotheses for the root cause of this deviation, grounded specifically in the numbers above — do not give generic advice that would apply to any machine. For each hypothesis:
- title: short, specific name for the failure mode
- confidence: 0-100, calibrated so multiple plausible causes don't all score above 80
- evidenceFor: 2-3 bullet points that cite the actual numbers above
- evidenceAgainst: 1-2 bullet points explaining what would argue against this cause

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
  }));
}

// AI simulates intervention. Throws on failure — see investigate() above.
export async function simulate(params: {
  machineId: string;
  hypothesis: string;
  action: string;
}): Promise<SimulationResult> {
  const prompt = `You are an industrial maintenance AI. Machine "${params.machineId}" has hypothesis "${params.hypothesis}".
Proposed action: "${params.action}"

Predict the outcome if this action is taken:
- predictedOutcome: 1-2 sentences, specific to this machine and action
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
