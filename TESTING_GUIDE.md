# AshvaTrace — Testing Guide

**Who this is for:** the testing / QA team.
**What this app is:** a dashboard that watches factory machines, spots when one starts misbehaving, and helps an engineer figure out *why* and *what to do about it*.

> **Important thing to know before you start:** the machine data in this app is **simulated (fake but realistic)**. There is no real factory sensor connected. The app is built to *look and behave* like a live plant so we can test the whole workflow. You will see a "Simulated data" label in the app — that is intentional and correct. Do not treat it as a bug.

---

## 1. What the app does, in one paragraph

The app watches a set of machines (like CNC machines) in real time. Each machine has readings for **power**, **vibration**, and **cycle time**. When a machine's readings go outside the limits an engineer has set, the app raises an **alert** and opens an **incident** (a tracked problem).

Then the app's AI (Google's Gemini) **investigates** the problem and suggests a ranked list of likely causes, each with evidence for and against. An engineer **picks a fix**, the AI **predicts what will happen**, and then **the app itself (not the AI) checks whether the fix actually worked**. Every step is recorded in an audit log.

The key idea to test for: **the AI suggests, a human decides, and the app (plain rules, not the AI) verifies the result.**

---

## 2. The screens (what each page means)

The app has a top bar and, once you're inside, a left-hand menu. Here is what each screen is for.

| Screen | What it means | What you should see |
|--------|--------------|---------------------|
| **Home / Launch** | The landing screen. A set of big tiles that take you into the app. | Tiles like "Plant", "Monitoring", "Investigate", "Verify", "Audit", "Settings". Some tiles may be highlighted if there's a problem. |
| **Monitoring** | The main "at a glance" view of the whole plant. | A table of all machines with a status badge (Normal / Watch / Action required), plus summary counts at the top (how many need action, how many to watch, etc.). |
| **Machine** | The detail page for one machine. | Tabs: **Monitoring**, **Dashboard**, **Threshold**, **Trends**, **Plant**, and the investigation tabs. This is where you look at one machine closely. |
| **Incident** | The investigation screen for one problem. | Tabs: **Investigate**, **Actions**, **Verify**, **Audit**. This is the heart of the app. |
| **Analytics** | Shift-level reports. | Cost impact, downtime, threshold violations, energy use, machine comparisons. |
| **Settings** | Shows what is actually connected. | A table showing whether the AI, the database, and the alert system are connected. It says "Live check, not a claim" — it really checks, it doesn't just say yes. |

### The status badges (used everywhere)
- **Normal** (green) — machine is fine.
- **Watch** (yellow) — machine is drifting, worth keeping an eye on.
- **Action required** (red) — machine has crossed a critical limit, needs attention.

---

## 3. The full flow to test (step by step)

This is the main end-to-end journey. Follow it in order.

### Step 1 — Open the app and check the plant overview
1. Open the app. You land on the **Home / Launch** screen.
2. Go to **Monitoring**.
3. **Check:** You see a list of machines, each with a status badge.
4. **Check:** The summary counts at the top (Action required / Watch / Normal) match the badges in the table.
5. **Check:** The charts and numbers are **moving on their own** over a few seconds (the data is live). If everything looks frozen, that's a problem.

### Step 2 — See the machines in their fixed conditions
The plant has **three machines**, each held in a different condition for the demo:

| Machine | Condition | What you'll see |
|---------|-----------|-----------------|
| CNC Mill 01 | **Normal** (green) | Deviation stays well under the warning limit. |
| CNC Mill 02 | **Watch** (yellow) | Deviation sits between the warning and critical limits. |
| CNC Mill 03 | **Action required** (red) | Deviation is above the critical limit. |

1. Stay on **Monitoring** and watch for a few seconds.
2. **Check:** CNC-01 stays green, CNC-02 stays yellow, CNC-03 stays red. The numbers keep moving (live data), but the status badges don't change.
3. **Check:** CNC-03 has an **alert** (usually a banner or notification at the top) and an **incident** is created for it.

> **Tip:** The machines are intentionally held in their conditions so the demo is stable. If you want to test what happens when a *normal* machine goes into trouble, open CNC-01 and lower its thresholds (see Step 4) to force a problem.

### Step 3 — Open the incident and see the AI investigate
1. Click the alert or the machine to open the **Incident** screen.
2. Go to the **Investigate** tab.
3. **Check:** The app shows a **list of hypotheses** (likely causes), ranked from most to least likely.
4. **Check:** Each hypothesis has:
   - a **title** (e.g. "Worn spindle bearing"),
   - a **confidence** percentage,
   - **evidence for** (why this might be the cause),
   - **evidence against** (why it might not be),
   - a reference to a standard procedure (SOP) where relevant.
