import type { Hypothesis } from '../types';

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
        </article>
      ))}
    </div>
  );
}
