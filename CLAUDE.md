# AshvaTrace — CLAUDE.md

Project context for Claude Code. Read this before working on AshvaTrace.

## What this is

AshvaTrace is a submission for **AI Builder Cup 2026**, Manufacturing theme
("Intelligent Operations & Industrial Efficiency"). It detects sustained
deviations between actual and expected machine power, correlates them with
vibration/cycle-time/dimensional-quality/event history, and runs an
evidence-based investigation: AI proposes ranked hypotheses with evidence
for/against, an engineer approves a simulated intervention, and
**deterministic code (not AI) verifies the outcome**. That AI-proposes /
code-verifies loop is the project's core differentiator — preserve it, don't
dilute it.

## Hackathon rules that constrain every decision

- **Mandatory**: integrate Gemini or Gemma (or an agentic platform — Agent
  Platform, Antigravity, AI Studio), deployed on Google Cloud via **Cloud Run
  or Firebase**. No exceptions, no credit without this. **Satisfied** — see
  Current state below.
- **Judging weights**: Technical Merit & Gen AI Implementation 40%,
  Problem Alignment & Impact 25%, Innovation & Creativity 25%,
  UX & Solution Design 10%.
  - 40% explicitly penalizes "basic or superficial" Gen AI use — canned/fake
    AI responses are a scoring risk, not just a code-quality issue.
  - Only 10% is UX polish. Don't over-invest in screens at the expense of
    the AI/backend work that carries 65% of the score.
- **Submission requires, per the official rules (aibuildercup.com), four
  separate artifacts**: (1) a working **deployed** prototype link (Cloud Run
  or Firebase — not localhost, not a zip) — **done**, see URL below;
  (2) a **public GitHub repository** of the prototype — **done**,
  `github.com/akanthed/AshvaTrace` is public; (3) a video demo **under 3
  minutes** — **not yet done**; (4) a deck explaining the solution — exists
  as `AshvaTrace_Pitch_Deck.pdf`, confirm it's current before submitting.
  All four are mandatory, not optional extras.
- The organizers state the goal explicitly: a functional solution that
  demonstrates the idea **in action — "not just a pitch deck or a mockup."**
  Satisfied — the deployed app runs real Gemini calls end-to-end, not a
  scripted demo.
- Submission deadline: Oct 18, 2026 (confirmed directly on aibuildercup.com).

## Current state (as of this writing)

**The app is built, deployed, and the mandatory AI/Cloud Run gate is met.**
This supersedes every earlier version of this file that described "no
backend, no real AI call, nothing deployed" — that was true only for the
very first static-mockup phase and is no longer accurate.

- **Live URL**: `https://ashvatrace-206380300251.us-central1.run.app`
  (Cloud Run, project `ashvatrace`, region `us-central1`, service account
  `deploy@ashvatrace.iam.gserviceaccount.com`).
- **Repo**: `github.com/akanthed/AshvaTrace`, public.
- **Frontend**: `frontend/` — React + Vite + TypeScript. Routes: Launch,
  Monitoring (plant-wide table), Machine (per-machine tabs: Monitoring,
  Dashboard, Threshold, Trends), Machine Incidents (`/machine/:id/incidents`
  — that machine's Open and Closed incidents; closed ones show the cause,
  fix tried, and whether it worked), Investigate (plant-wide open-incident
  list), Incident (per-incident tabs: Investigate, Interventions, Verify,
  Audit), Analytics, Settings. Sidebar routes a machine tile click to its
  incidents list if it has any incident history, else its Machine page —
  it no longer auto-jumps straight into the open incident, so the engineer
  sees open/closed history before picking one.
- **Backend**: `server/` — Node/Express + TypeScript, single container
  serving both the built frontend (`server/public`, copied from
  `frontend/dist` at build time) and the `/api/*` routes. BigQuery
  (`@google-cloud/bigquery`) is the persistence layer (machines, incidents,
  alerts, dashboard layouts, SOP documents) — append-only tables, latest
  row per id wins on read.
