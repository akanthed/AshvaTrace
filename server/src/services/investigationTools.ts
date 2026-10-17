import type { Sample } from '../utils/synthetic';

// The sensor tools the investigating AI can call. Pure functions over a
// machine's sample series, so the live app and the offline eval harness run
// the exact same code.
export function createToolExecutor(
  getSeries: () => Sample[] | undefined,
  inspect: (wearLevel: number) => unknown | Promise<unknown>
) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const series = getSeries();
    if (!series) throw new Error('No series data for machine');
    const n = Math.min(Math.max(parseInt(String(args.samples || 60), 10) || 60, 10), 480);
    const window = series.slice(-n);

    switch (name) {
      case 'get_power_window': {
        const samples = window.map((s) => ({
          timestamp: s.timestamp,
          actualKw: s.actual,
          expectedKw: s.expected,
          devPct: Math.round(((s.actual - s.expected) / s.expected) * 1000) / 10,
        }));
        // Return a summary + the last 20 samples to keep the context small.
        const devs = samples.map((s) => s.devPct);
        return {
          windowSamples: samples.length,
          firstDevPct: devs[0],
          lastDevPct: devs[devs.length - 1],
          maxDevPct: Math.max(...devs),
          minDevPct: Math.min(...devs),
          trend: devs[devs.length - 1] > devs[0] + 1 ? 'rising' : devs[0] - 1 > devs[devs.length - 1] ? 'falling' : 'flat',
          recentSamples: samples.slice(-20),
        };
      }
      case 'get_vibration_stats': {
        const vibs = window.map((s) => s.vibration);
        const half = Math.floor(vibs.length / 2);
        const firstAvg = vibs.slice(0, half).reduce((a, b) => a + b, 0) / half;
        const secondAvg = vibs.slice(half).reduce((a, b) => a + b, 0) / (vibs.length - half);
        return {
          currentMmS: vibs[vibs.length - 1],
          minMmS: Math.min(...vibs),
          maxMmS: Math.max(...vibs),
          avgMmS: Math.round((vibs.reduce((a, b) => a + b, 0) / vibs.length) * 100) / 100,
          trendingUp: secondAvg > firstAvg * 1.1,
          healthyBelowMmS: 3,
        };
      }
      case 'get_cycle_time_trend': {
        const times = window.map((s) => s.cycleTime);
        const baseline = times.slice(0, Math.floor(times.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(times.length / 2);
        const recent = times.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ratePerSample = (recent - baseline) / 10;
        return {
          currentSec: times[times.length - 1],
          baselineSec: Math.round(baseline * 10) / 10,
          recentAvgSec: Math.round(recent * 10) / 10,
          ratePerSampleSec: Math.round(ratePerSample * 100) / 100,
          slowingDown: recent > baseline * 1.05,
        };
      }
      case 'inspect_tool': {
        const wearLevel = Math.min(Math.max(parseInt(String(args.wearLevel || 50), 10) || 50, 0), 100);
        return inspect(wearLevel);
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
