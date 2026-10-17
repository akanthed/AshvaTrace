import { useState } from 'react';
import type { InvestigationTraceStep } from '../types';

interface Props {
  trace: InvestigationTraceStep[];
}

const TOOL_LABELS: Record<string, string> = {
  get_power_window: 'Read recent power readings',
  get_vibration_stats: 'Checked vibration levels',
  get_cycle_time_trend: 'Checked time per part',
  inspect_tool: 'Inspected the cutting tool (simulated image)',
};

function num(v: unknown, digits = 1): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits).replace(/\.0+$/, '') : null;
}

// Turn a raw tool result into one plain sentence. Falls back to a short
// generic line — raw JSON stays available behind "show raw data".
function summarize(tool: string | undefined, r: any): string {
  if (!r || typeof r !== 'object') return 'Data received.';
  if (r.error) return `Could not read data: ${r.error}`;
  try {
    if (tool === 'get_vibration_stats') {
      const cur = num(r.currentMmS, 2);
      const avg = num(r.avgMmS, 2);
      const max = num(r.maxMmS, 2);
      const parts = [cur && `now ${cur} mm/s`, avg && `average ${avg}`, max && `peak ${max}`].filter(Boolean);
      if (parts.length) return `Vibration: ${parts.join(', ')}${r.trendingUp ? ' — and rising' : ''}.`;
    }
    if (tool === 'get_cycle_time_trend') {
      const cur = num(r.currentSec);
      const base = num(r.baselineSec);
      const parts = [cur && `now ${cur} s`, base && `earlier ${base} s`].filter(Boolean);
      if (parts.length) return `Time per part: ${parts.join(', ')}${r.slowingDown ? ' — machine is slowing down' : ''}.`;
    }
    if (tool === 'inspect_tool') {
      const wear = num(r.wearPct, 0);
      if (r.condition) return `Tool is ${r.condition}${wear ? ` (about ${wear}% worn)` : ''}.${r.recommendation ? ` ${r.recommendation}` : ''}`;
    }
    if (tool === 'get_power_window' && r.windowSamples) {
      const first = num(r.firstDevPct);
      const last = num(r.lastDevPct);
      return `Power vs normal over ${r.windowSamples} readings: ${first}% → ${last}% (${r.trend}).`;
    }
  } catch {
    // fall through
  }
  return 'Data received.';
}

// Shows how the AI worked: which readings it pulled before answering, in plain
// words, with the raw numbers one click away. Collapsed by default.
export function InvestigationTrace({ trace }: Props) {
  const [open, setOpen] = useState(false);
  if (trace.length === 0) return null;

  const toolCalls = trace.filter((t) => t.type === 'tool_call').length;

  return (
    <div className="trace">
      <button type="button" className="trace-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="trace-ico">⚙</span>
        <span>
          How the AI got here
          <small>
            {' '}
            — it pulled {toolCalls} set{toolCalls === 1 ? '' : 's'} of live readings before answering
          </small>
        </span>
        <span className="trace-chev">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <ol className="trace-steps">
          {trace.map((step, i) => {
            if (step.type === 'tool_call') {
              return (
                <li key={i} className="t-call">
                  <b>{TOOL_LABELS[step.tool ?? ''] ?? step.tool}</b>
                </li>
              );
            }
            if (step.type === 'tool_result') {
              return (
                <li key={i} className="t-result">
                  <span>{summarize(step.tool, step.result)}</span>
                  <details>
                    <summary>Show raw data</summary>
                    <pre>{JSON.stringify(step.result, null, 2)}</pre>
                  </details>
                </li>
              );
            }
            return (
              <li key={i} className="t-reason">
                <b>AI's conclusion, before the code checked it</b>
                <p>Draft answer written; every number in it is then checked by code against the readings above.</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
