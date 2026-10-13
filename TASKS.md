# AshvaTrace — Task Breakdown

Order: build the whole app first (frontend + backend + deterministic logic,
AI still mocked/hardcoded like the prototype), generalize it beyond one
incident, deploy it, THEN swap in real Gemma last. This gets a fully
working, demoable app early and isolates the riskiest piece (real Gemma +
Cloud Run hosting) as a late, self-contained swap instead of a blocker.

See `CLAUDE.md` for the hackathon rules and current state behind this plan.
Check items off as you go. Each item is meant to be small enough to do in
one sitting.

## Phase 0 — Decide & lock basics
- [x] Confirm backend stack (Node.js assumed from original README)
- [x] Init git repo, commit mockup + docs as baseline
- [ ] Create Google Cloud project, enable Cloud Run

## Phase 1 — Minimal backend skeleton
- [x] `server/` folder, Node/Express app, `GET /health`
- [x] Move synthetic data generator (`rng`, `gauss`, `S`) server-side
- [x] `GET /api/scenarios` — serve dataset as JSON
- [x] Wire mockup HTML to fetch `/api/scenarios` instead of generating inline

## Phase 2 — Deterministic core (full app, AI still mocked)
- [x] `POST /api/simulate` — port `calcOpts()` cost/energy math
- [x] `POST /api/verify` — port `runVerify()` pass/partial/unresolved logic
- [x] `POST /api/work-orders/draft` — stub endpoint
- [x] Server-side audit trail (in-memory or SQLite to start)
- [x] `POST /api/investigate` — returns the mockup's hardcoded `HYP`/`ANS`
      content as real JSON responses (same shape real AI will return later,
      just not AI-generated yet)
- [x] Frontend calls `/api/investigate` instead of reading `HYP`/`ANS` inline
      — UI and data flow now fully wired end-to-end, just with fake AI

## Phase 3 — Generalize beyond one scripted incident
- [x] Data generator supports multiple scenarios (healthy, drift, tool-change, post-action, unresolved)
- [x] `/api/investigate` and `/api/simulate` work for any machine, not just CNC-03
- [x] Remove the "only CNC-03 supported" stub from the frontend

## Phase 4 — Deploy the full (still AI-mocked) app
- [ ] Dockerfile (server + static frontend)
- [ ] `gcloud run deploy` — get the complete app live
- [ ] End-to-end smoke test on deployed URL, fresh browser session

## Phase 5 — Real Gemma integration (last, swapped in)
- [ ] Install Ollama, pull a Gemma model, confirm CLI response
- [ ] Write `askGemma(prompt)` adapter module
- [ ] Resolve local-model-hosting-on-Cloud-Run risk (Cloud Run containers
      don't comfortably run a 12B model — decide: smaller Gemma variant,
      separate GPU-backed service, or Vertex AI hosted Gemma endpoint)
- [ ] Swap `/api/investigate`'s mocked response for a real Gemma call,
      parsing its output into the same hypothesis schema
- [ ] Swap the chat endpoint's mocked `ANS` for a real scoped Gemma call
- [ ] Add "evidence sent to cloud" disclosure if a cloud provider is used
- [ ] Re-deploy to Cloud Run with real AI wired in
- [ ] Re-run end-to-end smoke test on deployed URL with real AI responses

## Phase 6 — Submission artifacts
- [ ] Write pitch deck: problem, AI-proposes/code-verifies differentiator, impact numbers
- [ ] Record 3-minute demo video using the deployed app
- [ ] Convert deck to PDF, upload video publicly, label problem statement
