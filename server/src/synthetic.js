/**
 * Synthetic data generator — seeded, deterministic.
 * Ported from prototype/ashvatrace-prototype.html.
 * Produces ~2400 samples over 8 simulated hours at 12-second intervals.
 */

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGauss(r) {
  return () => {
    let u = 0, v = 0;
    while (!u) u = r();
    while (!v) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const N = 2400;
const DT = 12; // seconds between samples
const START = Date.UTC(2026, 9, 12, 0, 30); // 06:00 IST shift start
const TOOL_CHANGE = 650;
const DRIFT = 960;
const INSPECT = 2050;
const LO = 24.980;
const HI = 25.020;

function generateScenario(seed = 4207) {
  const R = rng(seed);
  const gauss = makeGauss(R);
  const S = [];

  for (let i = 0; i < N; i++) {
    const d = i < DRIFT ? 0 : Math.min(1, (i - DRIFT) / 1100);
    const exp = 7.2 + 0.25 * Math.sin(i / 180);
    S.push({
      i,
      exp,
      kw: exp * (1 + 0.17 * d) + gauss() * 0.12,
      vib: 2.1 + 1.9 * d * d + gauss() * 0.12,
      cyc: 48 + 3.2 * d + gauss() * 0.4,
      dim: 25.004 + 0.021 * d + gauss() * 0.0025,
      temp: 41 + gauss() * 0.4,
    });
  }

  return { S, N, DT, START, TOOL_CHANGE, DRIFT, INSPECT, LO, HI };
}

// --- Deterministic analytics (shared) ---
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

function computeAnalytics(data) {
  const { S, N, TOOL_CHANGE, DRIFT, LO, HI } = data;
  const base = S.slice(0, TOOL_CHANGE);
  const BASE = {
    vib: mean(base.map((s) => s.vib)),
    cyc: mean(base.map((s) => s.cyc)),
    temp: mean(base.map((s) => s.temp)),
  };

  const K = 25; // consecutive readings above threshold
  let run = 0, detect = null;
  for (const s of S) {
    if ((s.kw - s.exp) / s.exp > 0.08) {
      if (++run === K && detect === null) detect = s.i - K + 1;
    } else run = 0;
  }

  const win = S.slice(detect);
  const devPct = win.map((s) => 100 * (s.kw - s.exp) / s.exp);
  const excessKWh = win.reduce((a, s) => a + (s.kw - s.exp) * DT / 3600, 0);
  const firstOOT = S.find((s) => s.dim > HI)?.i;
  const oot = win.filter((s) => s.dim > HI || s.dim < LO).length;

  return { S, N, BASE, K, detect, win, devPct, excessKWh, firstOOT, oot, LO, HI };
}

function fmtIST(i, START) {
  const t = new Date(START + i * DT * 1000 + 5.5 * 3600e3);
  return t.toISOString().slice(11, 16);
}

module.exports = { rng, makeGauss, generateScenario, computeAnalytics, fmtIST, mean, N, DT, START, TOOL_CHANGE, DRIFT, INSPECT, LO, HI };
