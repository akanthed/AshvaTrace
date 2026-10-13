# AshvaTrace — Energy-Aware Quality Intelligence

**Team:** Ashvamedh
**Hackathon:** AI Builder Cup 2026
**Theme:** Manufacturing — Intelligent Operations & Industrial Efficiency
**Tagline:** Detect the signal. Investigate the cause. Verify the improvement.

> See `CLAUDE.md` for current build status, the Gen AI/judging constraints
> driving design decisions, and the rebuild plan. This file is the product
> spec; `CLAUDE.md` tracks what's actually true right now.

## What it does
AshvaTrace detects sustained deviations between actual and expected machine power, correlates them with vibration, cycle time, dimensional quality and event history, and opens an evidence-based investigation. AI proposes ranked, competing hypotheses with evidence for and against, grounded in operational data and SOP excerpts. An engineer approves a simulated intervention, and **deterministic code — not AI — verifies the outcome** against pass/fail criteria. That separation (AI proposes, code verifies) is the project's core differentiator and must be preserved through every iteration.

## Hackathon requirements (binding, not optional)
- **AI is mandatory, not optional**: every submission must integrate Google AI models (Gemini or Gemma family) or be built on an agentic platform (Agent Platform, Antigravity, AI Studio). It must be deployed on Google Cloud via **Cloud Run or Firebase**. A prototype without a real model call and a real Cloud Run/Firebase deployment does not qualify, regardless of UI quality.
- **Judging weights**: Technical Merit & Gen AI Implementation **40%** (explicitly penalizes superficial/basic Gen AI use), Problem Alignment & Impact **25%**, Innovation & Creativity **25%**, UX & Solution Design **10%**. Build effort should track these weights — UI polish alone cannot win this.
- **Mandatory submission artifacts** beyond the working prototype: a pitch deck (PDF), a public 3-minute demo video (YouTube/Vimeo/Drive), and clear problem-statement labeling.
- Submission deadline: **Oct 18, 2026**.

## Current status
A static HTML/CSS/JS mockup exists at `prototype/ashvatrace-prototype.html`, styled after the moneo monitoring platform for UI/IA agreement. Its AI responses (hypotheses, incident chat) are **hardcoded placeholder text**, not real model calls — it exists to validate layout and flow, not as the submission's AI implementation. There is no backend yet and nothing is deployed to Cloud Run. A full rebuild (real frontend + backend + a real Gemini/Gemma integration) is the next phase; see `CLAUDE.md` for the detailed plan and priorities.

## Local-first principle
Core analytics, charts, event history, calculations, intervention simulation and verification must work locally without cloud access. AI is optional:
- **Local Gemma:** use a compatible Google Gemma open-weight model and a supported local/browser inference runtime. Confirm model/runtime/browser/hardware support and model terms.
- **Vertex AI Gemini:** optional cloud mode; requires connectivity and server-side credentials. Explicitly indicate when evidence is sent to cloud.
- **AI Disabled:** deterministic core continues to work and shows no fabricated AI response.

A website is not automatically offline. For offline use, serve it locally or on the plant LAN, cache static assets if using a PWA, download any local model beforehand, and test with the network disabled.

## Core stack
- Browser-native HTML/CSS/JavaScript UI (or exported UI code audited for deployability)
- Small Node.js local server/API
- Synthetic JSON/CSV files and local storage/import-export
- Deterministic JavaScript analytics and calculations
- Optional Vertex AI Gemini integration
- Optional compatible local Gemma runtime
- Google Cloud Run for the hosted hackathon version
- Google Cloud Logging for deployed runtime logs

Avoid external hosted AI providers and external hosted databases. Keep dependencies minimal.

## Safety and truthfulness
- Synthetic demonstration only.
- No real PLC, CNC, machine network or equipment commands.
- AI outputs are hypotheses, not proof of causation.
- All costs, carbon and scrap values are estimates based on displayed assumptions.
- Never expose cloud credentials in browser code.
- Gemma is an open-weight/open model family under applicable terms; do not assume every model is OSI-certified open source.

## Data files
Create a seeded dataset of about 2,400 samples over eight simulated hours at 12-second intervals. Keep `scenario_id`, `defect_label` and ground truth in evaluation-only files, never in AI prompts. Include:
- healthy operation
- gradual energy/vibration/quality drift
- tool-change event
- post-action window
- at least one unresolved intervention

Synthetic SOPs:
- SOP-101 Process Drift Response
- SOP-102 Tool Inspection
- SOP-103 Post-Adjustment Verification

## API
- `GET /health`
- `GET /api/scenarios`
- `POST /api/analyze`
- `POST /api/investigate`
- `POST /api/simulate`
- `POST /api/work-orders/draft`
- `POST /api/verify`
- `GET /api/settings/ai`
- `POST /api/settings/ai`

## Local development
Exact commands depend on the generated source tree. The implementation must document:
1. required Node.js version
2. install command
3. local start command
4. local URL
5. synthetic data reset/import/export
6. optional local Gemma model/runtime installation
7. optional Vertex AI configuration
8. offline verification steps

## Cloud deployment
Deploy the web app/API to Google Cloud Run. Use server-side Google Cloud authentication for Vertex AI. Never place credentials in the browser. The hosted Cloud Run app requires connectivity; local-first is the offline deployment path.

## Evaluation
Test healthy and drift scenarios, missing data, consistent units, unknown evidence/SOP references, AI failure, formulas, rejected interventions, unresolved verification, offline core operation and deployed Cloud Run operation.

## Official references
- AI Builder Cup: https://aibuildercup.com/
- Themes: https://aibuildercup.com/themes.html
- Gemma overview: https://ai.google.dev/gemma/docs
- Gemma in browsers: https://ai.google.dev/gemma/docs/integrations/web
- Gemma runtime options: https://ai.google.dev/gemma/docs/run
- Gemma on Vertex AI: https://cloud.google.com/vertex-ai/generative-ai/docs/open-models/use-gemma
