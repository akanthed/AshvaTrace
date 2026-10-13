const express = require("express");
const path = require("path");
const { generateScenario, computeAnalytics, fmtIST, mean, N, DT, START, TOOL_CHANGE, DRIFT, INSPECT, LO, HI } = require("./src/synthetic");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- In-memory audit trail ---
const auditLog = [
  ["06:00", "Shift started, baseline built from 06:00–08:10 (healthy window, tool T-13)"],
];

// --- Pre-compute the default scenario (CNC-03) ---
const scenario = generateScenario(4207);
const analytics = computeAnalytics(scenario);
const { S, BASE, detect, win, devPct, excessKWh, firstOOT, oot } = analytics;

// --- Evidence items (deterministic, computed from data) ---
function buildEvidence() {
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const stats = (arr) => ({ latest: arr[arr.length - 1], avg: mean(arr), peak: Math.max(...arr) });
  const fmt = (i) => fmtIST(i, START);

  return {
    "EV-01": { t: "Power above expected, sustained", d: `+${mean(devPct).toFixed(1)}% avg vs baseline, 25 consecutive readings > 8% from ${fmt(detect)}`, w: [detect, N - 1] },
    "EV-02": { t: "Vibration rose in same window", d: `${BASE.vib.toFixed(2)} → ${stats(win.map((s) => s.vib)).latest.toFixed(2)} mm/s RMS (latest)`, w: [detect, N - 1] },
    "EV-03": { t: "Cycle time increased", d: `${BASE.cyc.toFixed(1)} s → ${mean(S.slice(-150).map((s) => s.cyc)).toFixed(1)} s (last 30 min avg)`, w: [detect, N - 1] },
    "EV-04": { t: "Dimension above upper tolerance", d: `First at ${fmt(firstOOT)}; ${oot} of ${win.length} samples out of 25.000 ±0.020 mm`, w: [firstOOT, N - 1] },
    "EV-05": { t: "Tool change event E-117 (T-14 installed)", d: `At ${fmt(TOOL_CHANGE)}, ${((detect - TOOL_CHANGE) * DT / 60).toFixed(0)} min before drift began`, w: [TOOL_CHANGE, TOOL_CHANGE + 20] },
    "EV-06": { t: "Material batch unchanged", d: "MB-2207 throughout shift; recipe R-45 unchanged", w: [0, N - 1] },
    "EV-07": { t: "Spindle temperature stable", d: `${BASE.temp.toFixed(1)} °C baseline, max ${Math.max(...S.map((s) => s.temp)).toFixed(1)} °C`, w: [0, N - 1] },
  };
}

const EV = buildEvidence();
const SOP = {
  "SOP-101 §2": "Process Drift Response: confirm offsets against setup sheet",
  "SOP-102 §3": "Tool Inspection: measure flank wear VB; replace if > 0.3 mm",
  "SOP-103 §1": "Post-Adjustment Verification: 30 min window, compare to baseline",
};

// --- Mock hypotheses (same shape real AI will return) ---
const HYP = [
  { h: "Accelerated wear on insert T-14", u: "Medium", for: ["EV-01", "EV-02", "EV-03", "EV-04"], ag: ["EV-05"], r: "Power, vibration, cycle time and bore size all rise gradually in the same window, which fits progressive edge wear.", agTxt: "T-14 was installed 1 h before drift began. Wear this fast is unusual, so check for a defective insert.", nc: "Measure flank wear VB on T-14.", sop: "SOP-102 §3" },
  { h: "Tool offset entered wrongly at tool change", u: "Medium", for: ["EV-04", "EV-05"], ag: ["EV-01", "EV-02"], r: "Dimension shift follows a tool change event.", agTxt: "A wrong offset gives a step change in size, not a gradual rise in power and vibration.", nc: "Compare offset table against the setup sheet.", sop: "SOP-101 §2" },
  { h: "Spindle bearing degradation", u: "High", for: ["EV-02"], ag: ["EV-07", "EV-06"], r: "Vibration rise alone is consistent with bearing wear.", agTxt: "Spindle temperature is flat and the batch is unchanged. Bearing wear usually raises temperature.", nc: "Run spindle run-out check if insert check is clean.", sop: "SOP-101 §2" },
];

