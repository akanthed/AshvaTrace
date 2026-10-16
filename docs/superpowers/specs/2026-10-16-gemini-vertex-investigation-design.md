# Gemini-via-Vertex-AI investigation backend — design spec

Status: approved by user in conversation 2026-10-16. Written for hand-off to writing-plans.

## Context

AshvaTrace (manufacturing anomaly-investigation prototype, AI Builder Cup 2026
Manufacturing theme) currently fakes its AI: `HYP` (ranked hypotheses) and
`ANS` (chat answers) in `prototype/ashvatrace-prototype.html` are hardcoded
JS objects for one scripted incident, CNC-03 / INC-0412. The hackathon's
mandatory gate requires a real Gemini or Gemma call, deployed on Google
Cloud via Cloud Run or Firebase — the current prototype satisfies neither.
Deadline is Oct 18, 2026 (today: Oct 16), so scope is deliberately minimal:
make the one scripted incident real, don't generalize to other machines yet.

Guiding principle for every user-facing surface in this feature: **quality,
simple, one task per screen.** This is a manufacturing-floor tool — avoid ML
jargon (no "token count", "confidence score", "model", "prompt") in any
text an engineer sees. Plain operational language only: cost in local
currency, plain sentences, one decision per screen.

## Goals

- Replace `HYP`/`ANS` with real Gemini calls via Vertex AI, for CNC-03 /
  INC-0412 only.
- Show the engineer a plain-language cost estimate before the one
  expensive action (running the investigation), and a quiet actual-cost
  line after any AI response (investigation or chat).
- Credentials never reach the browser.
- Keep every existing deterministic screen (Monitoring, Dashboard,
  Threshold, Trends, Verify, Audit) unchanged — this feature only touches
  the Investigate tab and the AI-provider settings screen.
- Ship as one container, one Cloud Run deploy.

## Non-goals

- Generalizing the investigation pipeline to machines other than CNC-03.
- Self-hosting Gemma (Vertex AI Model Garden endpoint) — too slow/risky to
  provision with ~2 days left; use Vertex AI's managed Gemini API instead.
- Splitting frontend (Firebase Hosting) from backend (separate Cloud Run
  service) — one deploy target only.
- Per-message confirm-before-send gating in chat (see Cost visibility
  below) — only the investigation run gets a confirm gate.

## Architecture

One Node/Express service, one Docker image, one Cloud Run deployment.

- Express serves `prototype/ashvatrace-prototype.html` (or its renamed
  equivalent) as a static file at `/`.
- Same service exposes the JSON API routes below.
- Calls Gemini via the `@google/genai` SDK configured for Vertex AI
  (`vertexai: true`, project/location from env vars `GOOGLE_CLOUD_PROJECT`,
  `GOOGLE_CLOUD_LOCATION`).
- Auth: Application Default Credentials. On Cloud Run, the attached
  runtime service account (grant it `roles/aiplatform.user`) — no key
  file needed in production. Locally, a downloaded service-account JSON
  referenced via `GOOGLE_APPLICATION_CREDENTIALS` for dev/testing only.
  This file must never be committed; add it to `.gitignore`.
- No Gemini/Vertex credentials or API keys ever appear in
  client-side code or network responses to the browser.

## API contracts

All evidence (`EV` object) and SOP excerpts for INC-0412 are owned and
looked up server-side, keyed by `machineId`/`incidentId`. The frontend
never sends evidence content — only identifies which incident it means.
This prevents the client from injecting fake evidence or ground-truth
labels into the prompt.

### `POST /api/investigate/estimate`

Request:
```json
{ "machineId": "CNC-03", "incidentId": "INC-0412" }
```

Backend builds the exact prompt (fixed evidence + SOP excerpts for this
incident) and calls Vertex's `countTokens` (free, no generation cost) to
get an exact input token count. Output tokens are estimated from the
fixed `maxOutputTokens` cap used for the real call. Cost computed from
published per-token Gemini pricing for the model in use.

Response:
```json
{ "estimatedCostUsd": 0.004, "estimatedCostLocal": "₹0.35" }
```

No token counts or model names in the response payload's user-facing
fields — the frontend displays only the cost line.

### `POST /api/investigate/run`

Request:
```json
{ "machineId": "CNC-03", "incidentId": "INC-0412" }
```

Backend calls `generateContent` with a `responseSchema` constraining the
model to emit an array of hypothesis objects:
```json
{
  "hypothesis": "string",
  "uncertainty": "Low" | "Medium" | "High",
  "evidence_for": ["EV-01"],
  "evidence_against": ["EV-05"],
  "evidence_against_text": "string",
  "next_check": "string",
  "sop_ref": "SOP-102 §3"
}
```

