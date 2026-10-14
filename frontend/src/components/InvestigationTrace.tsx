import { useState } from 'react';
import type { InvestigationTraceStep } from '../types';

interface Props {
  trace: InvestigationTraceStep[];
}

// Shows the agentic investigation step by step: each tool the AI called,
// what it got back, and its final reasoning. Collapsed by default so the
// hypothesis list stays the primary content — the trace is the "show your
// work" evidence that the AI queried real data before hypothesizing.
export function InvestigationTrace({ trace }: Props) {
  const [open, setOpen] = useState(false);
  if (trace.length === 0) return null;

  const toolCalls = trace.filter((t) => t.type === 'tool_call').length;

  return (
    <div className="trace" style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--fg)',
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ color: 'var(--accent)' }}>⚙</span>
        AI investigation trace — {toolCalls} tool call{toolCalls === 1 ? '' : 's'}
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <ol style={{ margin: '10px 0 0', paddingLeft: 20, display: 'grid', gap: 8, fontSize: 13 }}>
          {trace.map((step, i) => {
            if (step.type === 'tool_call') {
              return (
                <li key={i}>
                  <b style={{ color: 'var(--accent)' }}>→ {step.tool}</b>{' '}
                  <code style={{ opacity: 0.8 }}>{JSON.stringify(step.args || {})}</code>
                </li>
              );
            }
            if (step.type === 'tool_result') {
              return (
                <li key={i} style={{ marginLeft: -8 }}>
                  <span style={{ opacity: 0.6 }}>{step.tool} returned:</span>{' '}
                  <details>
                    <summary style={{ cursor: 'pointer', opacity: 0.8 }}>view result</summary>
                    <pre style={{ margin: '6px 0', padding: 8, background: 'var(--bg2, rgba(255,255,255,0.04))', borderRadius: 6, overflowX: 'auto', fontSize: 12 }}>
                      {JSON.stringify(step.result, null, 2)}
                    </pre>
                  </details>
                </li>
              );
            }
            return (
              <li key={i}>
                <b>AI reasoning:</b>
                <p style={{ margin: '4px 0 0', opacity: 0.85, whiteSpace: 'pre-wrap' }}>{step.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
