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
  or Firebase**. No exceptions, no credit without this.
- **Judging weights**: Technical Merit & Gen AI Implementation 40%,
  Problem Alignment & Impact 25%, Innovation & Creativity 25%,
  UX & Solution Design 10%.
  - 40% explicitly penalizes "basic or superficial" Gen AI use — canned/fake
    AI responses are a scoring risk, not just a code-quality issue.
  - Only 10% is UX polish. Don't over-invest in screens at the expense of
    the AI/backend work that carries 65% of the score.
- **Submission requires, per the official rules (aibuildercup.com), four
  separate artifacts**: (1) a working **deployed** prototype link (Cloud Run
  or Firebase — not localhost, not a zip), (2) a **public GitHub repository**
  of the prototype, (3) a video demo **under 3 minutes**, (4) a deck
  explaining the solution. All four are mandatory, not optional extras —
  track them as real workstreams. The repo being public is easy to miss and
  easy to forget to flip before the deadline.
- The organizers state the goal explicitly: a functional solution that
  demonstrates the idea **in action — "not just a pitch deck or a mockup."**
  Read literally, that is a direct warning against submitting the current
  prototype state (hardcoded AI, nothing deployed) as-is.
- Submission deadline: Oct 18, 2026 (confirmed directly on aibuildercup.com,
  not just third-party listicles — some third-party sources had circulated
  an incorrect Oct 4 date).

## Current state (as of this writing)

- `prototype/ashvatrace-prototype.html` — single-file static HTML/CSS/JS
  mockup styled after moneo (IO-Link/vibration monitoring platform used as
  the visual/IA reference). Deterministic, seeded synthetic data generated
  client-side (`rng`, `gauss`, array `S`). One scripted incident (CNC-03 /
  INC-0412) is fully wired; other machines are stubs.
  - Tabs per machine: Monitoring table, Trends, Dashboard (drag/drop tiles),
    Threshold (editable alarm/warning limits, recolors live), Investigate,
    Actions, Verify, Audit.
  - **AI is currently faked**: `HYP` (hypotheses) and `ANS` (chat answers)
    are hardcoded strings in the script. This is a mockup for layout
    agreement only — it must not be mistaken for, or shipped as, the
    submission's AI.
- `AshvaTrace_Project_README.md` — original product/spec doc (local-first
  principle, API surface, data file spec, evaluation checklist). Being
  superseded; see README update alongside this file.
- `AshvaTrace_Final_Product_and_Implementation_Pack.docx` — fuller original
  spec document. Treat as background reference, not current source of
  truth once implementation starts.
- `scratch/moneo_theme.py` — scratch file from theme extraction, not part
  of the shipped product.
- No git repo yet. No backend. No real AI call anywhere yet. Nothing
  deployed to Cloud Run.

## Plan: full rebuild starting next (frontend + backend + real AI)

The mockup validated the UI direction; the team is now starting a real
implementation from scratch covering frontend, backend, and actual
Gemini/Gemma integration. Before writing implementation code for this phase,
**use the brainstorming skill** to scope it properly (this is architectural
work: new backend, new API, real external AI integration, deployment
pipeline) — write a spec, get it approved, then use writing-plans.

Known priorities for the rebuild, in order of score impact:
1. Replace fake AI with a real Gemini/Gemma call for hypothesis generation
   and the incident chat, server-side (credentials never in the browser).
2. Minimal backend (per the original README's API sketch: `/api/analyze`,
   `/api/investigate`, `/api/simulate`, `/api/verify`, etc.) — Node.js is
   the prior assumption, revisit only if there's a concrete reason to.
2. Deploy to Google Cloud Run (or Firebase) end-to-end, not just locally.
3. Generalize the investigation pipeline beyond the single scripted
   CNC-03 incident — a judge clicking another machine should not hit a
   "not implemented" stub.
4. Keep the deterministic screens (Monitoring table, Dashboard, Threshold,
   Trends, Verify) deterministic. Do not bolt AI onto them just to
   "use more AI" — judges score meaningful use, not AI surface area.
5. Pitch deck PDF + 3-minute video are mandatory submission artifacts —
   plan time for them, they are not an afterthought.

## Design/UI conventions established so far

- Visual language cloned from moneo screenshots on purpose: dark theme,
  single orange accent (`--accent:#f39200`), red/yellow/green reserved for
  machine state, Roboto/Roboto Mono fonts, left-border accent cards
  (`.inc-head`, `.alarmrow`). These were flagged by the design-review hook
  as common AI-slop patterns (side-tab borders, overused font) and
  deliberately suppressed via `.impeccable/config.json` — they're
  intentional matches to the reference product, not defaults to avoid.
- Synthetic data is seeded/deterministic (`rng(seed)`) so results are
  reproducible across reloads — keep this property in any backend rewrite;
  non-deterministic demo data makes debugging and judging reproducibility
  harder.
- "Simulated data" / "no real PLC/CNC connection" framing must stay visible
  in the UI — this is both a safety/honesty requirement and a hackathon
  trust signal, don't remove it for cosmetic reasons.

## Working agreements

- This is a Windows environment (PowerShell primary, Bash tool also
  available). No git repo currently exists at the project root — check
  before assuming git workflows apply.
- Favor the lazy/ponytail approach: reuse existing patterns in the
  prototype file before introducing new abstractions; keep the rebuild's
  first version minimal enough to actually finish and deploy before the
  Oct 18 deadline.