// --- Mock chat answers ---
const ANS = {
  "Why did power rise?": `Power stayed above expected from ${fmtIST(detect, START)} (EV-01). Vibration rose in the same window (EV-02). Higher cutting force from a worn edge would explain both, but this is not confirmed. Next check: SOP-102 §3`,
  "Could it be the material?": `Unlikely. Batch MB-2207 and recipe R-45 did not change (EV-06).`,
  "When did parts go out of spec?": `First at ${fmtIST(firstOOT, START)}. ${oot} samples were above 25.020 mm (EV-04).`,
};

// --- Routes ---

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/scenarios", (req, res) => {
  res.json({
    machines: [
      { id: "CNC-01", line: "Line 1", st: "ok", note: "Running · R-45", state: "Running", order: "PO-88229 · R-45", dev: 1.2, epp: 0.098 },
      { id: "CNC-02", line: "Line 1", st: "ok", note: "Running · R-45", state: "Running", order: "PO-88230 · R-45", dev: -0.6, epp: 0.096 },
      { id: "CNC-03", line: "Line 1", st: "crit", note: "INC-0412 open", state: "Running", order: "PO-88231 · R-45", dev: mean(devPct.slice(-6)), epp: 0.121 },
      { id: "CNC-04", line: "Line 1", st: "warn", note: "Power +6% (watch)", state: "Running", order: "PO-88232 · R-45", dev: 6.1, epp: 0.104 },
      { id: "CNC-05", line: "Line 2", st: "warn", note: "INC-0398 unresolved", state: "Running", order: "PO-88240 · R-48", dev: 7.4, epp: 0.109 },
      { id: "CNC-06", line: "Line 2", st: "ok", note: "Setup · R-51", state: "Setup", order: "PO-88241 · R-51", dev: 0, epp: 0 },
    ],
    signals: [
      { k: "kw", label: "Active power", unit: "kW" },
      { k: "vib", label: "Vibration", unit: "mm/s RMS" },
      { k: "cyc", label: "Cycle time", unit: "s" },
      { k: "dim", label: "Bore diameter", unit: "mm" },
      { k: "temp", label: "Spindle temperature", unit: "°C" },
    ],
    thresholds: {
      kw: { hiAlarm: 9.0, hiWarn: 8.5, loWarn: 6.0, loAlarm: 5.5 },
      vib: { hiAlarm: 4.0, hiWarn: 3.0, loWarn: 1.6, loAlarm: 1.4 },
      cyc: { hiAlarm: 52, hiWarn: 50, loWarn: 47, loAlarm: 46 },
      dim: { hiAlarm: 25.030, hiWarn: 25.020, loWarn: 24.980, loAlarm: 24.970 },
      temp: { hiAlarm: 48, hiWarn: 45, loWarn: 36, loAlarm: 34 },
    },
    evidence: EV,
    sop: SOP,
    incident: {
      id: "INC-0412",
      machine: "CNC-03",
      opened: fmtIST(detect, START),
      order: "PO-88231 · R-45",
      tool: "T-14",
      batch: "MB-2207",
    },
    baseline: BASE,
    detect,
    excessKWh,
    firstOOT,
    oot,
    N,
    DT,
    START,
    TOOL_CHANGE,
    DRIFT,
    INSPECT,
    LO,
    HI,
  });
});

app.post("/api/investigate", (req, res) => {
  const { machine } = req.body || {};
  if (machine && machine !== "CNC-03") {
    return res.status(400).json({ error: `Investigation not yet available for ${machine}` });
  }
  auditLog.push([new Date().toTimeString().slice(0, 5), `Investigation run for CNC-03 (mock AI)`]);
  res.json({ hypotheses: HYP, evidence: EV, sop: SOP });
});

app.post("/api/chat", (req, res) => {
  const { question } = req.body || {};
  const answer = ANS[question] || "I can only answer from INC-0412 evidence. Try one of the suggested questions.";
  res.json({ answer });
});

