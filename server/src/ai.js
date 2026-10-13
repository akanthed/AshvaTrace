const { GoogleGenAI } = require("@google/genai");

// --- Configuration ---
// Both Gemini and Gemma use Vertex AI (GCP project billing)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const GEMMA_MODEL = process.env.GEMMA_MODEL || "gemma-2-9b-it";
const GCP_PROJECT = process.env.GCP_PROJECT_ID || "";
const GCP_LOCATION = process.env.GCP_LOCATION || "us-central1";

let vertexClient = null;

function getVertexClient() {
  if (!vertexClient) {
    if (!GCP_PROJECT) throw new Error("GCP_PROJECT_ID not set for Vertex AI");
    vertexClient = new GoogleGenAI({
      vertexAI: true,
      project: GCP_PROJECT,
      location: GCP_LOCATION,
    });
  }
  return vertexClient;
}

// --- Prompt builders ---

function buildInvestigatePrompt(machine, type, evidence, meta) {
  const evText = Object.entries(evidence)
    .map(([id, ev]) => `${id}: ${ev.t} — ${ev.d}`)
    .join("\n");

  return `You are an industrial maintenance AI analyst for a CNC machining floor.
An incident has been detected on machine ${machine} (type: ${type}).

Evidence collected:
${evText}

Machine context: tool=${meta.tool}, batch=${meta.batch}, incident=${meta.incident || "none"}

Generate exactly 3 ranked hypotheses as a JSON array. Each hypothesis must have:
- "h": short title (max 8 words)
- "u": urgency — "Low", "Medium", or "High"
- "for": array of evidence IDs that support this hypothesis
- "ag": array of evidence IDs that argue against it
- "r": one-sentence reasoning for why this is plausible
- "agTxt": one-sentence explanation of the counter-evidence
- "nc": next check action (specific, actionable)
- "sop": SOP reference (e.g. "SOP-102 §3")

Respond with ONLY the JSON array, no markdown, no explanation.`;
}

function buildChatPrompt(question, machine, evidence, meta) {
  const evText = Object.entries(evidence)
    .map(([id, ev]) => `${id}: ${ev.t} — ${ev.d}`)
    .join("\n");

  return `You are an industrial maintenance AI analyst. Answer the engineer's question using ONLY the evidence below. Be concise (2-3 sentences). Cite evidence IDs. If the answer is not in the evidence, say so.

Machine: ${machine} (tool=${meta.tool}, batch=${meta.batch})
Evidence:
${evText}

Question: ${question}

Respond with ONLY the answer text, no preamble.`;
}

function buildTriagePrompt(machine, type, evidence) {
  const evText = Object.entries(evidence)
    .map(([id, ev]) => `${id}: ${ev.t}`)
    .join("\n");

  return `Classify this CNC machine incident in ONE short sentence (max 15 words).
Machine: ${machine}, type: ${type}
Evidence: ${evText}
Respond with ONLY the classification sentence.`;
}

// --- API functions ---

async function investigateWithGemini(machine, type, evidence, meta) {
  const client = getVertexClient();
  const prompt = buildInvestigatePrompt(machine, type, evidence, meta);

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { temperature: 0.3, maxOutputTokens: 1024 },
  });

  const text = response.text;
  // Extract JSON array from response (handle potential markdown wrapping)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON array in Gemini response: ${text.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

async function chatWithGemini(question, machine, evidence, meta) {
  const client = getVertexClient();
  const prompt = buildChatPrompt(question, machine, evidence, meta);

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { temperature: 0.2, maxOutputTokens: 256 },
  });

  return response.text.trim();
}

async function triageWithGemma(machine, type, evidence) {
  const client = getVertexClient();
  const prompt = buildTriagePrompt(machine, type, evidence);

  const response = await client.models.generateContent({
    model: GEMMA_MODEL,
    contents: prompt,
    config: { temperature: 0.1, maxOutputTokens: 64 },
  });

  return response.text.trim();
}

module.exports = {
  investigateWithGemini,
  chatWithGemini,
  triageWithGemma,
  GEMINI_MODEL,
  GEMMA_MODEL,
};
