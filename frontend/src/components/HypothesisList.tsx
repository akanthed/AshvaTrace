import type { Grounding, Hypothesis } from '../types';

// Result of the automatic check (done by code, not AI) that every number in
// the explanation really appears in the machine's sensor data.
function FigureCheck({ g }: { g: Grounding }) {
  const cls = g.status === 'verified' ? 'ok' : g.status === 'partial' ? 'warn' : 'crit';
  const label =
    g.figuresChecked === 0
      ? 'No sensor figures quoted — treat with caution'
      : g.status === 'verified'
        ? `All ${g.figuresChecked} figures match the sensor data`
        : `${g.figuresVerified} of ${g.figuresChecked} figures match the sensor data`;
  const problems = [
    ...g.unsupportedFigures.map((f) => `${f} not found in the data`),
    ...g.badReferences.map((r) => `${r} is not a known reference`),
  ];
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
      <span className={`pill ${cls}`}>{label}</span>
      {problems.length > 0 && <span style={{ color: 'var(--muted)' }}>Could not confirm: {problems.join('; ')}</span>}
    </div>
  );
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
    <div style={{ display: 'grid', gap: 12 }}>
      {hypotheses.map((h, i) => (
        <article
          key={h.id}
          className="hyp"
          onClick={() => onSelect?.(h.id)}
          style={{
            cursor: onSelect ? 'pointer' : undefined,
            outline: selectedId === h.id ? '2px solid var(--accent)' : undefined,
          }}
        >
          <h4>
            <span className="rank">#{i + 1}</span>
            {h.title}
            <span className="pill info">{h.confidence}% likely</span>
            {h.sopRef && <span className="pill">Follows {h.sopRef}</span>}
          </h4>
          <div className="fa">
            <div>
              <span style={{ color: 'var(--ok)' }}>Why this fits</span>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {h.evidenceFor.map((e, idx) => (
                  <li key={idx}>{e}</li>
                ))}
              </ul>
            </div>
            <div>
              <span style={{ color: 'var(--warn)' }}>What argues against it</span>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {h.evidenceAgainst.map((e, idx) => (
                  <li key={idx}>{e}</li>
                ))}
              </ul>
            </div>
          </div>
          {h.grounding && <FigureCheck g={h.grounding} />}
        </article>
      ))}
    </div>
  );
}