app.post("/api/simulate", (req, res) => {
  const { option, tariff = 8.5, co2 = 0.71, partCost = 420, cur = "₹" } = req.body || {};
  const shiftExcess = excessKWh * (8 * 3600 / ((N - detect) * DT)) * 0.5;
  const scrap = 12;
  const opts = [
    { id: "A", desc: "Replace insert T-14, re-zero offset (SOP-102)", risk: "Low. Standard tool change", down: "20 min", energy: `−${shiftExcess.toFixed(1)} kWh`, quality: "Expected back in spec", cost: 1800 + 1500, net: shiftExcess * tariff + scrap * partCost - 3300, crit: "Power dev < 5%, 98% in spec" },
    { id: "B", desc: "Reduce feed 10% until shift end", risk: "Medium. Masks the cause; throughput −8%", down: "0 min", energy: `−${(shiftExcess * 0.4).toFixed(1)} kWh`, quality: "Partial. Drift slows", cost: 2600, net: shiftExcess * 0.4 * tariff + scrap * 0.5 * partCost - 2600, crit: "Power dev < 5%, 98% in spec" },
  ];
  res.json({ options: opts, excessKWh, shiftExcess, cur });
});

app.post("/api/verify", (req, res) => {
  const { option } = req.body || {};
  if (!option) return res.status(400).json({ error: "option required" });

  const { rng: rngFn, mean: meanFn } = require("./src/synthetic");
  const r = rngFn(option === "A" ? 11 : 29);
  const g = () => r() - 0.5;
  const post = [];
  for (let i = 0; i < 150; i++) {
    const e = 7.2;
    post.push(
      option === "A"
        ? { dev: 2 + g() * 2, vib: BASE.vib * 1.05 + g() * 0.1, dim: 25.003 + g() * 0.006, kw: e * 1.02, cyc: 48.3 }
        : { dev: 9 + g() * 2, vib: BASE.vib * 1.6 + g() * 0.1, dim: 25.012 + g() * 0.02, kw: e * 1.09, cyc: 52 }
    );
  }
  const dev = meanFn(post.map((p) => p.dev));
  const vib = meanFn(post.map((p) => p.vib));
  const inSpec = 100 * post.filter((p) => p.dim <= HI && p.dim >= LO).length / 150;
  const epp = (meanFn(post.map((p) => p.kw)) * meanFn(post.map((p) => p.cyc))) / 3600 / (inSpec / 100);
  const pass = dev < 5 && vib < BASE.vib * 1.2 && inSpec >= 98;
  const before = meanFn(devPct.slice(-150));
  const result = pass ? "PASS" : dev < before ? "PARTIAL IMPROVEMENT" : "UNRESOLVED";
  const why = pass
    ? "All three checks met in the 30 min window."
    : "Some checks improved but the process is not back to baseline. Keep INC-0412 open.";

  auditLog.push([new Date().toTimeString().slice(0, 5), `Verification of option ${option}: ${result} (dev ${dev.toFixed(1)}%, ${inSpec.toFixed(0)}% in spec)`]);

  res.json({ dev, vib, inSpec, epp, result, why, before });
});

app.post("/api/work-orders/draft", (req, res) => {
  const { machine, option, description } = req.body || {};
  const wo = {
    id: `WO-${Date.now().toString(36).toUpperCase()}`,
    machine: machine || "CNC-03",
    option,
    description: description || "Simulated intervention",
    status: "DRAFT",
    created: new Date().toISOString(),
  };
  auditLog.push([new Date().toTimeString().slice(0, 5), `Work order ${wo.id} drafted for ${wo.machine}`]);
  res.json(wo);
});

app.get("/api/audit", (req, res) => {
  res.json({ entries: auditLog });
});

app.get("/api/settings/ai", (req, res) => {
  res.json({ provider: "mock", model: "mock (no real AI yet)", cloud: false });
});

app.post("/api/settings/ai", (req, res) => {
  const { provider } = req.body || {};
  res.json({ provider: provider || "mock", model: "mock (no real AI yet)", cloud: false });
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`AshvaTrace server running on http://localhost:${PORT}`);
});
