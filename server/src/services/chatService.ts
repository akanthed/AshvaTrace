import { getMachines, getMachineStatus } from './machineService';
import { getAlerts } from './alertService';
import { getIncidents } from './incidentService';
import { vertexAIRequest, geminiModel } from '../utils/ai';

// Build a compact snapshot of the live app state so the assistant can answer
// questions about the machines, alerts, and incidents actually on screen.
function buildAppContext(): string {
  const machines = getMachines().map((m) => {
    const s = getMachineStatus(m.id);
    if (!s) return { id: m.id, name: m.name, type: m.type, status: 'unknown' };
    return {
      id: m.id,
      name: m.name,
      type: m.type,
      status: s.status,
      powerDevPct: Math.round(s.devPct * 10) / 10,
      vibrationMmS: Math.round(s.vibration * 100) / 100,
      cycleTimeSec: Math.round(s.cycleTime * 10) / 10,
    };
  });

  const alerts = getAlerts()
    .filter((a) => !a.acknowledged)
    .slice(0, 10)
    .map((a) => ({ machine: a.machineName, severity: a.severity, message: a.message }));

  const incidents = getIncidents()
    .filter((i) => i.status !== 'closed')
    .slice(0, 10)
    .map((i) => ({
      id: i.id,
      machine: i.machineId,
      status: i.status,
      severity: i.severity,
      hypotheses: (i.hypotheses || []).map((h) => h.title),
    }));

  return JSON.stringify({ machines, activeAlerts: alerts, openIncidents: incidents }, null, 2);
}

export interface ChatResult {
  answer: string;
  offTopic: boolean;
}

// Answer a user question using live app context. The system prompt restricts
// the model to AshvaTrace / industrial-monitoring topics and tells it to
// decline anything outside that scope.
export async function askAssistant(question: string): Promise<ChatResult> {
  const context = buildAppContext();

  const systemPrompt = `You are the built-in assistant for AshvaTrace, an industrial machine-monitoring dashboard.
You help operators and engineers understand what is happening on the machines shown in the app.

CURRENT APP STATE (live):
${context}

RULES:
- Only answer questions about AshvaTrace, its machines, power/vibration/cycle-time metrics, alerts, incidents, hypotheses, thresholds, and the monitoring workflow.
- Use the CURRENT APP STATE above to give specific, accurate answers (name real machine IDs, real numbers, real alert/incident details).
- If the question is unrelated to this app or industrial machine monitoring (e.g. general knowledge, other products, personal topics, coding, weather), do NOT answer it. Instead reply briefly that you can only help with questions about the AshvaTrace machine-monitoring app.
- Keep answers concise (2-5 sentences) and practical.
- Do not invent machines, metrics, or incidents that are not in the CURRENT APP STATE.`;

  const prompt = `${systemPrompt}\n\nUser question: ${question}\n\nAnswer:`;

  try {
    const text = await vertexAIRequest(
      geminiModel(),
      prompt,
      { temperature: 0.3, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } }
    );
    const answer = (text || '').trim();
    if (!answer) {
      return { answer: 'I could not generate an answer. Please try rephrasing your question.', offTopic: false };
    }
    // Heuristic: the model signals off-topic by refusing. Detect common refusal
    // phrasings so the UI can show a hint.
    const offTopic = /only (help|assist) with questions about|can only help|outside (the|my) scope|not related to (this|the) app/i.test(answer);
    return { answer, offTopic };
  } catch (err) {
    console.error('[Chat] Assistant failed:', err);
    return {
      answer: 'The assistant is temporarily unavailable. Please try again in a moment.',
      offTopic: false,
    };
  }
}
