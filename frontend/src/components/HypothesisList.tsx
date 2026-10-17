import type { Grounding, Hypothesis } from '../types';

// Result of the automatic check (done by code, not AI) that every number in
// the explanation really appears in the machine's sensor data.
function FigureCheck({ g }: { g: Grounding }) {
  const cls = g.status === 'verified' ? 'ok' : g.status === 'partial' ? 'warn' : 'crit';
  const label =
    g.figuresChecked === 0
      ? 'No sensor figures quoted — treat with caution'
      : g.status === 'verified'
        ? `Code checked: all ${g.figuresChecked} numbers match the sensor data`
        : `Code checked: ${g.figuresVerified} of ${g.figuresChecked} numbers match the sensor data`;
  const problems = [
    ...g.unsupportedFigures.map((f) => `${f} not found in the data`),
    ...g.badReferences.map((r) => `${r} is not a known reference`),
  ];
  return (
    <div className="figcheck">
      <span className={`pill ${cls}`}>{label}</span>
      {problems.length > 0 && <span className="figcheck-note">Could not confirm: {problems.join('; ')}</span>}
    </div>
  );
}

function confidenceTone(c: number): string {
  if (c >= 70) return 'high';
  if (c >= 40) return 'mid';
  return 'low';
}

interface Props {
  hypotheses: Hypothesis[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}

export function HypothesisList({ hypotheses, selectedId, onSelect }: Props) {
  if (hypotheses.length === 0) {
    return <div className="empty">No hypotheses yet. Run the AI investigation first.</div>;
  }

  return (
    <div className="hyp-list">
      {hypotheses.map((h, i) => {
        const selected = selectedId === h.id;
        return (
          <article
            key={h.id}
            className={`hyp ${selected ? 'selected' : ''} ${i === 0 ? 'top' : ''}`}
            onClick={() => onSelect?.(h.id)}
            style={{ cursor: onSelect ? 'pointer' : undefined }}
          >
            <h4>
              <span className="rank">{i === 0 ? 'MOST LIKELY' : `#${i + 1}`}</span>
              <span className="hyp-title">{h.title}</span>
              {h.sopRef && <span className="pill">Follows {h.sopRef}</span>}
            </h4>

            <div className="conf">
              <div className="conf-bar" aria-hidden="true">
                <div className={`conf-fill ${confidenceTone(h.confidence)}`} style={{ width: `${Math.min(100, Math.max(0, h.confidence))}%` }} />
              </div>
              <span className="conf-label">{h.confidence}% likely</span>
            </div>

            <div className="fa">
              <div>
                <span style={{ color: 'var(--ok)' }}>Why this fits</span>
                <ul>
                  {h.evidenceFor.map((e, idx) => (
                    <li key={idx}>{e}</li>
                  ))}
                </ul>
              </div>
              <div>
                <span style={{ color: 'var(--warn)' }}>What argues against it</span>
                <ul>
                  {h.evidenceAgainst.map((e, idx) => (
                    <li key={idx}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>

            {(h.nextCheck || h.suggestedFix) && (
              <div className="hyp-next">
                {h.nextCheck && (
                  <p>
                    <b>Quick check:</b> {h.nextCheck}
                  </p>
                )}
                {h.suggestedFix && (
                  <p>
                    <b>Suggested fix:</b> {h.suggestedFix}
                  </p>
                )}
              </div>
            )}

            <div className="hyp-foot">
              {h.grounding && <FigureCheck g={h.grounding} />}
              {onSelect && (
                <span className={`hyp-pick ${selected ? 'on' : ''}`}>{selected ? '✓ Selected as the cause' : 'Click to select this cause'}</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