5. **Check:** The evidence is written in **plain language** a shift supervisor would understand — not technical jargon.
6. **Check:** There is an **investigation trace** showing the steps the AI took (it may have pulled live readings before deciding).

> **What to look for (quality check):** The hypotheses should be *specific to this machine and its numbers*, not generic. If the AI gives the same generic answer no matter what, that's a problem to report.

### Step 4 — Pick a fix (the human decision)
1. On the **Investigate** tab, **click one hypothesis** to select it.
2. Go to the **Actions** tab.
3. **Check:** The app shows the selected cause and lets you enter/choose an **intervention** (the fix, e.g. "replace the spindle bearing").
4. **Check:** The AI **predicts the outcome** of that fix and shows a confidence level.

### Step 5 — Verify the result (the key differentiator)
1. Go to the **Verify** tab.
2. **Check:** The app shows a **pass/fail** result based on the actual numbers (power, vibration, cycle time).
3. **This is the most important thing to test:** the pass/fail is decided by **fixed rules in the app, not by the AI**. The AI only *predicted* the outcome; the app *checked* it.
4. **Check:** The result shows the actual numbers and whether they are within acceptable range.

### Step 6 — Check the audit log
1. Go to the **Audit** tab.
2. **Check:** There is a full trail of what happened: when the problem was detected, the hypotheses, the fix chosen, and the verification result.
3. **Check:** Each entry has a time and who/what did it.

---

## 4. What to test on each screen (checklist)

### Monitoring screen
- [ ] All machines load and show a status badge.
- [ ] Summary counts match the table.
- [ ] Data updates live (numbers/charts move over a few seconds).
- [ ] When a machine turns red, an alert appears.
- [ ] Clicking a machine takes you to its detail page.

### Machine screen
- [ ] **Monitoring** tab shows the machine's readings.
- [ ] **Dashboard** tab shows tiles (power, deviation) and lets you rearrange them.
- [ ] **Threshold** tab lets you change the warning/critical limits, and the machine's color updates when you do.
- [ ] **Trends** tab shows a moving chart of the readings over time.
- [ ] **Plant** tab lets you add/remove machines.

### Incident screen
- [ ] **Investigate** tab shows ranked hypotheses with for/against evidence.
- [ ] Evidence is in plain language, specific to the machine.
- [ ] You can select a hypothesis.
- [ ] **Actions** tab shows the predicted outcome of the chosen fix.
- [ ] **Verify** tab shows a pass/fail based on actual numbers (not the AI).
- [ ] **Audit** tab shows the full history.

### Analytics screen
- [ ] Cost impact, downtime, and violations load.
- [ ] Numbers are sensible (not blank, not negative where they shouldn't be).

### Settings screen
- [ ] Shows the real connection status of the AI, database, and alert system.
- [ ] If the server is down, it clearly says it couldn't check (it doesn't fake a "connected" status).

---

## 5. Things that are NOT bugs (so you don't report them)

- **The data is fake/simulated.** That's by design. The "Simulated data" label is correct.
- **Machines stay in their fixed conditions.** CNC-01 stays Normal, CNC-02 stays Watch, CNC-03 stays Action required. The numbers keep moving (live data), but the status badges don't change. That's intentional for a stable demo.
- **The AI's answer can vary slightly** between runs. It's a real AI, so wording may differ each time. What matters is that it's specific and relevant, not that it's word-for-word identical.
- **There is no real factory connection.** No PLC, no real sensors. If you're looking for a live plant feed, it's not there — and that's fine for this version.

---

## 6. How to report a problem

When you find something that looks wrong, please note:
1. **Which screen** you were on.
2. **What you did** (the steps to get there).
3. **What you expected** to happen.
4. **What actually happened** (a screenshot helps a lot).
5. **Whether it happened every time** or just once.

---

## 7. Quick glossary (words you'll see)

| Word | What it means |
|------|--------------|
| **Machine** | A piece of factory equipment being monitored (e.g. a CNC machine). |
| **Power** | How much electricity the machine is using. |
| **Vibration** | How much the machine is shaking (a sign of wear or trouble). |
| **Cycle time** | How long it takes to make one part. |
| **Threshold** | The limit an engineer sets. Crossing it triggers an alert. |
| **Alert** | A notification that something is out of range. |
| **Incident** | A tracked problem that needs investigating. |
| **Hypothesis** | A likely cause of the problem, suggested by the AI. |
| **Confidence** | How sure the AI is about a hypothesis (0–100%). |
| **Intervention / Action** | The fix the engineer chooses. |
| **Verification** | The app checking (with fixed rules) whether the fix worked. |
| **Audit log** | The record of everything that happened. |
| **SOP** | Standard Operating Procedure — the plant's written guidance for handling problems. |
