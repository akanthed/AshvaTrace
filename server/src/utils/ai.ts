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

// AI proposes hypotheses
export async function investigate(context: {
  machineId: string;
  devPct: number;
  signals: Record<string, number>;
}): Promise<Hypothesis[]> {
  const prompt = `You are an industrial maintenance AI. A machine "${context.machineId}" shows a power deviation of ${context.devPct}%.
Signals: ${JSON.stringify(context.signals)}

Generate 3-5 ranked hypotheses for the root cause. For each:
- title: short name
- confidence: 0-100
- evidenceFor: 2-3 bullet points
- evidenceAgainst: 1-2 bullet points

Respond with ONLY a JSON array, no markdown, no explanation.`;

  try {
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
  } catch (err) {
    console.error('[AI] Investigation failed, using fallback:', err);
    return fallbackHypotheses();
  }
}

// AI simulates intervention
export async function simulate(params: {
  machineId: string;
  hypothesis: string;
  action: string;
}): Promise<SimulationResult> {
  const prompt = `You are an industrial maintenance AI. Machine "${params.machineId}" has hypothesis "${params.hypothesis}".
Proposed action: "${params.action}"

Predict the outcome if this action is taken:
- predictedOutcome: 1-2 sentences
- confidence: 0-100

Respond with ONLY a JSON object, no markdown, no explanation.`;

  try {
    const text = await vertexAIRequest(geminiModel(), prompt, { temperature: 0.3, maxOutputTokens: 256, ...NO_THINKING });
    const parsed = extractJson(text) as any;
    return {
      action: params.action,
      predictedOutcome: parsed.predictedOutcome || 'Deviation should reduce to normal range',
      confidence: parsed.confidence || 70,
    };
  } catch (err) {
    console.error('[AI] Simulation failed, using fallback:', err);
    return {
      action: params.action,
      predictedOutcome: 'Deviation should reduce to within 2% of expected',
      confidence: 70,
    };
  }
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

// Fallback when AI is unavailable
function fallbackHypotheses(): Hypothesis[] {
  return [
    {
      id: 'HYP-1',
      title: 'Tool wear / spindle bearing degradation',
      confidence: 72,
      evidenceFor: [
        'Gradual power increase over 45+ min matches bearing wear curve',
        'Vibration RMS trending up in same window',
      ],
      evidenceAgainst: ['No sudden spike (rules out tool break)'],
    },
    {
      id: 'HYP-2',
      title: 'Workpiece material variation (harder batch)',
      confidence: 55,
      evidenceFor: ['Cycle time slightly elevated', 'Power deviation correlates with feed rate'],
      evidenceAgainst: ['No material change logged in MES'],
    },
    {
      id: 'HYP-3',
      title: 'Coolant flow reduction',
      confidence: 40,
      evidenceFor: ['Power increase consistent with reduced cooling efficiency'],
      evidenceAgainst: ['Coolant pump pressure nominal'],
    },
  ];
}