Backend validates every cited `EV-xx`/`SOP-xxx` ID against the real
evidence/SOP set for this incident. Any hypothesis citing an unknown ID
is dropped entirely (not shown half-filled) and logged server-side.

Response:
```json
{
  "hypotheses": [ { ...validated hypothesis objects... } ],
  "actualCostUsd": 0.0037,
  "actualCostLocal": "₹0.31"
}
```

If zero hypotheses survive validation, respond with an error (see Error
handling) rather than an empty success — this should never happen in
practice but must fail loudly, not silently render nothing.

### `POST /api/ask`

Request:
```json
{ "machineId": "CNC-03", "incidentId": "INC-0412", "question": "Why did power rise?" }
```

No pre-estimate step — runs directly. Backend builds a prompt from the
same fixed evidence/SOP set plus the question, calls `generateContent`
(plain text, no schema needed), extracts/validates any cited evidence IDs
the answer references against the real set.

Response:
```json
{
  "answer": "Power stayed above expected from 07:48 IST (EV-01)...",
  "actualCostUsd": 0.0009,
  "actualCostLocal": "₹0.08"
}
```

## Cost visibility flow

Extends the existing approve-before-spend pattern already used in the
Actions tab (simulating an intervention requires explicit approval before
anything "happens").

- **Investigate tab, before running:** button reads "Check cost, then run
  investigation". Clicking triggers `/api/investigate/estimate`. Result
  shown on a single-purpose confirm screen: one plain sentence ("This
  check will cost about ₹0.35") and two buttons, Run / Cancel. No token
  counts, no model name, no secondary numbers on this screen — one task,
  one decision.
- **After running:** hypothesis cards render exactly as the current `HYP`
  layout. One quiet muted-style line underneath (matching the existing
  "Provider: ... · response validated" line) shows actual cost.
- **Chat:** no pre-send confirm gate (chat questions are small/cheap and
  conversational; gating every message would break the UX). Each AI
  answer bubble gets one small muted cost line underneath after it
  arrives — cost visibility without added friction.
- **Provider settings screen:** `PROVIDERS` trimmed from three entries to
  two: "Gemini (Google Cloud)" and "AI off". The fake "local Gemma in
  Docker" card is removed entirely, not just disabled/greyed.

## Error handling

- **Unknown evidence ID cited:** drop that hypothesis, log server-side,
  never render a partially-filled card.
- **Zero valid hypotheses after validation:** treat as a failure response,
  not an empty success.
- **Vertex/Gemini call fails (network, quota, auth):** plain user-facing
  message, no jargon: "Couldn't reach the AI assistant. Try again, or
  continue without it." Include a retry action. The rest of the app must
  keep working exactly as the existing "AI disabled" state already
  handles (deterministic screens unaffected).
- **Estimate call fails:** same plain fallback message; must not block
  the rest of the Investigate tab from being viewable.

## What changes where

**Frontend (`prototype/ashvatrace-prototype.html`, or wherever it lands
once containerized):**
- `HYP` and `ANS` hardcoded objects removed.
- `investigate()` view: estimate-then-confirm step added before running;
  real fetch to `/api/investigate/run` on confirm; actual-cost line added
  after hypotheses render.
- Chat `ask()` flow: fetch to `/api/ask` instead of the `ANS` lookup;
  cost line added under each AI bubble.
- `PROVIDERS` trimmed to `vertex` and `off`; `local` entry removed.
- No other tab/view changes — Monitoring, Trends, Dashboard, Threshold,
  Actions, Verify, Audit stay exactly as they are today.

**Backend (new):**
- Express app, single entry point, serves the static file + the three
  JSON routes above.
- Server-side evidence/SOP lookup for CNC-03/INC-0412 (ported from the
  existing client-side `EV`/`SOP` objects — same data, now source-of-truth
  lives server-side so the client can't tamper with it).
- `@google/genai` SDK integration (Vertex AI mode), `countTokens` for
  estimate, `generateContent` with `responseSchema` for the run call,
  plain `generateContent` for chat.
- Evidence-ID validation logic.
- Dockerfile for Cloud Run deployment.

**Deployment:**
- One Dockerfile, one `gcloud run deploy`.
- Cloud Run service account granted `roles/aiplatform.user`.
- Env vars: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`.

## Testing

- One runnable check per non-trivial piece of logic (ponytail rule):
  evidence-ID validation (valid IDs pass, unknown IDs are dropped, zero
  survivors triggers the failure path), cost computation from token
  counts, and the estimate/run/ask route contracts (request → expected
  response shape), exercised with a stubbed Gemini client so tests don't
  burn real API calls or require live credentials.
