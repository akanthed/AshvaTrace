import type { AuditEntry } from '../types';

interface Props {
  entries: AuditEntry[];
}

const ACTOR_LABELS: Record<string, string> = {
  system: 'System',
  ai: 'AI',
  engineer: 'Engineer',
};

export function AuditLog({ entries }: Props) {
  if (entries.length === 0) {
    return <div className="empty">No audit entries</div>;
  }

  return (
    <ul className="audit audit-list">
      {entries.map((e, i) => {
        const d = new Date(e.timestamp);
        return (
          <li key={i} className={`actor-${e.actor}`}>
            <time dateTime={e.timestamp}>
              <b>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</b>
              <small>{d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</small>
            </time>
            <span className="audit-body">
              <span className={`actor-chip ${e.actor}`}>{ACTOR_LABELS[e.actor] ?? e.actor}</span>
              <span className="audit-text">{e.details}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