- **Real Gemini integration** (`server/src/utils/ai.ts`), via Vertex AI's
  REST `generateContent` API using Application Default Credentials (no API
  key in the browser, ever):
  - `investigateAgentic()` — an actual tool-calling agent: Gemini calls
    `get_power_window` / `get_vibration_stats` / `get_cycle_time_trend` /
    `inspect_tool` to pull real sensor data before forming hypotheses,
    grounded in retrieved SOP excerpts and past resolved incidents on the
    same machine ("last time this happened, the fix was X and it worked").
  - `critiqueHypotheses()` — a second, independent Gemini call that reviews
    the first call's hypotheses against the real numbers and SOP text,
    and can only lower confidence, never raise it or rewrite evidence —
    this is the "structured reasoning," not a single-shot prompt.
  - `inspectToolImage()` — Vision AI: generates a deterministic synthetic
    tool-wear image and has Gemini assess condition/wear/recommendation
    from it.
  - `simulate()` — AI predicts the outcome of a proposed intervention in
    plain language.
  - Hypotheses only appear after the engineer clicks **Ask AI** (renamed
    from "Run AI Investigation") on the Incident view's Investigate tab.
    `LIVE_AUTO_INVESTIGATE` (background auto-run on every new critical
    incident) now **defaults off** — it previously ran Gemini the instant
    an incident opened, which looked indistinguishable from a manual
    click and defeated the point of showing an "Ask AI" affordance. Set
    `LIVE_AUTO_INVESTIGATE=true` to restore the old always-on behavior.
    Once a hypothesis is selected, a "Go to Interventions" button jumps
    straight to the Interventions tab.
  - `askAssistant()` (`chatService.ts`) — scoped chat over live app state,
    with on-topic enforcement done by code (a forced `onTopic` boolean in
    the model's structured JSON output), not by prompt-asking the model to
    behave — a jailbroken response still can't escape the fixed refusal
    text if `onTopic` isn't true.
  - Every AI call records its **real token usage and cost** via
    `CostTracker` (reads Vertex's `usageMetadata`, converts to USD from
    `GEMINI_INPUT_USD_PER_1M`/`GEMINI_OUTPUT_USD_PER_1M`). Cost accumulates
    per incident (`aiCostUsd`), persists to BigQuery, shows as a quiet line
    in the Incident view and a tile in Analytics. This is measured cost,
    not an estimate.
  - `verify()` is explicitly **not** AI — deterministic pass/fail against
    real post-action metrics. Preserve this split.
- **Deterministic core**: threshold-based status (`normal`/`warning`/
  `critical`), synthetic live data generation, energy/cost-impact
  analytics, the dashboard/threshold editors — all unchanged by AI, all in
  `machineService.ts` / `analyticsService.ts` / `synthetic.ts`.
- **Generalized beyond one machine**: five live machines (`CNC-01`,
  `CNC-02`, `CNC-03`, `LATHE-01`, `PRS-01`), investigation/simulation/
  verification work for any of them, not just one scripted incident.
- **Live auto-investigation**: a background loop ticks every 3s, advances
  each machine's synthetic series, and when a machine crosses into
  critical, automatically creates an incident and runs the real AI
  investigation on it — so the "AI proposes" loop can be observed without
  manual clicking (toggle via `LIVE_AUTO_INVESTIGATE=false`).
- `prototype/ashvatrace-prototype.html` — the original static mockup.
  Superseded by the real app; kept only as a historical reference for the
  visual language (see Design conventions below). Not part of the shipped
  product.
- `AshvaTrace_Project_README.md`, `AshvaTrace_Final_Product_and_Implementation_Pack.docx`
  — original pre-build spec documents. Background/historical reference
  only; this file is the current source of truth.
- `scratch/` — scratch files, not part of the shipped product.

## Known issues / recent fixes (keep this section current)

- **Fixed (2026-10-16): Investigate tab skipped straight to AI text with no
  incident overview.** Clicking a machine tile auto-jumped into its open
  incident, so a user never saw that machine's open/closed incident history
  first, and `LIVE_AUTO_INVESTIGATE` ran Gemini automatically the instant an
  incident went critical — indistinguishable from the "Ask AI" button ever
  having been clicked. Added `MachineIncidentsView`
  (`/machine/:id/incidents`), changed the Sidebar to route there instead of
  auto-opening the incident, turned `LIVE_AUTO_INVESTIGATE` off by default,
  renamed the button to "Ask AI", and added a "Go to Interventions" button
  once a hypothesis is picked. Threshold-gated incident open/reopen and the
  past-incident correlation shown inside an incident were already correct
  and unchanged.
- **Fixed (2026-10-16): duplicate incidents from concurrent instances.**
  Cloud Run was running up to 12 concurrent instances; this server keeps
  all state in per-process memory with no distributed lock, so each
  instance independently created its own incident/alert for the same
  real-world event (CNC-01 accumulated ~50 duplicate incidents this way).
  Fixed by forcing Cloud Run to a single instance
  (`gcloud run services update ashvatrace --max-instances=1 --min-instances=1`).
  **If this service is ever made horizontally scalable, incident/alert
  creation must move to an atomic, BigQuery-backed check-and-create — the
  in-memory dedup in `incidentService.ts`/`alertService.ts` is only safe
  single-instance.**
- **Fixed (2026-10-16): alerts never cleared.** Nothing acknowledged an
  alert when its incident resolved (or, for warning-only alerts with no
  incident, when the machine's reading returned to normal) — alerts piled
  up unbounded, and the bell badge / critical-alert banner kept surfacing
  resolved problems. `checkThresholds()` now auto-clears both cases before
  its own dedup check runs (`alertService.ts`,
  `clearAlertsForResolvedIncidents`).
- **Open**: incidents belonging to a since-deleted machine (e.g. a
  demo/test machine like `GRD-01` that was removed) are orphaned — not
  reachable via the Sidebar, and any live-metrics-dependent step (Verify)
  silently degrades since `/api/machines/:id/status` 404s for a deleted
  machine. `deleteMachine` cascades to that machine's own
  incidents/alerts, but doesn't backfill for incidents that already lost
  their machine before this existed. Not yet fixed — low priority, doesn't
  block any current machine.
- **Open**: `frontend/src/test/MachineView.test.tsx` has 3 pre-existing
  stale assertions (a removed "← Back" button, ambiguous `getByText`
  matches now that the machine name renders in two places) — predate the
  AI-cost-tracking work, unrelated to it, not yet cleaned up.

## Remaining work before the Oct 18 deadline

1. **Record the 3-minute demo video** — the only mandatory artifact not
   yet done. Walk: Monitoring → click a machine with an open incident →
   Investigate tab (real AI hypotheses + agentic trace) → Interventions
   (propose a fix, AI predicts outcome) → Verify (deterministic PASS/FAIL)
   → Audit trail. This is a real, working flow on the deployed app now —
   no need to fake or script around gaps.
2. **Confirm the pitch deck** (`AshvaTrace_Pitch_Deck.pdf`) reflects the
   real, built product rather than the original pre-build spec.
3. Everything else on the original rebuild checklist (real AI, Cloud Run
   deploy, multi-machine generalization, public repo) is done — don't
   re-litigate it; verify via the live URL before assuming something is
   missing.

## Design/UI conventions established so far

- Visual language cloned from moneo screenshots on purpose: dark theme,
  single orange accent (`--accent:#f39200`), red/yellow/green reserved for
  machine state, Roboto/Roboto Mono fonts, left-border accent cards. These
  were flagged by the design-review hook as common AI-slop patterns
  (side-tab borders, overused font) and deliberately suppressed via
  `.impeccable/config.json` — they're intentional matches to the reference
  product, not defaults to avoid.
- Synthetic data is seeded/deterministic so results are reproducible; the
  live auto-advancing feed is layered on top without breaking that
  property (same generation logic, just revealed progressively over time).
- "Simulated data" / "no real PLC/CNC connection" framing must stay visible
  in the UI — this is both a safety/honesty requirement and a hackathon
  trust signal, don't remove it for cosmetic reasons.
- All user-facing AI/cost text uses plain operational language for a
  manufacturing-floor audience — no token counts, no "confidence score"
  jargon, no model names in front of the engineer. Cost shows as a dollar
  figure, not tokens.

## Working agreements

- This is a Windows environment (PowerShell primary, Bash tool also
  available).
- Favor the lazy/ponytail approach: reuse existing patterns before
  introducing new abstractions; keep changes minimal enough to actually
  finish and verify before the Oct 18 deadline.
- Before deploying, run `npm run build` and `npm test` in both `server/`
  and `frontend/` — the server has a real Vitest suite (currently 73
  tests) that mocks the AI layer and BigQuery; keep it green.
- Deploy with `gcloud run deploy ashvatrace --source . --region
  us-central1 --project ashvatrace` from the repo root (builds via the
  root `Dockerfile`, which bundles frontend + backend into one image).
  Always verify the live URL after deploying (`/api/system/status` for a
  quick health/config check) rather than assuming a successful build means
  a working deploy.
